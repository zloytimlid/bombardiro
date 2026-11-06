/**
 * Голосовое СПУ на WebRTC (этап 6): сеть «каждый с каждым» внутри экипажа (до 8 игроков), сигнализация —
 * whisper `rtc` в канале вылета (Reverb). Передача — по тангенте (push-to-talk); приём — через «радиофильтр»
 * (полоса 300–3000 Гц и лёгкое ограничение), громкость — категория «СПУ». Звук не идёт через сервер.
 */
export type RtcSignal =
    | { v: number; type: 'offer' | 'answer'; from: number; to: number; sdp: string }
    | { v: number; type: 'ice'; from: number; to: number; candidate: RTCIceCandidateInit }
    | { v: number; type: 'talk'; from: number; on: boolean };

export type VoiceTransport = {
    send(signal: RtcSignal): void;
};

export type VoiceCallbacks = {
    onTalking(userId: number, on: boolean): void;
    onState(state: { enabled: boolean; peers: number; error: string | null }): void;
};

const PROTOCOL = 1;

/** Кривая мягкого ограничения — «хрип» рации. */
function radioCurve(amount: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(n);

    for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;

        curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
    }

    return curve;
}

type Peer = { pc: RTCPeerConnection; audio: HTMLAudioElement | null; nodes: AudioNode[] };

export class VoiceIntercom {
    private readonly peers = new Map<number, Peer>();
    private mic: MediaStream | null = null;
    private ctx: AudioContext | null = null;
    private out: GainNode | null = null;
    private enabled = false;
    private talking = false;
    private error: string | null = null;

    constructor(
        private readonly selfId: number,
        private readonly transport: VoiceTransport,
        private readonly iceServers: RTCIceServer[],
        private readonly callbacks: VoiceCallbacks,
        private volume = 0.8,
    ) {}

    get isEnabled(): boolean {
        return this.enabled;
    }

    /** Включить: доступ к микрофону (после жеста игрока), соединения с игроками на связи. */
    async enable(present: number[]): Promise<void> {
        if (this.enabled) {
            return;
        }

        try {
            this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } catch (e) {
            this.error = e instanceof Error ? e.name : 'mic';
            this.emit();

            return;
        }

        // Тангента отпущена — дорожка выключена, но соединение есть.
        this.mic.getAudioTracks().forEach((t) => (t.enabled = false));
        this.ctx = new AudioContext();
        this.out = this.ctx.createGain();
        this.out.gain.value = this.volume;
        this.out.connect(this.ctx.destination);
        this.enabled = true;
        this.error = null;
        this.syncPeers(present);
        this.emit();
    }

    disable(): void {
        for (const id of [...this.peers.keys()]) {
            this.dropPeer(id);
        }

        this.mic?.getTracks().forEach((t) => t.stop());
        this.mic = null;
        void this.ctx?.close();
        this.ctx = null;
        this.out = null;
        this.enabled = false;
        this.emit();
    }

    setVolume(v: number): void {
        this.volume = v;

        if (this.out) {
            this.out.gain.value = v;
        }
    }

    /** Тангента: говорить, пока нажата. */
    setTalking(on: boolean): void {
        if (!this.enabled || this.talking === on) {
            return;
        }

        this.talking = on;
        this.mic?.getAudioTracks().forEach((t) => (t.enabled = on));
        this.transport.send({ v: PROTOCOL, type: 'talk', from: this.selfId, on });
        this.callbacks.onTalking(this.selfId, on);
    }

    /** Кто на связи: соединение предлагает игрок с меньшим id — так пара не создаёт два соединения. */
    syncPeers(present: number[]): void {
        if (!this.enabled) {
            return;
        }

        for (const id of present) {
            if (id !== this.selfId && !this.peers.has(id) && this.selfId < id) {
                void this.call(id);
            }
        }

        for (const id of [...this.peers.keys()]) {
            if (!present.includes(id)) {
                this.dropPeer(id);
            }
        }

        this.emit();
    }

    async handle(signal: RtcSignal): Promise<void> {
        if (signal.v !== PROTOCOL || signal.from === this.selfId) {
            return;
        }

        if (signal.type === 'talk') {
            this.callbacks.onTalking(signal.from, signal.on);

            return;
        }

        if (signal.to !== this.selfId || !this.enabled) {
            return;
        }

        if (signal.type === 'offer') {
            const peer = this.peers.get(signal.from) ?? this.createPeer(signal.from);

            await peer.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });

            const answer = await peer.pc.createAnswer();

            await peer.pc.setLocalDescription(answer);
            this.transport.send({ v: PROTOCOL, type: 'answer', from: this.selfId, to: signal.from, sdp: answer.sdp ?? '' });
        } else if (signal.type === 'answer') {
            await this.peers.get(signal.from)?.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
        } else if (signal.type === 'ice') {
            await this.peers.get(signal.from)?.pc.addIceCandidate(signal.candidate).catch(() => undefined);
        }
    }

    private async call(id: number): Promise<void> {
        const peer = this.createPeer(id);
        const offer = await peer.pc.createOffer();

        await peer.pc.setLocalDescription(offer);
        this.transport.send({ v: PROTOCOL, type: 'offer', from: this.selfId, to: id, sdp: offer.sdp ?? '' });
    }

    private createPeer(id: number): Peer {
        const pc = new RTCPeerConnection({ iceServers: this.iceServers });
        const peer: Peer = { pc, audio: null, nodes: [] };

        this.mic?.getAudioTracks().forEach((t) => pc.addTrack(t, this.mic!));
        pc.onicecandidate = (e) => {
            if (e.candidate) {
                this.transport.send({ v: PROTOCOL, type: 'ice', from: this.selfId, to: id, candidate: e.candidate.toJSON() });
            }
        };
        pc.ontrack = (e) => this.play(peer, e.streams[0] ?? new MediaStream([e.track]));
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                this.dropPeer(id);
            }

            this.emit();
        };
        this.peers.set(id, peer);

        return peer;
    }

    private play(peer: Peer, stream: MediaStream): void {
        if (!this.ctx || !this.out) {
            return;
        }

        // Chrome отдаёт удалённый звук в WebAudio, только если поток привязан к элементу (без звука).
        const audio = new Audio();

        audio.srcObject = stream;
        audio.muted = true;
        void audio.play().catch(() => undefined);

        const src = this.ctx.createMediaStreamSource(stream);
        const hp = this.ctx.createBiquadFilter();
        const lp = this.ctx.createBiquadFilter();
        const shaper = this.ctx.createWaveShaper();

        hp.type = 'highpass';
        hp.frequency.value = 300;
        lp.type = 'lowpass';
        lp.frequency.value = 3000;
        shaper.curve = radioCurve(4);
        src.connect(hp).connect(lp).connect(shaper).connect(this.out);
        peer.audio = audio;
        peer.nodes = [src, hp, lp, shaper];
    }

    private dropPeer(id: number): void {
        const peer = this.peers.get(id);

        if (peer) {
            peer.nodes.forEach((n) => n.disconnect());
            peer.audio?.pause();
            peer.pc.close();
            this.peers.delete(id);
            this.callbacks.onTalking(id, false);
        }
    }

    private emit(): void {
        this.callbacks.onState({ enabled: this.enabled, peers: [...this.peers.values()].filter((p) => p.pc.connectionState === 'connected').length, error: this.error });
    }
}
