import { echo } from '@laravel/echo-vue';

/**
 * Транспорт кооператива (раздел 9.2): client events (whisper) Laravel Reverb по каналам
 * presence-crew.{crew}, private-session.{session}, private-session.{session}.input.{seat}.
 * Отладочная задержка `?debug_net_delay=150` (только вне продакшена) задерживает и отправку,
 * и приём — так E2E проверяет игру при 150 мс.
 */
type Handler = (data: unknown) => void;

type EchoChannel = {
    listenForWhisper(event: string, cb: Handler): EchoChannel;
    listen(event: string, cb: Handler): EchoChannel;
    whisper(event: string, data: unknown): EchoChannel;
};

type PresenceChannel = EchoChannel & {
    here(cb: (members: { id: number }[]) => void): PresenceChannel;
    joining(cb: (member: { id: number }) => void): PresenceChannel;
    leaving(cb: (member: { id: number }) => void): PresenceChannel;
};

type EchoLike = {
    private(name: string): EchoChannel;
    join(name: string): PresenceChannel;
    leave(name: string): void;
};

export type PresenceHandlers = { here(ids: number[]): void; joining(id: number): void; leaving(id: number): void };

export class NetTransport {
    private readonly echo: EchoLike;
    private readonly channels = new Set<string>();
    private readonly inputChannels = new Map<string, EchoChannel>();
    private session: EchoChannel | null = null;
    readonly delayMs: number;

    constructor(
        private readonly sessionId: string,
        private readonly crewId: string,
        delayMs = 0,
    ) {
        this.echo = echo() as unknown as EchoLike;
        this.delayMs = delayMs;
    }

    private later(fn: () => void): void {
        if (this.delayMs > 0) {
            window.setTimeout(fn, this.delayMs);
        } else {
            fn();
        }
    }

    private wrap(cb: Handler): Handler {
        return (data) => this.later(() => cb(data));
    }

    /** Присутствие экипажа: хост узнаёт, кто ушёл (место ведёт ИИ), клиенты — пропажу хоста. */
    joinCrew(handlers: PresenceHandlers, events: Record<string, Handler>): void {
        const name = `crew.${this.crewId}`;
        const channel = this.echo.join(name);

        channel.here((members) => handlers.here(members.map((m) => m.id)));
        channel.joining((m) => handlers.joining(m.id));
        channel.leaving((m) => handlers.leaving(m.id));

        for (const [event, cb] of Object.entries(events)) {
            channel.listen(`.${event}`, this.wrap(cb));
        }

        this.channels.add(`presence-${name}`);
    }

    /** Игровой канал вылета: снапшоты, события, команды, ping/pong и серверные события. */
    joinSession(whispers: Record<string, Handler>, events: Record<string, Handler>): void {
        const name = `session.${this.sessionId}`;
        const channel = this.echo.private(name);

        for (const [event, cb] of Object.entries(whispers)) {
            channel.listenForWhisper(event, this.wrap(cb));
        }

        for (const [event, cb] of Object.entries(events)) {
            channel.listen(`.${event}`, this.wrap(cb));
        }

        this.session = channel;
        this.channels.add(`private-${name}`);
    }

    /** Канал ввода места: владелец пишет, хост слушает (whisper получает один адресат). */
    joinInput(seat: string, onInput?: Handler): void {
        const name = `session.${this.sessionId}.input.${seat}`;
        let channel = this.inputChannels.get(seat);

        if (channel === undefined) {
            channel = this.echo.private(name);
            this.inputChannels.set(seat, channel);
            this.channels.add(`private-${name}`);
        }

        if (onInput !== undefined) {
            channel.listenForWhisper('input', this.wrap(onInput));
        }
    }

    leaveInput(seat: string): void {
        if (this.inputChannels.delete(seat)) {
            this.echo.leave(`session.${this.sessionId}.input.${seat}`);
        }
    }

    sendInput(seat: string, data: unknown): void {
        const channel = this.inputChannels.get(seat);

        this.later(() => channel?.whisper('input', data));
    }

    /** Хост → игрок по каналу его места (полный ключевой кадр после переподключения). */
    sendToSeat(seat: string, event: string, data: unknown): void {
        const channel = this.inputChannels.get(seat);

        this.later(() => channel?.whisper(event, data));
    }

    broadcast(event: string, data: unknown): void {
        this.later(() => this.session?.whisper(event, data));
    }

    dispose(): void {
        for (const name of this.channels) {
            this.echo.leave(name.replace(/^(private|presence)-/, ''));
        }

        this.channels.clear();
        this.inputChannels.clear();
        this.session = null;
    }
}
