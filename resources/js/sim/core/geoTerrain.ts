import { clamp } from './math';
import { toEnu } from './mission/geo';
import { valueNoise2 } from './rng';
import type { GeographyConfig } from './geographySchema';
import type { Runway, Terrain, TheatreConfig } from './terrain';
import { ProceduralTerrain } from './terrain';

/**
 * Рельеф больших театров (этап 4: юг Франции и север Италии) — процедурная заглушка до нарезки DEM:
 * суша — по грубым полигонам береговой линии (широта/долгота), горы — гребни-полилинии с высотой
 * вершин и полушириной, долины и перевалы — понижения. Числа — общая география, точность ~5–10 км,
 * театр помечен placeholder. Сетка расстояний считается один раз (шаг `grid_m`), высота — билинейно + шум.
 */

type P = { x: number; y: number };
type Segment = { a: P; b: P };

const smoothstep = (e0: number, e1: number, x: number): number => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);

    return t * t * (3 - 2 * t);
};

function segDistance(p: P, s: Segment): { d: number; t: number } {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : clamp(((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2, 0, 1);

    return { d: Math.hypot(p.x - (s.a.x + t * dx), p.y - (s.a.y + t * dy)), t };
}

function pointInPolygon(p: P, poly: P[]): boolean {
    let inside = false;

    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!;
        const b = poly[j]!;

        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }

    return inside;
}

/** Сетка поля по театру: значение в узлах, выборка — билинейная. */
class Grid {
    readonly values: Float32Array;

    constructor(
        readonly minX: number,
        readonly minY: number,
        readonly step: number,
        readonly nx: number,
        readonly ny: number,
    ) {
        this.values = new Float32Array(nx * ny);
    }

    sample(x: number, y: number): number {
        const fx = clamp((x - this.minX) / this.step, 0, this.nx - 1.001);
        const fy = clamp((y - this.minY) / this.step, 0, this.ny - 1.001);
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const v = this.values;
        const i = iy * this.nx + ix;
        const a = v[i]! + (v[i + 1]! - v[i]!) * tx;
        const b = v[i + this.nx]! + (v[i + this.nx + 1]! - v[i + this.nx]!) * tx;

        return a + (b - a) * ty;
    }
}

export class GeoTerrain implements Terrain {
    /** Знаковое расстояние до берега, м: > 0 — суша. */
    private readonly coast: Grid;
    /** Высота гор и долин без мелкого шума, м. */
    private readonly relief: Grid;

    constructor(
        private readonly theatre: TheatreConfig,
        private readonly geo: GeographyConfig,
        bounds: { min_x: number; max_x: number; min_y: number; max_y: number },
    ) {
        const enu = ([lat, lon]: [number, number]): P => toEnu(theatre, lat, lon);
        const polys = geo.land.map((poly) => poly.map(enu));
        const coastSegs: Segment[] = polys.flatMap((poly) => poly.map((a, i) => ({ a, b: poly[(i + 1) % poly.length]! })));
        // Рамка полилинии с запасом полуширины — дешёвый отсев узлов сетки.
        const withBox = <T extends { points: [number, number][]; half_width_m: number }>(r: T) => {
            const segs = r.points.slice(1).map((p, i) => ({ a: enu(r.points[i]!), b: enu(p) }));
            const xs = segs.flatMap((s) => [s.a.x, s.b.x]);
            const ys = segs.flatMap((s) => [s.a.y, s.b.y]);

            return { ...r, segs, box: { x0: Math.min(...xs) - r.half_width_m, x1: Math.max(...xs) + r.half_width_m, y0: Math.min(...ys) - r.half_width_m, y1: Math.max(...ys) + r.half_width_m } };
        };
        const inBox = (p: P, b: { x0: number; x1: number; y0: number; y1: number }): boolean => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
        const ridges = geo.ridges.map(withBox);
        const valleys = geo.valleys.map(withBox);
        const passes = geo.passes.map((p) => ({ ...p, at: enu([p.lat, p.lon]) }));
        const step = geo.grid_m;
        const nx = Math.ceil((bounds.max_x - bounds.min_x) / step) + 2;
        const ny = Math.ceil((bounds.max_y - bounds.min_y) / step) + 2;

        this.coast = new Grid(bounds.min_x, bounds.min_y, step, nx, ny);
        this.relief = new Grid(bounds.min_x, bounds.min_y, step, nx, ny);

        // Грубый отбор отрезков берега по ячейкам 50 км — иначе 200 тыс. узлов × сотни отрезков.
        const bucket = 50000;
        const buckets = new Map<string, Segment[]>();

        for (const s of coastSegs) {
            const x0 = Math.floor(Math.min(s.a.x, s.b.x) / bucket);
            const x1 = Math.floor(Math.max(s.a.x, s.b.x) / bucket);
            const y0 = Math.floor(Math.min(s.a.y, s.b.y) / bucket);
            const y1 = Math.floor(Math.max(s.a.y, s.b.y) / bucket);

            for (let bx = x0; bx <= x1; bx++) {
                for (let by = y0; by <= y1; by++) {
                    const key = `${bx},${by}`;

                    buckets.set(key, [...(buckets.get(key) ?? []), s]);
                }
            }
        }

        const nearCoast = (p: P): number => {
            const bx = Math.floor(p.x / bucket);
            const by = Math.floor(p.y / bucket);
            let best = Infinity;

            for (let r = 0; r <= 4 && (best === Infinity || best > (r - 1) * bucket); r++) {
                for (let dx = -r; dx <= r; dx++) {
                    for (let dy = -r; dy <= r; dy++) {
                        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) {
                            continue;
                        }

                        for (const s of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
                            best = Math.min(best, segDistance(p, s).d);
                        }
                    }
                }
            }

            return Math.min(best, 4 * bucket);
        };

        for (let iy = 0; iy < ny; iy++) {
            for (let ix = 0; ix < nx; ix++) {
                const p = { x: bounds.min_x + ix * step, y: bounds.min_y + iy * step };
                const land = polys.some((poly) => pointInPolygon(p, poly));
                const d = nearCoast(p);
                const i = iy * nx + ix;

                this.coast.values[i] = land ? d : -d;

                // Над морем рельеф не нужен.
                if (!land) {
                    continue;
                }

                // Горы: максимум вкладов гребней (профиль — косинус по расстоянию до оси).
                let mountains = 0;

                for (const r of ridges) {
                    if (!inBox(p, r.box)) {
                        continue;
                    }

                    let dmin = Infinity;

                    for (const s of r.segs) {
                        dmin = Math.min(dmin, segDistance(p, s).d);
                    }

                    if (dmin < r.half_width_m) {
                        mountains = Math.max(mountains, r.peak_m * (0.5 + 0.5 * Math.cos((Math.PI * dmin) / r.half_width_m)));
                    }
                }

                let h = mountains;

                // Долины: тянут высоту к дну долины (Рона, По, Адидже).
                for (const v of valleys) {
                    if (!inBox(p, v.box)) {
                        continue;
                    }

                    let dmin = Infinity;

                    for (const s of v.segs) {
                        dmin = Math.min(dmin, segDistance(p, s).d);
                    }

                    const w = smoothstep(v.half_width_m, v.half_width_m * 0.35, dmin);

                    h = h + (Math.min(h, v.floor_m) - h) * w;
                }

                // Перевалы — седловины в гребне.
                for (const pass of passes) {
                    const w = smoothstep(pass.radius_m, pass.radius_m * 0.25, Math.hypot(p.x - pass.at.x, p.y - pass.at.y));

                    h = h + (Math.min(h, pass.height_m) - h) * w;
                }

                this.relief.values[i] = h;
            }
        }
    }

    get runways(): Runway[] {
        return this.theatre.runways;
    }

    heightAt(x: number, y: number): number {
        const seed = this.theatre.seed;
        // Береговая линия «рвётся» шумом, чтобы не было прямых отрезков полигона.
        const coast = this.coast.sample(x, y) + 750 * valueNoise2(seed + 21, x / 7000, y / 7000);

        if (coast <= 0) {
            return 0;
        }

        const plain = this.geo.coastal_plain_height_m * smoothstep(0, this.geo.coastal_plain_m, coast);
        const mountains = this.relief.sample(x, y) * smoothstep(0, 8000, coast);
        const relief =
            0.55 * valueNoise2(seed + 2, x / 7000, y / 7000) + 0.3 * valueNoise2(seed + 3, x / 2500, y / 2500) + 0.15 * valueNoise2(seed + 4, x / 900, y / 900);
        const hills = 80 * smoothstep(1500, 12000, coast) * (0.7 + 0.3 * valueNoise2(seed + 1, x / 3000, y / 3000));
        // Шум в [-1, 1]: вершины гуляют в пределах −34…+10 % от высоты гребня.
        let h = plain + hills + mountains * clamp(0.88 + 0.22 * relief, 0.5, 1.1);

        // Площадки аэродромов выровнены.
        for (const runway of this.theatre.runways) {
            const dx = x - runway.x;
            const dy = y - runway.y;
            const along = dx * Math.sin(runway.heading) + dy * Math.cos(runway.heading);
            const across = dx * Math.cos(runway.heading) - dy * Math.sin(runway.heading);
            const inside =
                smoothstep(runway.length_m / 2 + 900, runway.length_m / 2 + 200, Math.abs(along)) * smoothstep(runway.width_m / 2 + 600, runway.width_m / 2 + 150, Math.abs(across));

            h = h + (runway.elevation_m - h) * inside;
        }

        return Math.max(h, 1);
    }

    isWater(x: number, y: number): boolean {
        return this.coast.sample(x, y) + 750 * valueNoise2(this.theatre.seed + 21, x / 7000, y / 7000) <= 0;
    }
}

/** Рельеф театра: большой — по географии, иначе — процедурный остров с аэродромом. */
export function createTerrain(theatre: TheatreConfig): Terrain & { readonly runways: Runway[] } {
    if (theatre.geography !== undefined) {
        const bounds = theatre.bounds ?? { min_x: -200000, max_x: 200000, min_y: -200000, max_y: 200000 };

        return new GeoTerrain(theatre, theatre.geography, bounds);
    }

    return new ProceduralTerrain(theatre);
}
