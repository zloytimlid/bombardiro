import { createTerrain } from '../geoTerrain';
import { Rng } from '../rng';
import type { TheatreConfig } from '../terrain';
import { fromEnu, toEnu } from './geo';
import type { MissionDefinition } from './schema';
import { parseMission } from './schema';

/**
 * Генератор миссий (раздел 8.5, этап 6): миссия собирается из шаблонов — пул целей театра, маршрут
 * в обход известных зенитных зон с запасом над рельефом, погода в пределах сезона, угрозы по сложности.
 * Результат проходит ту же схему миссии; сид генератора = сид миссии (повторяемость).
 * Цели и зоны ПВО пула — игровые, `placeholder: true`.
 */
export type GeneratorTarget = {
    id: string;
    name: { ru: string; en: string };
    type: 'bridge' | 'rail_yard';
    lat: number;
    lon: number;
    heading_deg: number;
    elevation_m: number;
    heavy_guns: number;
    light_guns: number;
};

export type FlakZone = { id: string; lat: number; lon: number; radius_m: number };

export type GeneratorOptions = {
    seed: number;
    difficulty: 'training' | 'normal' | 'hard';
    /** Месяц (1–12): погода в пределах сезона. */
    month: number;
    targets: GeneratorTarget[];
    flakZones: FlakZone[];
    /** Конкретная цель пула; по умолчанию — случайная. */
    targetId?: string;
};

const BASE = { lat: 42.2, lon: 9.5 };
const TAIL = [
    { id: 'initial', type: 'initial_approach' as const, lat: 42.064344, lon: 9.597009, alt_m: 700 },
    { id: 'final', type: 'final' as const, lat: 42.114085, lon: 9.5, alt_m: 480 },
    { id: 'base', type: 'base' as const, lat: 42.2, lon: 9.5, alt_m: 15 },
];
// Выход из района аэродрома над морем к востоку от Корсики — горы острова на западе.
const DEPARTURE = [
    { id: 'formup', type: 'formup' as const, lat: 42.326612, lon: 9.572757, alt_m: 1200 },
    { id: 'wp1', type: 'turn' as const, lat: 42.75, lon: 9.75, alt_m: 2400 },
    { id: 'cap-corse-n', type: 'turn' as const, lat: 43.15, lon: 9.55, alt_m: 2400 },
];

type P = { x: number; y: number };

function segPointDistance(a: P, b: P, p: P): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));

    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Сезонная погода (Западное Средиземноморье): летом — ясно и слабый ветер, в межсезонье — облачнее. */
function weather(rng: Rng, month: number): MissionDefinition['weather'] {
    const summer = month >= 6 && month <= 9;
    const winter = month <= 2 || month === 12;
    const coverage = summer ? rng.range(0, 0.3) : winter ? rng.range(0.4, 0.8) : rng.range(0.2, 0.5);
    const base = Math.round(rng.range(summer ? 2200 : 1500, summer ? 3200 : 2600) / 100) * 100;
    const from = Math.round(rng.range(250, 360)) % 360;

    return {
        clouds: coverage > 0.05 ? [{ base_m: base, top_m: base + Math.round(rng.range(300, 900) / 100) * 100, coverage: Math.round(coverage * 100) / 100 }] : [],
        visibility_m: Math.round(rng.range(summer ? 25000 : 12000, 40000) / 1000) * 1000,
        wind: [
            { altitude_m: 0, from_deg: from, speed_ms: Math.round(rng.range(2, summer ? 7 : 12)) },
            { altitude_m: 4000, from_deg: (from + Math.round(rng.range(0, 40))) % 360, speed_ms: Math.round(rng.range(8, summer ? 16 : 24)) },
        ],
        turbulence_ms: Math.round(rng.range(0.4, winter ? 1.4 : 1.0) * 10) / 10,
    };
}

export function generateMission(theatre: TheatreConfig, base: MissionDefinition, options: GeneratorOptions): MissionDefinition {
    const rng = new Rng(options.seed);
    const terrain = createTerrain(theatre);
    const enu = (lat: number, lon: number): P => toEnu(theatre, lat, lon);
    const geo = (p: P): { lat: number; lon: number } => {
        const g = fromEnu(theatre, p);

        return { lat: Math.round(g.lat * 1e5) / 1e5, lon: Math.round(g.lon * 1e5) / 1e5 };
    };
    const pool = options.targets;
    const target = (options.targetId ? pool.find((t) => t.id === options.targetId) : undefined) ?? pool[Math.floor(rng.next() * pool.length)];

    if (!target) {
        throw new Error('Generator: empty target pool');
    }

    const tgt = enu(target.lat, target.lon);
    const zones = options.flakZones.map((z) => ({ ...z, at: enu(z.lat, z.lon) }));
    const exposure = (a: P, b: P): number => zones.reduce((s, z) => s + Math.max(0, z.radius_m - segPointDistance(a, b, z.at)), 0);
    const highest = (a: P, b: P): number => {
        let h = 0;

        for (let i = 0; i <= 40; i++) {
            h = Math.max(h, terrain.heightAt(a.x + ((b.x - a.x) * i) / 40, a.y + ((b.y - a.y) * i) / 40));
        }

        return h;
    };
    const legAlt = (a: P, b: P, floor: number): number => Math.max(floor, Math.ceil((highest(a, b) + 1200) / 300) * 300);
    const start = enu(DEPARTURE[2]!.lat, DEPARTURE[2]!.lon);

    // Боевой путь: из 12 направлений — наименьшая встреча с зонами ПВО и рельефом, с небольшой случайностью.
    const runM = rng.range(30000, 45000);
    let best = { ip: tgt, cost: Infinity };

    for (let k = 0; k < 12; k++) {
        const az = (k / 12) * Math.PI * 2;
        const ip = { x: tgt.x + Math.sin(az) * runM, y: tgt.y + Math.cos(az) * runM };
        const cost = exposure(start, ip) * 3 + exposure(ip, tgt) + highest(ip, tgt) * 2 + Math.hypot(ip.x - start.x, ip.y - start.y) * 0.05 + rng.range(0, 2000);

        if (cost < best.cost) {
            best = { ip, cost };
        }
    }

    // Подход к IP: при пересечении зоны ПВО — точка обхода в сторону от центра зоны.
    const route: P[] = [start];
    let cursor = start;

    for (let guard = 0; guard < 4; guard++) {
        const hit = zones.find((z) => segPointDistance(cursor, best.ip, z.at) < z.radius_m);

        if (!hit) {
            break;
        }

        const dx = best.ip.x - cursor.x;
        const dy = best.ip.y - cursor.y;
        const len = Math.hypot(dx, dy) || 1;
        const side = (dx * (hit.at.y - cursor.y) - dy * (hit.at.x - cursor.x)) > 0 ? -1 : 1;
        const detour = { x: hit.at.x + (-dy / len) * side * (hit.radius_m + 8000), y: hit.at.y + (dx / len) * side * (hit.radius_m + 8000) };

        route.push(detour);
        cursor = detour;
    }

    route.push(best.ip);

    const bombAlt = Math.max(3000, Math.ceil((highest(best.ip, tgt) + 1800) / 300) * 300);
    const rally = { x: tgt.x + (tgt.x - best.ip.x) * 0.4, y: tgt.y + (tgt.y - best.ip.y) * 0.4 };
    const legs: MissionDefinition['waypoints'] = [...DEPARTURE];

    route.slice(1, -1).forEach((p, i) => legs.push({ id: `wp${i + 2}`, type: 'turn', ...geo(p), alt_m: legAlt(route[i]!, p, 3000) }));
    legs.push({ id: 'ip', type: 'ip', ...geo(best.ip), alt_m: bombAlt });
    legs.push({ id: 'target', type: 'target', lat: target.lat, lon: target.lon, alt_m: bombAlt });
    legs.push({ id: 'rally', type: 'rally', ...geo(rally), alt_m: legAlt(tgt, rally, bombAlt - 200) });

    // Домой — тем же путём в обратном порядке: его высоты уже проверены.
    const back = [...route].reverse();

    back.forEach((p, i) => legs.push({ id: `back${i + 1}`, type: 'turn', ...geo(p), alt_m: legAlt(i === 0 ? rally : back[i - 1]!, p, 2400) }));
    legs.push({ id: 'cap-corse-back', type: 'turn', lat: 43.15, lon: 9.55, alt_m: 2400 }, { id: 'wp-home', type: 'turn', lat: 42.6, lon: 9.75, alt_m: 1500 }, ...TAIL);

    const all = legs.map((w) => enu(w.lat, w.lon));
    const totalKm = all.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - all[i]!.x, p.y - all[i]!.y), 0) / 1000;
    const toTargetKm = all.slice(1, legs.findIndex((w) => w.type === 'target') + 1).reduce((s, p, i) => s + Math.hypot(p.x - all[i]!.x, p.y - all[i]!.y), 0) / 1000;
    const hard = options.difficulty === 'hard';
    const training = options.difficulty === 'training';
    const sections = Array.from({ length: 6 }, (_, i) => ({ id: `span${i + 1}`, offset_m: [-75 + i * 30, 0] as [number, number], length_m: 30, width_m: 8, strength: 1 }));
    const flak: MissionDefinition['threats']['flak'] = [];

    if (target.heavy_guns > 0) {
        flak.push({ id: 'target-heavy', ...geo({ x: tgt.x + 900, y: tgt.y + 600 }), type: 'heavy', elevation_m: target.elevation_m, guns: training ? 1 : target.heavy_guns + (hard ? 2 : 0), active: true, barrage: hard });
    }

    if (target.light_guns > 0) {
        flak.push({ id: 'target-light', ...geo({ x: tgt.x - 500, y: tgt.y - 300 }), type: 'light', elevation_m: target.elevation_m, guns: target.light_guns, active: !training, barrage: false });
    }

    const waves: MissionDefinition['threats']['fighter_waves'] = training
        ? []
        : [{ id: 'intercept', type: rng.chance(0.5) ? 'bf109g' : 'fw190a', count: hard ? 4 : 2, skill: hard ? 'veteran' : 'experienced', spawn: { bearing_deg: Math.round(rng.range(0, 359)), distance_m: 9000, altitude_offset_m: 700 }, attacks: ['head_on', 'high_six', 'beam'] }];
    const triggers = base.triggers.filter((t) => t.then.every((a) => a.type === 'send_radio'));

    if (waves.length > 0) {
        triggers.push({ id: 't-intercept', once: true, when: { near_waypoint: { id: 'ip', radius_m: 25000 }, probability: hard ? 0.9 : 0.5 }, then: [{ type: 'spawn_wave', wave: 'intercept' }] });
    }

    const name = target.name;
    const mission: MissionDefinition = {
        ...base,
        id: `gen-${options.seed}`,
        version: 1,
        title: { ru: `Вылет: ${name.ru}`, en: `Sortie: ${name.en}` },
        historical_date: null,
        theatre: theatre.slug,
        seed: options.seed,
        difficulty: options.difficulty,
        placeholder: true,
        todo: 'Сгенерированная миссия (этап 6): цели, ПВО и маршрут — игровые значения пула театра',
        weather: weather(rng, options.month),
        time_of_day: `${String(7 + Math.floor(rng.range(0, 6))).padStart(2, '0')}:${String(Math.floor(rng.range(0, 6)) * 10).padStart(2, '0')}`,
        waypoints: [{ id: 'takeoff', type: 'takeoff', lat: BASE.lat, lon: BASE.lon, alt_m: 15 }, ...legs],
        target: { id: target.id, type: target.type, name, aim_point: { lat: target.lat, lon: target.lon }, elevation_m: target.elevation_m, heading_deg: target.heading_deg, sections, destroyed_when: 'any_section' },
        alternate_targets: [],
        time_over_target: { at_s: Math.round(420 + (toTargetKm / 340) * 3600), window_s: 120 },
        formation: { wingmen: 2, spacing_m: 70 },
        loadout: { bombs: [{ type: 'AN-M64', count: 6 }], fuel_kg: 2400, planned_burn_kg: Math.round(totalKm * 1.45) },
        threats: { flak, fighter_waves: waves },
        triggers,
        landmarks: base.landmarks.filter((l) => l.id === 'corsica-coast-south'),
        briefing: {
            general: {
                ru: `Сгенерированный вылет: удар по цели «${name.ru}». Маршрут обходит известные зоны ПВО; боевой путь ${Math.round(runM / 1000)} км, высота над целью около ${bombAlt} м. Возврат тем же путём.`,
                en: `Generated sortie: strike on ${name.en}. The route avoids known flak zones; the bomb run is ${Math.round(runM / 1000)} km at about ${bombAlt} m over the target. Return by the same route.`,
            },
            roles: {
                ...base.briefing.roles,
                bombardier: {
                    ru: `Точка прицеливания — середина цели «${name.ru}». Серия 6 × AN-M64, высота над целью около ${bombAlt - target.elevation_m} м, боевой путь ${Math.round(runM / 1000)} км.`,
                    en: `Aiming point: the middle of ${name.en}. Train of 6 × AN-M64, about ${bombAlt - target.elevation_m} m above the target, ${Math.round(runM / 1000)} km bomb run.`,
                },
                navigator: {
                    ru: `Маршрут: сбор → мыс Корс → ${route.length > 2 ? 'обход зон ПВО → ' : ''}IP → цель → сбор → обратно тем же путём → заход.`,
                    en: `Route: form-up → Cap Corse → ${route.length > 2 ? 'flak avoidance → ' : ''}IP → target → rally → back the same way → approach.`,
                },
            },
        },
        sources: [],
    };

    // Та же схема, что у миссий из resources/sim (раздел 1, правило 5).
    return parseMission(mission);
}
