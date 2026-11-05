import type { RadioMeaning, RadioMessageDef } from './mission/schema';

/**
 * Радист (раздел 6.5): настройка частоты ручкой по шуму, приём закодированных сообщений,
 * расшифровка по кодовой таблице дня, «свой-чужой», сигнал бедствия, радиомолчание.
 * Непринятое сообщение = экипаж его не знает.
 */
export const DIAL_MIN_MHZ = 3.0;
export const DIAL_MAX_MHZ = 8.0;
/** Полуширина полосы приёма, МГц. */
export const BANDWIDTH_MHZ = 0.04;
const RECEIVE_SHARE = 0.6;
const RECEIVE_SIGNAL = 0.7;

export type RadioTransmission = {
    messageId: string;
    channel: 'tower' | 'command' | 'base';
    frequencyMhz: number;
    group: string;
    meaning: RadioMeaning;
    startTick: number;
    endTick: number;
    /** Сколько тиков сообщение было слышно на настроенной частоте. */
    heardTicks: number;
};

export type ReceivedMessage = {
    messageId: string;
    group: string;
    /** Время получения (тик) и расшифровки. */
    receivedTick: number;
    decoded: RadioMeaning | null;
    decodedTick: number | null;
    correct: boolean | null;
    /** Сообщение уже применено к знаниям экипажа. */
    applied: boolean;
};

export type RadioState = {
    dialMhz: number;
    iff: boolean;
    failed: boolean;
    silence: boolean;
    transmissions: RadioTransmission[];
    received: ReceivedMessage[];
    /** Сколько раз экипаж выходил в эфир в зоне противника (повышает шанс перехвата). */
    exposure: number;
    distressSent: boolean;
    sent: number;
    missed: number;
};

export function createRadio(): RadioState {
    return { dialMhz: 5.0, iff: false, failed: false, silence: true, transmissions: [], received: [], exposure: 0, distressSent: false, sent: 0, missed: 0 };
}

/** Сила сигнала 0..1 на текущей частоте: гауссов пик вокруг частоты станции. */
export function signalStrength(dialMhz: number, frequencyMhz: number): number {
    const d = (dialMhz - frequencyMhz) / BANDWIDTH_MHZ;

    return Math.exp(-d * d);
}

/** Уровень шума эфира для индикатора: чем ближе к активной станции, тем «чище». */
export function noiseLevel(radio: RadioState, tick: number): number {
    const active = radio.transmissions.filter((t) => t.startTick <= tick && tick < t.endTick);
    const best = active.reduce((m, t) => Math.max(m, signalStrength(radio.dialMhz, t.frequencyMhz)), 0);

    return 1 - best;
}

export function transmit(radio: RadioState, def: RadioMessageDef, frequencyMhz: number, tick: number, tickHz: number): void {
    const length = Math.round(def.duration_s * tickHz);

    for (let r = 0; r < def.repeats; r++) {
        const start = tick + r * (length + Math.round(10 * tickHz));

        radio.transmissions.push({
            messageId: def.id,
            channel: def.channel,
            frequencyMhz,
            group: def.group,
            meaning: def.meaning,
            startTick: start,
            endTick: start + length,
            heardTicks: 0,
        });
    }

    radio.sent++;
}

/** Приём за тик: копим «слышимость» каждой передачи; итог — принятые сообщения. */
export function stepRadio(radio: RadioState, tick: number, operatorActive: boolean): ReceivedMessage[] {
    const newlyReceived: ReceivedMessage[] = [];

    for (const t of radio.transmissions) {
        if (tick < t.startTick || tick >= t.endTick) {
            continue;
        }

        if (operatorActive && !radio.failed && signalStrength(radio.dialMhz, t.frequencyMhz) >= RECEIVE_SIGNAL) {
            t.heardTicks++;
        }

        if (tick === t.endTick - 1) {
            const already = radio.received.some((r) => r.messageId === t.messageId);

            if (!already && t.heardTicks >= (t.endTick - t.startTick) * RECEIVE_SHARE) {
                const message: ReceivedMessage = {
                    messageId: t.messageId,
                    group: t.group,
                    receivedTick: tick,
                    decoded: null,
                    decodedTick: null,
                    correct: null,
                    applied: false,
                };

                radio.received.push(message);
                newlyReceived.push(message);
            }
        }
    }

    // Пропущенные: все повторы закончились, а сообщение так и не принято.
    const finished = new Set(radio.transmissions.filter((t) => t.endTick <= tick).map((t) => t.messageId));

    for (const id of finished) {
        const pending = radio.transmissions.some((t) => t.messageId === id && t.endTick > tick);

        if (!pending && !radio.received.some((r) => r.messageId === id)) {
            radio.missed++;
            radio.transmissions = radio.transmissions.filter((t) => t.messageId !== id);
        }
    }

    radio.transmissions = radio.transmissions.filter((t) => t.endTick > tick || !radio.received.some((r) => r.messageId === t.messageId));

    return newlyReceived;
}

/** Расшифровка группы по кодовой таблице: игрок или ИИ выбирает значение. */
export function decode(message: ReceivedMessage, meaning: RadioMeaning, codeTable: { group: string; meaning: RadioMeaning }[], tick: number): boolean {
    const truth = codeTable.find((c) => c.group === message.group)?.meaning ?? null;

    message.decoded = meaning;
    message.decodedTick = tick;
    message.correct = truth === meaning;

    return message.correct;
}

/** Активные передачи для шкалы частот (где искать сигнал). */
export function activeTransmissions(radio: RadioState, tick: number): RadioTransmission[] {
    return radio.transmissions.filter((t) => t.startTick <= tick && tick < t.endTick);
}
