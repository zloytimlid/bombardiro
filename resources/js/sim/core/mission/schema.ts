import { z } from 'zod';
import { STATIONS } from '../config';

/**
 * Формат миссии (раздел 8.3): декларативный JSON без исполняемого кода.
 * Из этой схемы генерируется resources/sim/schemas/mission.schema.json (сервер валидирует по ней).
 */
const i18n = z.object({ ru: z.string().min(1), en: z.string().min(1) });
const latLon = { lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) };

export const WAYPOINT_TYPES = ['takeoff', 'formup', 'turn', 'ip', 'target', 'rally', 'initial_approach', 'final', 'base'] as const;
export type WaypointType = (typeof WAYPOINT_TYPES)[number];

export const waypointSchema = z.object({
    id: z.string().min(1),
    type: z.enum(WAYPOINT_TYPES),
    ...latLon,
    alt_m: z.number().min(0).max(9000),
    /** Расчётная приборная скорость на участке до точки, км/ч. */
    speed_kmh: z.number().positive().optional(),
});

export const cloudLayerSchema = z.object({
    base_m: z.number().min(0),
    top_m: z.number().min(0),
    coverage: z.number().min(0).max(1),
});

export const weatherSchema = z.object({
    clouds: z.array(cloudLayerSchema),
    visibility_m: z.number().positive(),
    wind: z.array(z.object({ altitude_m: z.number(), from_deg: z.number().min(0).max(360), speed_ms: z.number().min(0) })),
    turbulence_ms: z.number().min(0),
});

export type MissionWeather = z.infer<typeof weatherSchema>;

export const targetSchema = z.object({
    id: z.string().min(1),
    type: z.enum(['bridge', 'rail_yard', 'airfield', 'gun_position']),
    name: i18n,
    aim_point: z.object(latLon),
    elevation_m: z.number(),
    heading_deg: z.number(),
    /** Секции (пролёты моста) с запасом прочности: смещение вдоль/поперёк оси цели от точки прицеливания. */
    sections: z
        .array(
            z.object({
                id: z.string(),
                offset_m: z.tuple([z.number(), z.number()]),
                length_m: z.number().positive(),
                width_m: z.number().positive(),
                strength: z.number().positive(),
            }),
        )
        .min(1),
    destroyed_when: z.enum(['any_section', 'all_sections']),
});

export type MissionTarget = z.infer<typeof targetSchema>;

export const flakBatterySchema = z.object({
    id: z.string().min(1),
    type: z.enum(['heavy', 'light']),
    ...latLon,
    elevation_m: z.number(),
    guns: z.number().int().positive(),
    active: z.boolean(),
    /** Заградительный огонь по квадрату над целью вместо прицельного. */
    barrage: z.boolean().default(false),
});

export type FlakBatteryDef = z.infer<typeof flakBatterySchema>;

export const ATTACK_TYPES = ['head_on', 'high_six', 'beam'] as const;
export type AttackType = (typeof ATTACK_TYPES)[number];

export const fighterWaveSchema = z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    count: z.number().int().min(1).max(12),
    skill: z.enum(['novice', 'experienced', 'veteran']),
    /** Точка появления относительно бомбардировщика: пеленг от его курса, дальность, превышение. */
    spawn: z.object({ bearing_deg: z.number(), distance_m: z.number().positive(), altitude_offset_m: z.number() }),
    attacks: z.array(z.enum(ATTACK_TYPES)).min(1),
});

export type FighterWaveDef = z.infer<typeof fighterWaveSchema>;

export const RADIO_MEANINGS = [
    'target_confirmed',
    'recall',
    'weather_clear',
    'weather_bad',
    'fighters_reported',
    'change_target',
    'iff_reminder',
    'landing_clearance',
] as const;
export type RadioMeaning = (typeof RADIO_MEANINGS)[number];

export const radioMessageSchema = z.object({
    id: z.string().min(1),
    channel: z.enum(['tower', 'command', 'base']),
    group: z.string().min(2),
    meaning: z.enum(RADIO_MEANINGS),
    duration_s: z.number().positive(),
    repeats: z.number().int().min(1),
});

export type RadioMessageDef = z.infer<typeof radioMessageSchema>;

const conditionSchema = z.object({
    phase: z.string().optional(),
    near_waypoint: z.object({ id: z.string(), radius_m: z.number().positive() }).optional(),
    time_s: z.number().min(0).optional(),
    event: z.enum(['bombs_released', 'radio_transmit', 'message_received', 'aircraft_damaged']).optional(),
    message_id: z.string().optional(),
    probability: z.number().min(0).max(1).optional(),
});

export const actionSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('spawn_wave'), wave: z.string() }),
    z.object({ type: z.literal('send_radio'), message: z.string() }),
    z.object({ type: z.literal('change_target'), target: z.string() }),
    z.object({ type: z.literal('set_weather'), weather: weatherSchema.partial() }),
    z.object({ type: z.literal('activate_battery'), battery: z.string() }),
    z.object({ type: z.literal('recall') }),
]);

export type MissionAction = z.infer<typeof actionSchema>;

export const triggerSchema = z.object({
    id: z.string().min(1),
    once: z.boolean().default(true),
    when: conditionSchema,
    then: z.array(actionSchema).min(1),
});

export type MissionTrigger = z.infer<typeof triggerSchema>;

export const missionSchema = z.object({
    $schema: z.string().optional(),
    id: z.string().min(1),
    version: z.number().int().positive(),
    title: i18n,
    historical_date: z.string().nullable(),
    theatre: z.string().min(1),
    seed: z.number().int().nonnegative(),
    difficulty: z.enum(['training', 'normal', 'hard']),
    weather: weatherSchema,
    time_of_day: z.string().regex(/^\d{2}:\d{2}$/),
    start: z.object({ runway: z.string(), engines_running: z.boolean() }),
    waypoints: z.array(waypointSchema).min(3),
    target: targetSchema,
    alternate_targets: z.array(targetSchema).default([]),
    /** Расчётное время над целью от начала вылета и допуск окна, с. */
    time_over_target: z.object({ at_s: z.number().positive(), window_s: z.number().positive() }),
    formation: z.object({ wingmen: z.number().int().min(0).max(11), spacing_m: z.number().positive() }),
    loadout: z.object({
        bombs: z.array(z.object({ type: z.string(), count: z.number().int().positive() })),
        fuel_kg: z.number().positive(),
        /** Плановый расход топлива на вылет — для метрики второго пилота «расход против плана». */
        planned_burn_kg: z.number().positive(),
    }),
    threats: z.object({ flak: z.array(flakBatterySchema), fighter_waves: z.array(fighterWaveSchema) }),
    radio: z.object({
        frequencies_mhz: z.object({ tower: z.number(), command: z.number(), base: z.number() }),
        code_table: z.array(z.object({ group: z.string(), meaning: z.enum(RADIO_MEANINGS) })).min(1),
        beacon: z.object(latLon),
    }),
    radio_script: z.array(radioMessageSchema),
    triggers: z.array(triggerSchema),
    landmarks: z.array(z.object({ id: z.string(), ...latLon, kind: z.enum(['coast', 'town', 'river', 'cape', 'island']), name: i18n })),
    objectives: z.array(z.object({ id: z.string(), type: z.enum(['destroy_target', 'return_aircraft', 'crew_survival', 'time_over_target']) })).min(1),
    scoring: z.object({ target: z.number().min(0), aircraft: z.number().min(0), crew: z.number().min(0), timing: z.number().min(0) }),
    briefing: z.object({ general: i18n, roles: z.record(z.enum(STATIONS), i18n) }),
    sources: z.array(z.object({ title: z.string(), url: z.url().optional() })),
    placeholder: z.boolean(),
    todo: z.string().optional(),
});

export type MissionDefinition = z.infer<typeof missionSchema>;

export function parseMission(input: unknown): MissionDefinition {
    return missionSchema.parse(input);
}
