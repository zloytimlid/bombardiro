import type { Vec3 } from '../math';
import { vec } from '../math';

/**
 * Перевод широты/долготы миссии в локальную систему ENU театра (раздел 10: origin_lat/lon).
 * Равнопромежуточная проекция — ошибка < 0,5% на сотне километров, этого достаточно для игры.
 */
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON_EQUATOR = 111320;

export type GeoOrigin = { origin_lat: number; origin_lon: number };

export function toEnu(origin: GeoOrigin, lat: number, lon: number, alt = 0): Vec3 {
    const k = Math.cos((origin.origin_lat * Math.PI) / 180);

    return vec((lon - origin.origin_lon) * M_PER_DEG_LON_EQUATOR * k, (lat - origin.origin_lat) * M_PER_DEG_LAT, alt);
}

export function fromEnu(origin: GeoOrigin, p: { x: number; y: number }): { lat: number; lon: number } {
    const k = Math.cos((origin.origin_lat * Math.PI) / 180);

    return { lat: origin.origin_lat + p.y / M_PER_DEG_LAT, lon: origin.origin_lon + p.x / (M_PER_DEG_LON_EQUATOR * k) };
}

/** Истинный курс от точки a к точке b (0 — север, по часовой), рад. */
export function bearing(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.atan2(b.x - a.x, b.y - a.y);
}

export function distance2(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
}
