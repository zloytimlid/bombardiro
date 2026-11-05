import { z } from 'zod';
import bombsJson from '../../../sim/weapons/bombs.json';
import m2Json from '../../../sim/weapons/m2.json';
import fightersJson from '../../../sim/enemies/fighters.json';
import flakJson from '../../../sim/enemies/flak.json';

/**
 * Схемы данных оружия и противника (resources/sim/weapons, resources/sim/enemies).
 * Как и конфиг самолёта, параметр с историческим смыслом — {value, source} либо null + TODO(history).
 */
const source = z.string().min(1);
const sourced = <T extends z.ZodType>(value: T) =>
    z.object({
        value,
        source,
        confidence: z.enum(['low', 'medium', 'high']).optional(),
        note: z.string().optional(),
        todo: z.string().optional(),
    });
const todoValue = z.object({ value: z.null(), todo: z.string().regex(/TODO\(history\)/) });

export const gunConfigSchema = z.object({
    id: z.string(),
    name: z.string(),
    config_version: z.number().int().positive(),
    caliber_mm: sourced(z.number().positive()),
    rate_rpm: sourced(z.number().positive()),
    muzzle_velocity_ms: sourced(z.number().positive()),
    bullet_mass_kg: sourced(z.number().positive()),
    ammo_per_gun: todoValue,
    gameplay: z.object({
        source: z.literal('gameplay'),
        note: z.string().optional(),
        value: z.object({
            ammo_per_gun: z.number().int().positive(),
            drag_k_per_m: z.number().nonnegative(),
            dispersion_mrad: z.number().nonnegative(),
            tracer_every: z.number().int().positive(),
            lifetime_s: z.number().positive(),
            effective_range_m: z.number().positive(),
            heat_per_shot: z.number().nonnegative(),
            cool_per_s: z.number().nonnegative(),
            overheat: z.number().min(0).max(1),
            jam_chance_per_shot: z.number().min(0).max(1),
            jam_chance_per_shot_overheated: z.number().min(0).max(1),
            clear_jam_hold_s: z.number().positive(),
            damage_per_hit: z.number().positive(),
        }),
    }),
    sources: z.record(z.string(), z.url()),
});

export type GunConfig = z.infer<typeof gunConfigSchema>;

export const bombTypeSchema = z.object({
    id: z.string(),
    name: z.string(),
    mass_kg: sourced(z.number().positive()),
    gameplay: z.object({
        source: z.literal('gameplay'),
        value: z.object({
            diameter_m: z.number().positive(),
            cd: z.number().positive(),
            lethal_radius_m: z.number().positive(),
            damage_radius_m: z.number().positive(),
            damage: z.number().positive(),
        }),
    }),
});

export type BombType = z.infer<typeof bombTypeSchema>;

export const bombsConfigSchema = z.object({
    config_version: z.number().int().positive(),
    note: z.string().optional(),
    bombs: z.array(bombTypeSchema).min(1),
});

const skillSchema = z.object({
    aim_error_mrad: z.number().nonnegative(),
    reaction_s: z.number().nonnegative(),
    exit_hp_share: z.number().min(0).max(1),
    max_passes: z.number().int().positive(),
});

export const SKILLS = ['novice', 'experienced', 'veteran'] as const;
export type Skill = (typeof SKILLS)[number];

export const fighterTypeSchema = z.object({
    id: z.string(),
    name: z.string(),
    source: z.literal('gameplay'),
    cruise_speed_ms: z.number().positive(),
    attack_speed_ms: z.number().positive(),
    max_turn_rate_deg_s: z.number().positive(),
    max_climb_ms: z.number().positive(),
    hp: z.number().positive(),
    radius_m: z.number().positive(),
    guns: z.object({
        count: z.number().int().positive(),
        rate_rpm: z.number().positive(),
        muzzle_velocity_ms: z.number().positive(),
        dispersion_mrad: z.number().nonnegative(),
        range_m: z.number().positive(),
        damage_per_hit: z.number().positive(),
    }),
    ammo_s: z.number().positive(),
});

export type FighterType = z.infer<typeof fighterTypeSchema>;

export const fightersConfigSchema = z.object({
    config_version: z.number().int().positive(),
    note: z.string().optional(),
    fighters: z.array(fighterTypeSchema).min(1),
    skills: z.object({ novice: skillSchema, experienced: skillSchema, veteran: skillSchema }),
});

export type FightersConfig = z.infer<typeof fightersConfigSchema>;

export const flakTypeSchema = z.object({
    id: z.enum(['heavy', 'light']),
    name: z.string(),
    source: z.literal('gameplay'),
    max_altitude_m: z.number().positive(),
    max_range_m: z.number().positive(),
    shell_speed_ms: z.number().positive(),
    interval_s: z.number().positive(),
    base_error_m: z.number().positive(),
    min_error_m: z.number().positive(),
    tracking_time_s: z.number().positive(),
    maneuver_heading_deg: z.number().positive(),
    maneuver_altitude_m: z.number().positive(),
    fragments_at_10m: z.number().positive(),
    lethal_radius_m: z.number().positive(),
    damage_per_fragment: z.number().positive(),
    barrage_box_m: z.number().nonnegative(),
});

export type FlakType = z.infer<typeof flakTypeSchema>;

export const flakConfigSchema = z.object({
    config_version: z.number().int().positive(),
    note: z.string().optional(),
    types: z.array(flakTypeSchema).min(1),
});

export type FlakConfig = z.infer<typeof flakConfigSchema>;

/** Весь «справочный» контент, который нужен миру вылета помимо самолёта и миссии. */
export type ContentLibrary = {
    gun: GunConfig;
    bombs: BombType[];
    fighters: FightersConfig;
    flak: FlakConfig;
};

export function parseContent(input: { gun: unknown; bombs: unknown; fighters: unknown; flak: unknown }): ContentLibrary {
    return {
        gun: gunConfigSchema.parse(input.gun),
        bombs: bombsConfigSchema.parse(input.bombs).bombs,
        fighters: fightersConfigSchema.parse(input.fighters),
        flak: flakConfigSchema.parse(input.flak),
    };
}

/** Встроенная библиотека контента (сборка клиента и тесты). */
export const DEFAULT_CONTENT: ContentLibrary = parseContent({ gun: m2Json, bombs: bombsJson, fighters: fightersJson, flak: flakJson });

export function bombType(content: ContentLibrary, id: string): BombType {
    const type = content.bombs.find((b) => b.id === id);

    if (type === undefined) {
        throw new Error(`Unknown bomb type ${id}`);
    }

    return type;
}

export function fighterType(content: ContentLibrary, id: string): FighterType {
    const type = content.fighters.fighters.find((f) => f.id === id);

    if (type === undefined) {
        throw new Error(`Unknown fighter type ${id}`);
    }

    return type;
}

export function flakType(content: ContentLibrary, id: string): FlakType {
    const type = content.flak.types.find((f) => f.id === id);

    if (type === undefined) {
        throw new Error(`Unknown flak type ${id}`);
    }

    return type;
}
