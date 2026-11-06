import type * as Comlink from 'comlink';
import type { AircraftConfig, HumanControls, Station, Terrain, WeatherConfig, WorldAction } from '@/sim/core';
import { STATIONS } from '@/sim/core/config';
import type { MissionStatic, WorldView } from '@/sim/view';
import type { SimWorker } from '@/sim/worker';
import type { NetBootstrapData, NetSeatData } from '@/types/generated/net';
import { api, timed } from './api';
import { InputDecoder, InputEncoder } from './input';
import { ViewInterpolator } from './interpolation';
import type { CmdMsg, EventMsg, InputMsg, SnapMsg } from './schemas';
import { cmdSchema, eventSchema, inputSchema, parseMessage, pingSchema, pongSchema, PROTOCOL_VERSION, protocolMismatch, snapSchema } from './schemas';
import type { DecodeContext } from './snapshot';
import { createDecodeState, decodeSnap } from './snapshot';
import { NetTransport } from './transport';
import type { RtcSignal, VoiceCallbacks } from './voice';
import { VoiceIntercom } from './voice';

/**
 * Кооперативная сессия (раздел 9): авторитетный хост считает мир в воркере, остальные шлют ввод
 * и получают снапшоты. Хост раз в 2 с пишет журнал и полный снапшот на сервер; при пропаже
 * хоста сервер назначает нового, тот восстанавливает мир из снапшота и продолжает.
 */
export type NetRole = 'host' | 'client';

export type NetStatus = {
    role: NetRole;
    hostUserId: number | null;
    migrating: boolean;
    connected: boolean;
    rttMs: number | null;
    roster: NetSeatData[];
    present: number[];
    protocolError: boolean;
    seatChangeAt: number | null;
};

export type NetCallbacks = {
    onStatus(status: NetStatus): void;
    onEnded(): void;
    onChat(from: number, text: string): void;
};

type SnapshotResponse = { data: { tick: number; state: unknown } | null };

type RemoteInput = { station: Station; controls: HumanControls; actions: WorldAction[] };

const SNAP_HZ = 15;
const KEYFRAME_MS = 1000;
const JOURNAL_MS = 2000;
const SNAPSHOT_MS = 2000;
/** Пульс хоста из кадра: сервер считает хоста пропавшим после 1 с тишины (Protocol::HOST_SILENCE_SECONDS). */
const HOST_HEARTBEAT_MS = 500;
const CLIENT_HEARTBEAT_MS = 5000;
/** Снапшоты идут 15 Гц: 1,5 с тишины — хост пропал (вкладку закрыли, сеть упала). Presence-канал
 * при обрыве без закрытия сокета узнаёт об уходе только по тайм-ауту — на него не полагаемся. */
const NO_SNAP_HOST_LOST_MS = 1500;
const WATCHDOG_MS = 250;
/** Нет ввода от места дольше — станцию ведёт ИИ, пока игрок не вернётся (место держится 120 с). */
const INPUT_STALE_MS = 3000;
const SEAT_SWITCH_DELAY_MS = 3000;
const EVENTS_PER_WHISPER = 40;

export class NetSession {
    readonly userId: number;
    role: NetRole;
    private status: NetStatus;
    private readonly transport: NetTransport;
    private readonly encoder: InputEncoder;
    private readonly decoder = new InputDecoder();
    private readonly interpolator = new ViewInterpolator();
    private readonly decodeState = createDecodeState();
    private readonly remote = new Map<Station, RemoteInput>();
    private readonly aiSeats = new Set<Station>();
    private readonly timers: number[] = [];
    private lastSnapAt = 0;
    private lastHostBeatAt = 0;
    /** Номер смены хоста: растёт при каждой смене, отсекает устаревшие ответы пульса. */
    private hostEpoch = 0;
    private rosterRev = 0;
    private readonly lastInputAt = new Map<Station, number>();
    private reportingHostLost = false;
    private lastWatchdogAt = 0;
    private lastHumansSync = 0;
    private lastKeyAt = 0;
    private lastJournalAt = 0;
    private lastSnapshotAt = 0;
    private journalSeq = 0;
    private broadcastSeq = 0;
    private clientSeq = 0;
    private latestView: WorldView | null = null;
    private hostLostRequested = 0;
    private pingId = 0;
    private readonly pings = new Map<number, number>();
    private finished = false;
    private disposed = false;
    private snapBusy = false;
    private uploadBusy = false;
    private humansKey = '';

    constructor(
        private readonly boot: NetBootstrapData,
        private readonly sim: Comlink.Remote<SimWorker>,
        private readonly decodeCtx: Omit<DecodeContext, 'station'>,
        private station: Station,
        private readonly callbacks: NetCallbacks,
        delayMs: number,
    ) {
        this.userId = boot.user_id;
        this.role = boot.host_user_id === boot.user_id ? 'host' : 'client';
        this.transport = new NetTransport(boot.session, boot.crew, delayMs);
        this.encoder = new InputEncoder(() => this.station);
        this.status = {
            role: this.role,
            hostUserId: boot.host_user_id,
            migrating: false,
            connected: true,
            rttMs: null,
            roster: boot.roster,
            present: [],
            protocolError: false,
            seatChangeAt: null,
        };
    }

    get currentStation(): Station {
        return this.station;
    }

    // ───────────────────────────── запуск ─────────────────────────────

    start(): void {
        this.transport.joinCrew(
            {
                here: (ids) => this.setPresent(ids),
                joining: (id) => this.setPresent([...new Set([...this.status.present, id])]),
                leaving: (id) => {
                    this.setPresent(this.status.present.filter((x) => x !== id));

                    // Хост ушёл из presence-канала — сообщить серверу (раздел 9.3).
                    if (id === this.status.hostUserId && this.role === 'client') {
                        void this.reportHostLost();
                    }
                },
            },
            {
                SeatClaimed: (e) => {
                    const roster = (e as { roster: { rev?: number; members: { user_id: number; callsign: string; seat: string | null }[] } }).roster;

                    // События лобби могут прийти не по порядку — берём только более свежую ревизию.
                    if ((roster.rev ?? 0) >= this.rosterRev) {
                        this.rosterRev = roster.rev ?? 0;
                        this.onRoster(roster.members);
                    }
                },
            },
        );

        this.transport.joinSession(
            {
                snap: (d) => this.onSnap(d),
                event: (d) => this.onEvent(d),
                cmd: (d) => this.onCmd(d),
                ping: (d) => this.onPing(d),
                pong: (d) => this.onPong(d),
                rtc: (d) => void this.voice?.handle(d as RtcSignal),
            },
            {
                HostChanged: (e) => void this.onHostChanged((e as { hostUserId: number }).hostUserId),
                SessionEnded: () => this.end(),
            },
        );

        this.joinInputs();
        // Пульс клиента — по таймеру; пульс хоста — из кадра (afterHostFrame): скрытая вкладка хоста
        // не шагает мир, и сервер должен это увидеть и передать хоста.
        this.timers.push(
            window.setInterval(() => {
                if (this.role !== 'host') {
                    void this.heartbeat();
                }
            }, CLIENT_HEARTBEAT_MS),
        );
        this.timers.push(window.setInterval(() => this.ping(), 1000));
        this.timers.push(window.setInterval(() => this.watchdog(), WATCHDOG_MS));
        void this.heartbeat();
        this.emit();
    }

    private joinInputs(): void {
        if (this.role === 'host') {
            for (const seat of STATIONS) {
                this.transport.joinInput(seat, (d) => this.onInput(d));
            }
        } else {
            this.transport.joinInput(this.station, (d) => this.onSeatMessage(d));
        }
    }

    dispose(): void {
        this.disposed = true;
        this.voice?.disable();
        this.timers.forEach((t) => window.clearInterval(t));
        this.transport.dispose();
    }

    // ───────────────────────────── общие ─────────────────────────────

    private emit(): void {
        this.status = { ...this.status, role: this.role };
        this.callbacks.onStatus(this.status);
    }

    private setPresent(ids: number[]): void {
        this.status = { ...this.status, present: ids };
        this.voice?.syncPeers(ids);
        this.emit();
        void this.syncHumans();
    }

    private onRoster(members: { user_id: number; callsign: string; seat: string | null }[]): void {
        const roster: NetSeatData[] = STATIONS.map((seat) => {
            const m = members.find((x) => x.seat === seat);

            return { seat, user_id: m?.user_id ?? null, callsign: m?.callsign ?? null, is_ai: m === undefined };
        });

        this.status = { ...this.status, roster };

        const mine = roster.find((r) => r.user_id === this.userId);

        if (mine && mine.seat !== this.station && this.status.seatChangeAt === null) {
            this.switchStationLocal(mine.seat as Station);
        }

        this.emit();
        void this.syncHumans();
    }

    /** Хост: места игроков на связи — люди, остальные (и «ИИ на моём месте») — ИИ. */
    private async syncHumans(): Promise<void> {
        if (this.role !== 'host') {
            return;
        }

        // Место ведёт игрок, если это наше место или от него недавно пришёл ввод (клиент шлёт ≥ 5 раз в секунду).
        // Присутствию в канале не доверяем: при обрыве без закрытия сокета оно узнаёт об уходе только по тайм-ауту.
        const now = performance.now();
        const humans = this.status.roster
            .filter((r) => r.user_id !== null && !this.aiSeats.has(r.seat as Station))
            .filter((r) => r.user_id === this.userId || now - (this.lastInputAt.get(r.seat as Station) ?? -Infinity) < INPUT_STALE_MS)
            .map((r) => r.seat as Station);
        const key = humans.join(',');

        if (key !== this.humansKey) {
            this.humansKey = key;
            await this.sim.setHumans(humans);
        }
    }

    private async heartbeat(): Promise<void> {
        if (this.disposed) {
            return;
        }

        // Ответ, ушедший до смены хоста, несёт старого хоста — по нему хоста не меняем.
        const epoch = this.hostEpoch;

        try {
            const { result, rttMs } = await timed(() => api<{ host_user_id: number | null; status: string }>('POST', `/api/sessions/${this.boot.session}/rtt`, { rtt_ms: this.status.rttMs ?? null }));

            this.status = { ...this.status, connected: true, rttMs: this.status.rttMs ?? rttMs };

            if (epoch === this.hostEpoch && result.host_user_id !== null && result.host_user_id !== this.status.hostUserId) {
                void this.onHostChanged(result.host_user_id);
            }

            if (result.status === 'finished') {
                this.end();
            }
        } catch {
            this.status = { ...this.status, connected: false };
        }

        this.emit();
    }

    private ping(): void {
        if (this.role === 'client' && !this.disposed) {
            const id = ++this.pingId;

            this.pings.set(id, performance.now());
            this.transport.broadcast('ping', { v: PROTOCOL_VERSION, id, from: this.userId, t: Date.now() });
        }
    }

    /** Клиент: нет снапшотов дольше порога — сообщить серверу о пропаже хоста (раздел 9.3). */
    private watchdog(): void {
        const now = performance.now();

        if (this.role === 'host' && now - this.lastHumansSync > 1000) {
            this.lastHumansSync = now;
            void this.syncHumans();
        }

        // Сама вкладка подвисла (тяжёлый кадр, фон) — тишина в снапшотах не наша улика против хоста.
        const stalled = now - this.lastWatchdogAt > WATCHDOG_MS * 4;

        this.lastWatchdogAt = now;

        if (stalled) {
            return;
        }

        if (this.role === 'client' && !this.disposed && this.interpolator.latest !== null && this.interpolator.sinceLatest(performance.now()) > NO_SNAP_HOST_LOST_MS) {
            void this.reportHostLost();
        }
    }

    private onPing(data: unknown): void {
        const msg = parseMessage(pingSchema, data, 'ping');

        if (msg && this.role === 'host') {
            this.transport.broadcast('pong', { v: PROTOCOL_VERSION, id: msg.id, to: msg.from, t: msg.t, ht: Date.now(), tick: this.latestView?.tick ?? 0 });
        }
    }

    private onPong(data: unknown): void {
        const msg = parseMessage(pongSchema, data, 'pong');

        if (msg && msg.to === this.userId) {
            const sent = this.pings.get(msg.id);

            if (sent !== undefined) {
                this.pings.delete(msg.id);
                this.status = { ...this.status, rttMs: Math.round(performance.now() - sent) };
            }
        }
    }

    // ───────────────────────────── хост ─────────────────────────────

    private onInput(data: unknown): void {
        if (this.role !== 'host') {
            return;
        }

        if (protocolMismatch(data)) {
            return;
        }

        const msg = parseMessage(inputSchema, data, 'input') as InputMsg | null;

        if (msg === null) {
            return;
        }

        const decoded = this.decoder.decode(msg);
        const prev = this.remote.get(decoded.station);

        this.remote.set(decoded.station, { station: decoded.station, controls: decoded.controls, actions: [...(prev?.actions ?? []), ...decoded.actions] });

        if (!this.lastInputAt.has(decoded.station) || performance.now() - (this.lastInputAt.get(decoded.station) ?? 0) >= INPUT_STALE_MS) {
            this.lastInputAt.set(decoded.station, performance.now());
            void this.syncHumans();
        }

        this.lastInputAt.set(decoded.station, performance.now());

        if (decoded.rtt !== null) {
            void this.sim.setStationLag(decoded.station, decoded.rtt);
        }
    }

    /** Ввод удалённых мест на этот кадр (действия — один раз). */
    takeRemoteInputs(): RemoteInput[] {
        const out = [...this.remote.values()].filter((r) => r.station !== this.station);

        for (const r of this.remote.values()) {
            r.actions = [];
        }

        return out;
    }

    /**
     * После шага хоста: снапшоты 15 Гц экипажу и выгрузка на сервер (журнал и полный мир раз в 2 с, итог).
     * Это две независимые очереди: медленный PUT снапшота не должен задерживать снапшоты экипажу,
     * иначе клиенты сочтут хоста пропавшим.
     */
    async afterHostFrame(view: WorldView, now: number): Promise<void> {
        this.latestView = view;

        if (this.role !== 'host' || this.restoring) {
            return;
        }

        if (now - this.lastHostBeatAt >= HOST_HEARTBEAT_MS) {
            this.lastHostBeatAt = now;
            void this.heartbeat();
        }

        void this.sendSnap(now);
        void this.upload(view, now);
    }

    private async sendSnap(now: number): Promise<void> {
        if (this.snapBusy || now - this.lastSnapAt < 1000 / SNAP_HZ) {
            return;
        }

        this.snapBusy = true;

        try {
            const key = now - this.lastKeyAt >= KEYFRAME_MS;
            const snap = await this.sim.snap(key, this.decoder.ack());

            this.transport.broadcast('snap', snap);
            this.lastSnapAt = now;

            if (key) {
                this.lastKeyAt = now;
            }

            // События экипажу — надёжный поток с seq.
            if (snap.q > this.broadcastSeq) {
                const events = await this.sim.eventsSince(this.broadcastSeq, EVENTS_PER_WHISPER);

                if (events.length > 0) {
                    this.transport.broadcast('event', { v: PROTOCOL_VERSION, e: events } satisfies EventMsg);
                    this.broadcastSeq = events[events.length - 1]?.seq ?? this.broadcastSeq;
                }
            }
        } catch (e) {
            console.warn('[net] snapshot failed', e);
        } finally {
            this.snapBusy = false;
        }
    }

    private async upload(view: WorldView, now: number): Promise<void> {
        if (this.uploadBusy) {
            return;
        }

        this.uploadBusy = true;

        try {
            if (now - this.lastJournalAt >= JOURNAL_MS) {
                this.lastJournalAt = now;
                await this.flushJournal();
            }

            if (now - this.lastSnapshotAt >= SNAPSHOT_MS) {
                this.lastSnapshotAt = now;

                const state = await this.sim.exportState();

                await api('PUT', `/api/sessions/${this.boot.session}/snapshot`, { v: PROTOCOL_VERSION, tick: state.sim.tick, state });
            }

            if (view.phase === 'debrief' && !this.finished) {
                this.finished = true;
                await this.flushJournal(true);

                const summary = await this.sim.finishSummary();

                await api('POST', `/api/sessions/${this.boot.session}/finish`, { v: PROTOCOL_VERSION, ...summary });
                this.resolveFlushed();
            }
        } catch (e) {
            console.warn('[net] host upload failed', e);

            // Итог не ушёл — повторить на следующем кадре.
            if (view.phase === 'debrief') {
                this.finished = false;
            }
        } finally {
            this.uploadBusy = false;
        }
    }

    private resolveFlushed: () => void = () => undefined;
    private readonly flushedPromise = new Promise<void>((resolve) => (this.resolveFlushed = resolve));

    /** Хост: дождаться выгрузки журнала и итога (не дольше `timeoutMs`); клиент — сразу. */
    flushed(timeoutMs = 15000): Promise<void> {
        if (this.role !== 'host') {
            return Promise.resolve();
        }

        return Promise.race([this.flushedPromise, new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs))]);
    }

    private async flushJournal(all = false): Promise<void> {
        do {
            const events = await this.sim.eventsSince(this.journalSeq, 500);

            if (events.length === 0) {
                return;
            }

            await api('POST', `/api/sessions/${this.boot.session}/events`, { v: PROTOCOL_VERSION, events });
            this.journalSeq = events[events.length - 1]?.seq ?? this.journalSeq;

            if (events.length < 500) {
                return;
            }
        } while (all);
    }

    private onCmd(data: unknown): void {
        const msg = parseMessage(cmdSchema, data, 'cmd') as CmdMsg | null;

        if (msg === null) {
            return;
        }

        if (msg.type === 'chat') {
            this.callbacks.onChat(msg.from, msg.text);
        } else if (this.role === 'host' && msg.type === 'events_from') {
            void this.sim.eventsSince(msg.seq - 1, EVENTS_PER_WHISPER).then((events) => this.transport.broadcast('event', { v: PROTOCOL_VERSION, e: events }));
        } else if (this.role === 'host' && msg.type === 'keyframe') {
            this.lastKeyAt = 0;
        } else if (this.role === 'host' && msg.type === 'seat_ai') {
            if (msg.on) {
                this.aiSeats.add(msg.seat as Station);
            } else {
                this.aiSeats.delete(msg.seat as Station);
            }

            this.humansKey = '';
            void this.syncHumans();
        }
    }

    // ───────────────────────────── клиент ─────────────────────────────

    private onSnap(data: unknown): void {
        if (this.role !== 'client') {
            return;
        }

        if (protocolMismatch(data)) {
            this.status = { ...this.status, protocolError: true };
            this.emit();

            return;
        }

        const msg = parseMessage(snapSchema, data, 'snap') as SnapMsg | null;

        if (msg === null) {
            return;
        }

        this.encoder.acknowledge(msg.ack[this.station]);

        const view = decodeSnap(msg, this.decodeState, { ...this.decodeCtx, station: this.station }, this.interpolator.latest);

        if (view === null) {
            this.transport.broadcast('cmd', { v: PROTOCOL_VERSION, type: 'keyframe', from: this.userId, seq: ++this.clientSeq });

            return;
        }

        this.interpolator.push(view, performance.now());

        if (this.status.migrating) {
            this.status = { ...this.status, migrating: false };
            this.emit();
        }

        if (view.phase === 'debrief' && !this.finished) {
            this.finished = true;
        }
    }

    private lastEventSeq = 0;

    private onEvent(data: unknown): void {
        const msg = parseMessage(eventSchema, data, 'event');

        if (msg === null || msg.e.length === 0) {
            return;
        }

        const first = msg.e[0]?.seq ?? 0;

        // Разрыв в потоке событий — запросить пропущенные.
        if (this.lastEventSeq > 0 && first > this.lastEventSeq + 1) {
            this.transport.broadcast('cmd', { v: PROTOCOL_VERSION, type: 'events_from', from: this.userId, seq: this.lastEventSeq + 1 });

            return;
        }

        this.lastEventSeq = Math.max(this.lastEventSeq, msg.e[msg.e.length - 1]?.seq ?? 0);
    }

    private onSeatMessage(data: unknown): void {
        void data;
    }

    /** Клиент: ввод своей станции хосту по каналу места. */
    sendInput(controls: HumanControls, actions: WorldAction[], now: number): void {
        if (this.role !== 'client') {
            return;
        }

        for (const action of actions) {
            this.encoder.queue(action);
        }

        const msg = this.encoder.build(controls, now, this.status.rttMs);

        if (msg !== null) {
            this.transport.sendInput(this.station, msg);
        }
    }

    view(now: number): WorldView | null {
        return this.interpolator.sample(now);
    }

    latest(): WorldView | null {
        return this.role === 'host' ? this.latestView : this.interpolator.latest;
    }

    // ───────────────────────────── миграция и места ─────────────────────────────

    private async reportHostLost(): Promise<void> {
        const now = performance.now();

        // Один цикл повторов за раз: сторож срабатывает каждые 0,25 с, параллельные циклы упрутся в лимит запросов.
        if (this.reportingHostLost || now - this.hostLostRequested < 1000 || this.finished || this.role === 'host') {
            return;
        }

        this.reportingHostLost = true;
        this.hostLostRequested = now;
        this.status = { ...this.status, migrating: true };
        this.emit();

        const lostHost = this.status.hostUserId;

        // Заранее загрузить снапшот мира: если хостом выберут нас, восстановимся без лишнего запроса.
        const data = this.fetchSnapshot();

        data.catch(() => undefined);
        this.prefetch = { at: now, data };

        // Сервер сменит хоста, только когда его пульса нет дольше 1,5 с — повторять каждые 0,3 с до 6 с.
        try {
            for (let attempt = 0; attempt < 20 && !this.disposed && this.status.hostUserId === lostHost; attempt++) {
                try {
                    const result = await api<{ host_user_id: number | null }>('POST', `/api/sessions/${this.boot.session}/host-lost`);

                    if (result.host_user_id !== null && result.host_user_id !== lostHost) {
                        await this.onHostChanged(result.host_user_id);

                        return;
                    }
                } catch (e) {
                    console.warn('[net] host-lost failed', e);
                }

                await new Promise((resolve) => window.setTimeout(resolve, 300));
            }
        } finally {
            this.reportingHostLost = false;
        }
    }

    private hostChange: Promise<void> = Promise.resolve();
    private prefetch: { at: number; data: Promise<SnapshotResponse> } | null = null;

    private fetchSnapshot(): Promise<SnapshotResponse> {
        return api<SnapshotResponse>('GET', `/api/sessions/${this.boot.session}/snapshot`);
    }

    /** Новый хост восстанавливает мир из снапшота: шаги мира и выгрузка — после восстановления. */
    restoring = false;

    /** Смены хоста идут по очереди: HostChanged из канала и ответ пульса могут прийти одновременно. */
    private onHostChanged(hostUserId: number): Promise<void> {
        this.hostChange = this.hostChange.then(() => this.applyHostChange(hostUserId)).catch((e: unknown) => {
            this.restoring = false;
            console.warn('[net] host change failed', e);
        });

        return this.hostChange;
    }

    private restartTimers(): void {
        this.timers.forEach((t) => window.clearInterval(t));
        this.timers.length = 0;
        // Пульс клиента — по таймеру; пульс хоста — из кадра (afterHostFrame): скрытая вкладка хоста
        // не шагает мир, и сервер должен это увидеть и передать хоста.
        this.timers.push(
            window.setInterval(() => {
                if (this.role !== 'host') {
                    void this.heartbeat();
                }
            }, CLIENT_HEARTBEAT_MS),
        );
        this.timers.push(window.setInterval(() => this.ping(), 1000));
        this.timers.push(window.setInterval(() => this.watchdog(), WATCHDOG_MS));
    }

    private async applyHostChange(hostUserId: number): Promise<void> {
        if (hostUserId === this.status.hostUserId && (this.role === 'host') === (hostUserId === this.userId)) {
            return;
        }

        this.hostEpoch++;
        this.status = { ...this.status, hostUserId, migrating: true };
        this.emit();

        if (hostUserId === this.userId && this.role !== 'host') {
            // Новый хост: сразу пульс раз в 1 с, затем свежий снапшот из Redis → мир в воркере → продолжаем.
            this.restoring = true;
            this.role = 'host';
            this.restartTimers();
            void this.heartbeat();

            // Снапшот уже запрошен при обнаружении пропажи хоста — после смерти хоста он не обновится.
            const prefetched = this.prefetch !== null && performance.now() - this.prefetch.at < 10000 ? this.prefetch.data : null;
            const snapshot = (await prefetched?.catch(() => null)) ?? (await this.fetchSnapshot());

            this.prefetch = null;

            if (snapshot.data !== null) {
                await this.sim.restore(snapshot.data.state);
            }

            this.journalSeq = await this.sim.lastSeq();
            this.broadcastSeq = this.journalSeq;
            this.lastKeyAt = 0;
            this.transport.leaveInput(this.station);
            this.joinInputs();
            this.humansKey = '';
            await this.syncHumans();
            await this.sim.recordEvent('host_changed', { host: this.userId });
            this.restoring = false;
        } else if (hostUserId !== this.userId && this.role === 'host') {
            // Нас сменили (например, после долгой паузы вкладки): обратно в клиенты.
            this.role = 'client';

            for (const seat of STATIONS) {
                if (seat !== this.station) {
                    this.transport.leaveInput(seat);
                }
            }

            this.interpolator.reset();
            this.joinInputs();
            this.restartTimers();
        } else {
            this.interpolator.reset();
        }

        this.status = { ...this.status, migrating: this.role === 'client' };
        this.emit();
    }

    /** Переход на другую станцию: место — через сервер (409, если занято), затем задержка 3 с. */
    async requestSeat(seat: Station): Promise<boolean> {
        try {
            await api('POST', `/api/crews/${this.boot.crew}/seats/${seat}`);
        } catch {
            return false;
        }

        this.status = { ...this.status, seatChangeAt: performance.now() + SEAT_SWITCH_DELAY_MS };
        this.emit();
        window.setTimeout(() => {
            this.status = { ...this.status, seatChangeAt: null };
            this.switchStationLocal(seat);
        }, SEAT_SWITCH_DELAY_MS);

        return true;
    }

    stationListeners: ((s: Station) => void)[] = [];

    private switchStationLocal(seat: Station): void {
        if (seat === this.station) {
            return;
        }

        if (this.role === 'client') {
            this.transport.leaveInput(this.station);
        }

        this.station = seat;
        this.decoder.reset(seat);

        if (this.role === 'client') {
            this.transport.joinInput(seat, (d) => this.onSeatMessage(d));
        }

        this.stationListeners.forEach((fn) => fn(seat));
        this.emit();
        void this.syncHumans();
    }

    /** «ИИ на моём месте» в кооперативе: хост ведёт станцию ИИ, пока игрок не вернёт её. */
    setSeatAi(on: boolean): void {
        const msg = { v: PROTOCOL_VERSION, type: 'seat_ai' as const, from: this.userId, seq: ++this.clientSeq, seat: this.station, on };

        if (this.role === 'host') {
            this.onCmd(msg);
        } else {
            this.transport.broadcast('cmd', msg);
        }
    }

    // ───────────────────────────── голосовое СПУ (этап 6) ─────────────────────────────

    private voice: VoiceIntercom | null = null;

    /** Включить голос: микрофон по жесту игрока, сеть «каждый с каждым» среди игроков на связи. */
    async enableVoice(iceServers: RTCIceServer[], callbacks: VoiceCallbacks, volume: number): Promise<void> {
        this.voice ??= new VoiceIntercom(this.userId, { send: (signal) => this.transport.broadcast('rtc', signal) }, iceServers, callbacks, volume);
        await this.voice.enable(this.status.present);
    }

    disableVoice(): void {
        this.voice?.disable();
    }

    setTalking(on: boolean): void {
        this.voice?.setTalking(on);
    }

    sendChat(text: string): void {
        const msg = { v: PROTOCOL_VERSION, type: 'chat' as const, from: this.userId, seq: ++this.clientSeq, text: text.slice(0, 200) };

        this.transport.broadcast('cmd', msg);
        this.callbacks.onChat(this.userId, msg.text);
    }

    private end(): void {
        if (!this.disposed) {
            this.callbacks.onEnded();
        }
    }

    // Для декодера клиента.
    static decodeContext(config: AircraftConfig, terrain: Terrain, weather: WeatherConfig, statics: MissionStatic): Omit<DecodeContext, 'station'> {
        return { config, terrain, weather, targetSections: statics.target.sections, targetHeading: statics.target.heading };
    }
}
