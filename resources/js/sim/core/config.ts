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

/** Восемь станций (раздел 3); порядок = клавиши 1–8, совпадает с App\Domain\Aircraft\Enums\Station. */
export const STATIONS = ['pilot', 'copilot', 'bombardier', 'navigator', 'top_gunner', 'radio', 'waist_gunner', 'tail_gunner'] as const;
export type Station = (typeof STATIONS)[number];

const mountSchema = z.object({
    position_m: vec3,
    az_center_deg: z.number(),
    az_half_deg: z.number().min(0).max(180),
    el_deg: z.tuple([z.number(), z.number()]),
    slew_deg_s: z.number().nonnegative(),
    no_fire: z.array(z.object({ az_center_deg: z.number(), az_half_deg: z.number(), el_max_deg: z.number() })),
});

export type MountConfig = z.infer<typeof mountSchema>;

export const ZONES = [
    'nose',
    'cockpit',
    'engine_left',
    'engine_right',
    'wing_left_inner',
    'wing_left_outer',
    'wing_right_inner',
    'wing_right_outer',
    'fuselage_mid',
    'fuselage_rear',
    'tail',
    'gear',
] as const;
export type ZoneId = (typeof ZONES)[number];

export const SUBSYSTEMS = [
    'bombsight',
    'nose_gun',
    'instruments',
    'oil_left',
    'oil_right',
    'generator_left',
    'generator_right',
    'hydraulic_pump_left',
    'hydraulic_pump_right',
    'prop_left',
    'prop_right',
    'tank_left_main',
    'tank_right_main',
    'tank_left_aux',
    'tank_right_aux',
    'flaps',
    'aileron_left',
    'aileron_right',
    'bomb_bay',
    'turret',
    'radio',
    'wiring',
    'waist_guns',
    'control_cables',
    'elevator',
    'rudder',
    'tail_gun',
    'gear_struts',
    'tires',
] as const;
export type SubsystemId = (typeof SUBSYSTEMS)[number];

const damageZoneSchema = z.object({
    id: z.enum(ZONES),
    box_m: z.tuple([vec3, vec3]),
    hp: z.number().positive(),
    crew: z.array(z.enum(STATIONS)),
    subsystems: z.array(z.enum(SUBSYSTEMS)),
});

export type DamageZoneConfig = z.infer<typeof damageZoneSchema>;

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
    stations: z.array(z.enum(STATIONS)).length(8),
    guns: z.array(
        z.object({
            id: z.string(),
            weapon: z.string(),
            count: z.number().int().positive(),
            mount: z.enum(['fixed', 'flexible', 'turret']),
            station: z.enum(STATIONS),
            removable: z.boolean().optional(),
            source: z.string().optional(),
            todo: z.string().optional(),
        }),
    ),
    arcs: todoValue,
    gameplay_mounts: sourced(z.record(z.string(), mountSchema)),
    gameplay_station_eyes: sourced(z.record(z.enum(STATIONS), vec3)),
    systems: z.object({
        oxygen_threshold_m: todoValue,
        gameplay_oxygen_threshold_m: sourced(z.number().positive()),
        gameplay_hypoxia_rate_per_s: sourced(z.number().nonnegative()),
    }),
    damage_model: z.object({
        source: z.literal('gameplay'),
        note: z.string().optional(),
        value: z.object({
            zones: z.array(damageZoneSchema).min(1),
            subsystem_hp: z.number().positive(),
            wound_chance_per_hit: z.number().min(0).max(1),
            heavy_wound_share: z.number().min(0).max(1),
            fire_chance_engine: z.number().min(0).max(1),
            fire_chance_tank: z.number().min(0).max(1),
            fire_chance_fuselage: z.number().min(0).max(1),
            wing_fire_destruction_s: z.number().positive(),
            oil_leak_seize_s: z.number().positive(),
            tank_leak_kg_s: z.number().positive(),
            self_sealing_tau_s: z.number().positive(),
            self_sealing_max_leak_kg_s: z.number().nonnegative(),
            lift_loss_per_hit: z.number().nonnegative(),
            drag_per_hit: z.number().nonnegative(),
            power_loss_per_hit: z.number().nonnegative(),
            control_loss_per_hit: z.number().nonnegative(),
            extinguish_s: z.number().positive(),
            first_aid_s: z.number().positive(),
            emergency_gear_s: z.number().positive(),
            fuel_transfer_kg_s: z.number().positive(),
        }),
    }),
    sources: z.record(z.string(), z.url()),
});

export type AircraftConfig = z.infer<typeof aircraftConfigSchema>;

export function parseAircraftConfig(input: unknown): AircraftConfig {
    return aircraftConfigSchema.parse(input);
}
