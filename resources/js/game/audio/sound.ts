import type { Station } from '@/sim/core';
import type { WorldView } from '@/sim/view';

/**
 * Звук (раздел 12) — синтез WebAudio без звуковых файлов (нет сторонних ассетов):
 * двигатели по оборотам и наддуву (основной тон — частота вспышек 14-цилиндровой звезды, 7 на оборот),
 * панорама по станции; шум потока от скорости; очереди M2; разрывы зениток с задержкой по расстоянию;
 * щелчок и шорох рации на фразах СПУ (сами фразы — субтитрами). Категории громкости: общая,
 * двигатели, оружие, СПУ, интерфейс; хранятся в браузере (настройки — этап 5).
 */
export type VolumeCategory = 'master' | 'engines' | 'weapons' | 'intercom' | 'ui';
export type Volumes = Record<VolumeCategory, number>;

export const DEFAULT_VOLUMES: Volumes = { master: 0.8, engines: 0.8, weapons: 0.9, intercom: 0.8, ui: 0.6 };
const STORAGE_KEY = 'b25j.audio.volumes';

/** Положение станции вдоль фюзеляжа: доля громкости двигателей и ширина панорамы. */
const STATION_ACOUSTICS: Record<Station, { engines: number; pan: number; wind: number }> = {
    pilot: { engines: 1, pan: 0.7, wind: 0.7 },
    copilot: { engines: 1, pan: 0.7, wind: 0.7 },
    bombardier: { engines: 0.85, pan: 0.5, wind: 0.9 },
    navigator: { engines: 0.9, pan: 0.6, wind: 0.6 },
    top_gunner: { engines: 0.9, pan: 0.6, wind: 0.8 },
    radio: { engines: 0.75, pan: 0.4, wind: 0.6 },
    waist_gunner: { engines: 0.6, pan: 0.35, wind: 1 },
    tail_gunner: { engines: 0.45, pan: 0.2, wind: 0.9 },
};

/** Голос двигателя: частота вспышек, громкость, панорама (−1 левый … +1 правый). */
export function engineVoice(rpm: number, manifoldInHg: number, station: Station, side: -1 | 1): { freq: number; gain: number; pan: number } {
    const a = STATION_ACOUSTICS[station];
    const running = rpm > 120;
    const load = Math.min(1.2, Math.max(0, (manifoldInHg - 10) / 32));

    return {
        freq: Math.max(20, (rpm / 60) * 7),
        gain: running ? a.engines * (0.25 + 0.75 * load) * Math.min(1, rpm / 1200) : 0,
        pan: side * a.pan,
    };
}

/** Шум потока: квадратично по приборной скорости, м/с. */
export function windGain(iasMs: number, station: Station): number {
    return Math.min(1, (Math.max(0, iasMs) / 110) ** 2) * STATION_ACOUSTICS[station].wind * 0.5;
}

/** Задержка и громкость звука разрыва на расстоянии d, м. */
export function burstArrival(distanceM: number): { delayS: number; gain: number } {
    return { delayS: distanceM / 343, gain: Math.min(1, 300 / (300 + distanceM)) };
}

export function loadVolumes(): Volumes {
    try {
        const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Volumes>;

        return { ...DEFAULT_VOLUMES, ...Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'number' && v >= 0 && v <= 1)) };
    } catch {
        return { ...DEFAULT_VOLUMES };
    }
}

export function saveVolumes(v: Volumes): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
}

export type SoundEngine = {
    update(view: WorldView, station: Station): void;
    setVolumes(v: Volumes): void;
    setPaused(paused: boolean): void;
    dispose(): void;
};

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let s = 0x9e3779b9;

    for (let i = 0; i < data.length; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        data[i] = (s / 4294967295) * 2 - 1;
    }

    return buffer;
}

export function createSound(target: Window = window): SoundEngine {
    const Ctor = (target as Window & { AudioContext?: typeof AudioContext }).AudioContext;

    if (Ctor === undefined) {
        return { update: () => undefined, setVolumes: () => undefined, setPaused: () => undefined, dispose: () => undefined };
    }

    const ctx = new Ctor();
    const master = ctx.createGain();
    const bus = Object.fromEntries((['engines', 'weapons', 'intercom', 'ui'] as const).map((k) => [k, ctx.createGain()])) as Record<Exclude<VolumeCategory, 'master'>, GainNode>;

    master.connect(ctx.destination);
    Object.values(bus).forEach((g) => g.connect(master));

    const noise = noiseBuffer(ctx, 2);
    const loopNoise = (): AudioBufferSourceNode => {
        const src = ctx.createBufferSource();

        src.buffer = noise;
        src.loop = true;
        src.start();

        return src;
    };

    // Двигатели: пила на частоте вспышек + субгармоника + низкочастотный шум выхлопа.
    const engines = ([-1, 1] as const).map((side) => {
        const saw = ctx.createOscillator();
        const sub = ctx.createOscillator();
        const exhaust = loopNoise();
        const lp = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        const pan = ctx.createStereoPanner();
        const subGain = ctx.createGain();

        saw.type = 'sawtooth';
        sub.type = 'sine';
        lp.type = 'lowpass';
        lp.frequency.value = 600;
        subGain.gain.value = 0.6;
        gain.gain.value = 0;
        saw.connect(lp);
        exhaust.connect(lp);
        sub.connect(subGain).connect(gain);
        lp.connect(gain).connect(pan).connect(bus.engines);
        saw.start();
        sub.start();

        return { side, saw, sub, exhaust, lp, gain, pan };
    });

    // Поток: шум через полосовой фильтр.
    const windSrc = loopNoise();
    const windFilter = ctx.createBiquadFilter();
    const windGainNode = ctx.createGain();

    windFilter.type = 'bandpass';
    windFilter.frequency.value = 900;
    windFilter.Q.value = 0.6;
    windGainNode.gain.value = 0;
    windSrc.connect(windFilter).connect(windGainNode).connect(bus.engines);

    // Пулемёты: шум, промодулированный «очередью» ~13 выстрелов/с (M2 ~ 800 в минуту).
    const gunSrc = loopNoise();
    const gunFilter = ctx.createBiquadFilter();
    const gunGate = ctx.createGain();
    const gunGain = ctx.createGain();
    const gunLfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();

    gunFilter.type = 'lowpass';
    gunFilter.frequency.value = 2200;
    gunLfo.type = 'square';
    gunLfo.frequency.value = 13;
    lfoDepth.gain.value = 0.5;
    gunGate.gain.value = 0.5;
    gunGain.gain.value = 0;
    gunLfo.connect(lfoDepth).connect(gunGate.gain);
    gunSrc.connect(gunFilter).connect(gunGate).connect(gunGain).connect(bus.weapons);
    gunLfo.start();

    const oneShot = (bufferSeconds: number, filterHz: number, peak: number, decayS: number, at: number, out: AudioNode): void => {
        const src = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        src.buffer = noise;
        filter.type = 'lowpass';
        filter.frequency.value = filterHz;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(peak, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + decayS);
        src.connect(filter).connect(gain).connect(out);
        src.start(at, Math.random() * 1.5, bufferSeconds);
    };

    const heardBursts = new Set<number>();
    let lastIntercom = 0;
    let volumes = loadVolumes();
    let paused = false;
    const apply = (): void => {
        master.gain.value = paused ? 0 : volumes.master;
        bus.engines.gain.value = volumes.engines;
        bus.weapons.gain.value = volumes.weapons;
        bus.intercom.gain.value = volumes.intercom;
        bus.ui.gain.value = volumes.ui;
    };

    apply();

    // Автозапуск звука в браузерах — только после действия пользователя.
    const resume = (): void => void ctx.resume();

    target.addEventListener('pointerdown', resume);
    target.addEventListener('keydown', resume);

    return {
        update: (view, station) => {
            if (ctx.state !== 'running') {
                return;
            }

            const now = ctx.currentTime;
            const smooth = 0.08;

            engines.forEach((e, i) => {
                const engine = view.aircraft.engines[i];
                const v = engineVoice(engine?.rpm ?? 0, engine?.manifoldInHg ?? 0, station, e.side);

                e.saw.frequency.setTargetAtTime(v.freq, now, smooth);
                e.sub.frequency.setTargetAtTime(v.freq / 2, now, smooth);
                e.lp.frequency.setTargetAtTime(300 + v.freq * 4, now, smooth);
                e.gain.gain.setTargetAtTime(v.gain * 0.22, now, smooth);
                e.pan.pan.setTargetAtTime(v.pan, now, smooth);
            });

            windGainNode.gain.setTargetAtTime(windGain(view.derived.indicatedAirspeed, station), now, 0.2);

            // Свои пулемёты громче, чужие — по расстоянию до ближайшего стреляющего истребителя.
            const ownFiring = view.mounts.some((m) => m.firing);
            const a = view.aircraft.position;
            const enemy = view.fighters.filter((f) => f.firing).reduce((best, f) => Math.min(best, Math.hypot(f.position.x - a.x, f.position.y - a.y, f.position.z - a.z)), Infinity);
            const gun = ownFiring ? 0.5 : enemy < 1500 ? 0.25 * burstArrival(enemy).gain : 0;

            gunGain.gain.setTargetAtTime(gun, now, 0.02);

            for (const b of view.bursts) {
                if (!heardBursts.has(b.id)) {
                    heardBursts.add(b.id);

                    const arrival = burstArrival(Math.hypot(b.position.x - a.x, b.position.y - a.y, b.position.z - a.z));

                    oneShot(0.6, b.typeId === 'light' ? 1800 : 500, arrival.gain * 0.9, b.typeId === 'light' ? 0.25 : 0.9, now + arrival.delayS, bus.weapons);
                }
            }

            if (heardBursts.size > 512) {
                const live = new Set(view.bursts.map((b) => b.id));

                for (const id of heardBursts) {
                    if (!live.has(id)) {
                        heardBursts.delete(id);
                    }
                }
            }

            // СПУ: щелчок тангенты и шорох на новой фразе.
            const latest = view.intercom[view.intercom.length - 1]?.tick ?? 0;

            if (latest > lastIntercom) {
                if (lastIntercom > 0) {
                    oneShot(0.12, 3000, 0.25, 0.12, now, bus.intercom);
                }

                lastIntercom = latest;
            }
        },
        setVolumes: (v) => {
            volumes = v;
            saveVolumes(v);
            apply();
        },
        setPaused: (p) => {
            paused = p;
            apply();
        },
        dispose: () => {
            target.removeEventListener('pointerdown', resume);
            target.removeEventListener('keydown', resume);
            void ctx.close();
        },
    };
}
