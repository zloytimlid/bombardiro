import { z } from 'zod';

/**
 * Сообщения сетевого протокола (раздел 9.2, docs/protocol.md). Все входящие сообщения
 * проверяются этими схемами; невалидное отбрасывается и логируется.
 * Сообщения, которые проходят через сервер (журнал, снапшот, итог), типизированы из PHP:
 * resources/js/types/generated/net.ts.
 */
export const PROTOCOL_VERSION = 1;

const int = z.number().int();
const num = z.number();
const ints = z.array(int);

/**
 * Whisper проходит через Reverb (PHP): пустой объект {} при перекодировании становится пустым массивом [].
 * Записи принимают и то и другое.
 */
const emptyAsObject = (v: unknown): unknown => (Array.isArray(v) && v.length === 0 ? {} : v);
const record = <T extends z.ZodType>(value: T) => z.preprocess(emptyAsObject, z.record(z.string(), value));

/** Дискретное действие станции с порядковым номером: повторяется в каждом вводе до подтверждения. */
export const seatActionSchema = z.tuple([int, z.record(z.string(), z.unknown()).and(z.object({ type: z.string() }))]);

/** client-input: экипаж → хост по каналу места, 30 Гц при изменениях, иначе 5 Гц. Потеря допустима. */
export const inputSchema = z.object({
    v: z.literal(PROTOCOL_VERSION),
    s: z.string(),
    /** Оси штурвала, педалей, РУД, тормоза, триммер (−1..1 × 1000). */
    f: ints.max(12).optional(),
    /** Кнопки (битовая маска): курсовые пулемёты, огонь установки, устранение задержки. */
    b: int,
    /** Направление ствола (az, el) × 10⁴ и id установки. */
    g: z.tuple([int, int]).optional(),
    mid: z.string().optional(),
    a: z.array(seatActionSchema).max(32),
    /** RTT клиента до хоста, мс — для компенсации задержки. */
    r: int.min(0).max(5000).optional(),
});

export type InputMsg = z.infer<typeof inputSchema>;

/** client-snap: хост → все, 15 Гц; ключевой кадр раз в секунду, между ними — быстрая часть. */
export const snapSchema = z.object({
    v: z.literal(PROTOCOL_VERSION),
    t: int,
    k: z.union([z.literal(0), z.literal(1)]),
    /** Подтверждённые номера действий по местам. */
    ack: record(int),
    a: ints,
    e: ints,
    f: z.array(ints),
    w: z.array(ints),
    m: z.array(ints),
    tr: z.array(ints),
    bo: z.array(ints),
    bu: z.array(ints),
    im: z.array(ints),
    s: ints.optional(),
    /** Последний номер события журнала — клиент по нему ловит пропуски. */
    q: int,
    key: record(z.unknown()).optional(),
});

export type SnapMsg = z.infer<typeof snapSchema>;

/** client-event: хост → все, по событию; потеря недопустима — номер seq, при разрыве клиент просит повтор. */
export const eventSchema = z.object({
    v: z.literal(PROTOCOL_VERSION),
    e: z.array(z.object({ seq: int.min(1), tick: int.min(0), type: z.string().max(48), payload: record(z.unknown()) })).max(200),
});

export type EventMsg = z.infer<typeof eventSchema>;

/** client-cmd: любой → все: чат, просьба повторить события, просьба о ключевом кадре. */
export const cmdSchema = z.discriminatedUnion('type', [
    z.object({ v: z.literal(PROTOCOL_VERSION), type: z.literal('chat'), from: int, seq: int, text: z.string().min(1).max(200) }),
    z.object({ v: z.literal(PROTOCOL_VERSION), type: z.literal('events_from'), from: int, seq: int }),
    z.object({ v: z.literal(PROTOCOL_VERSION), type: z.literal('keyframe'), from: int, seq: int }),
    z.object({ v: z.literal(PROTOCOL_VERSION), type: z.literal('seat_ai'), from: int, seq: int, seat: z.string(), on: z.boolean() }),
]);

export type CmdMsg = z.infer<typeof cmdSchema>;

/** client-ping / client-pong: 1 Гц, отметки времени для RTT и смещения часов. */
export const pingSchema = z.object({ v: z.literal(PROTOCOL_VERSION), id: int, from: int, t: num });
export const pongSchema = z.object({ v: z.literal(PROTOCOL_VERSION), id: int, to: int, t: num, ht: num, tick: int });

export type PingMsg = z.infer<typeof pingSchema>;
export type PongMsg = z.infer<typeof pongSchema>;

/** Проверка входящего: невалидное — null и запись в лог (раздел 9.2). */
export function parseMessage<T>(schema: z.ZodType<T>, data: unknown, kind: string): T | null {
    const result = schema.safeParse(data);

    if (!result.success) {
        const v = typeof data === 'object' && data !== null ? (data as { v?: unknown }).v : undefined;

        const issues = result.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ');

        console.warn(`[net] dropped invalid ${kind}${v !== undefined && v !== PROTOCOL_VERSION ? ` (protocol v${String(v)})` : ''}: ${issues}`);

        return null;
    }

    return result.data;
}

/** Несовпадение версии протокола → возврат в лобби с просьбой обновить страницу. */
export function protocolMismatch(data: unknown): boolean {
    return typeof data === 'object' && data !== null && 'v' in data && (data as { v: unknown }).v !== PROTOCOL_VERSION;
}

/** Битовая маска кнопок client-input. */
export const BUTTONS = { fireFixed: 1, fire: 2, clearJam: 4 } as const;
