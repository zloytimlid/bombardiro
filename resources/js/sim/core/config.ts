import { z } from 'zod';

/**
 * Схема конфига самолёта (resources/sim/aircraft/b25j.json, раздел 16.1).
 * Каждый параметр с историческим смыслом обёрнут в {value, source, confidence | todo}.
 * Из этой схемы генерируется resources/sim/schemas/aircraft.schema.json.
 */
const source = z.string().min(1);
const confidence = z.enum(['low', 'medium', 'high']);

/** Подтверждённый параметр: есть значение и источник. */
const sourced = <T extends z.ZodType>(value: T) =>
    z.object({
        value,
        source,
        confidence: confidence.optional(),
        note: z.string().optional(),
        todo: z.string().optional(),
    });

/** Неподтверждённый параметр: null + TODO(history). */
const todoValue = z.object({ value: z.null(), todo: z.string().regex(/TODO\(history\)/) });

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const table = z.array(z.tuple([z.number(), z.number()])).min(2);

const gearPoint = z.object({
    id: z.string(),
    r_m: vec3,
    spring_n_per_m: z.number().positive(),
    damper_n_s_per_m: z.number().positive(),
    max_compression_m: z.number().positive(),
    steerable: z.boolean(),
    brake: z.enum(['left', 'right']).nullable(),
});

export const aircraftConfigSchema = z.object({
    id: z.string(),
    config_version: z.number().int().positive(),
    airframe: z.object({ serial: z.string(), code: z.string(), name: z.string(), unit: z.string(), source }),
    geometry: z.object({
        length_m: sourced(z.number().positive()),
        wingspan_m: sourced(z.number().positive()),
        height_m: sourced(z.number().positive()),
        wing_area_m2: sourced(z.number().positive()),
        airfoil_root: sourced(z.string()),
        airfoil_tip: sourced(z.string()),
        mean_chord_m: sourced(z.number().positive()),
        engine_arm_m: sourced(z.number().positive()),
        pilot_eye_m: sourced(vec3),
    }),
    mass: z.object({
        empty_kg: sourced(z.number().positive()),
        max_takeoff_kg: sourced(z.number().positive()),
        inertia_kgm2: sourced(z.object({ ixx: z.number().positive(), iyy: z.number().positive(), izz: z.number().positive() })),
        cg_empty_m: todoValue,
        crew_member_kg: sourced(z.number().positive()),
    }),
    performance_targets: z.object({
        max_speed_kmh: sourced(z.number()).extend({ at_altitude_m: z.number(), tolerance: z.number() }),
        cruise_speed_kmh: sourced(z.number()).extend({ tolerance: z.number() }),
        range_km: sourced(z.number()).extend({ tolerance: z.number() }),
        service_ceiling_m: sourced(z.number()).extend({ tolerance: z.number() }),
        climb_rate_ms: todoValue,
        stall_speed_kmh: todoValue,
        reference_mass_kg: sourced(z.number().positive()),
        cruise_setting: sourced(z.object({ altitude_m: z.number(), throttle: z.number().min(0).max(1), rpm: z.number().positive() })),
    }),
    engines: z.object({
        count: z.literal(2),
        model: sourced(z.string()),
        rated_power_hp: sourced(z.number().positive()),
        supercharger_stages: todoValue,
        power_curve: sourced(
            z.object({
                mp_rated_inhg: z.number().positive(),
                mp_idle_inhg: z.number().positive(),
                rpm_rated: z.number().positive(),
                rpm_idle: z.number().positive(),
                rpm_min_governed: z.number().positive(),
                full_throttle_mp_inhg: table,
                bsfc_kg_per_kwh: z.number().positive(),
                spool_tau_s: z.number().positive(),
                cht_tau_s: z.number().positive(),
                cht_heat_c: z.number().positive(),
                cowl_cooling: z.number().min(0).max(1),
            }),
        ),
        limits: todoValue,
        gameplay_limits: sourced(
            z.object({
                mp_max_inhg: z.number(),
                rpm_max: z.number(),
                cht_max_c: z.number(),
                overboost_wear_per_s: z.number(),
                overheat_wear_per_s: z.number(),
            }),
        ),
    }),
    propellers: z.object({
        diameter_m: todoValue,
        blades: todoValue,
        type: z.literal('constant_speed_feathering'),
        gameplay_model: sourced(
            z.object({
                eta_max: z.number().positive().max(1),
                v0_ms: z.number().positive(),
                windmill_drag_n_per_pa: z.number().nonnegative(),
                feathered_drag_factor: z.number().min(0).max(1),
                governor_tau_s: z.number().positive(),
            }),
        ),
    }),
    fuel: z.object({
        tanks: todoValue,
        self_sealing: z.boolean(),
        gameplay_tanks: sourced(z.array(z.object({ id: z.string(), capacity_kg: z.number().positive(), x_m: z.number() })).min(1)),
    }),
    aero: z.object({
        source: z.literal('calibrated'),
        cl0: z.number(),
        cl_alpha_per_rad: z.number().positive(),
        cl_max: z.number().positive(),
        cl_flaps_delta: z.number(),
        cl_post_stall_slope_per_rad: z.number(),
        cd0: z.number().positive(),
        k_induced: z.number().positive(),
        cd_gear: z.number().nonnegative(),
        cd_bay_doors: z.number().nonnegative(),
        cd_flaps: z.number().nonnegative(),
        cd_stall_per_rad: z.number().nonnegative(),
        cy_beta: z.number(),
        cy_rudder: z.number(),
        cm0: z.number(),
        cm_alpha: z.number().negative(),
        cm_q: z.number().negative(),
        cm_elevator: z.number().negative(),
        cm_flaps: z.number(),
        cl_beta: z.number(),
        cl_p: z.number().negative(),
        cl_r: z.number(),
        cl_aileron: z.number().positive(),
        cl_stall_asymmetry: z.number().nonnegative(),
        cn_beta: z.number().positive(),
        cn_r: z.number().negative(),
        cn_p: z.number(),
        cn_rudder: z.number().negative(),
        cn_aileron: z.number(),
        elevator_max_rad: z.number().positive(),
        aileron_max_rad: z.number().positive(),
        rudder_max_rad: z.number().positive(),
        trim_max: z.number().positive().max(1),
        ground_effect_span_factor: z.number().nonnegative(),
    }),
    gear: z.object({
        source: z.literal('calibrated'),
        nose_wheel_steering: todoValue,
        gameplay_nose_wheel: sourced(z.object({ max_deg: z.number().positive(), fade_speed_ms: z.number().positive() })),
        retract_time_s: z.number().positive(),
        points: z.array(gearPoint).length(3),
        belly_points: z.array(z.object({ id: z.string(), r_m: vec3 })).min(1),
        mu_roll: z.number().nonnegative(),
        mu_brake: z.number().nonnegative(),
        mu_lateral: z.number().nonnegative(),
        mu_belly: z.number().nonnegative(),
        crash_vertical_speed_ms: z.number().positive(),
    }),
    bomb_bay: z.object({
        max_load_kg: sourced(z.number().positive()),
        allowed: z.array(z.string()),
        stations: todoValue,
        gameplay_x_m: sourced(z.number()),
    }),
    stations: z.array(z.string()).length(8),
    guns: z.array(
        z.object({
            id: z.string(),
            weapon: z.string(),
            count: z.number().int().positive(),
            mount: z.enum(['fixed', 'flexible', 'turret']),
            station: z.string(),
            removable: z.boolean().optional(),
            source: z.string().optional(),
            todo: z.string().optional(),
        }),
    ),
    arcs: todoValue,
    sources: z.record(z.string(), z.url()),
});

export type AircraftConfig = z.infer<typeof aircraftConfigSchema>;

export function parseAircraftConfig(input: unknown): AircraftConfig {
    return aircraftConfigSchema.parse(input);
}
