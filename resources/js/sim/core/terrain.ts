import { z } from 'zod';
import corsicaJson from '../../../sim/theatres/corsica.json';
import { clamp } from './math';
import { valueNoise2 } from './rng';

/**
 * Рельеф для физики: высота и тип поверхности в точке ENU театра.
 * Рендер строит сетку по той же функции, поэтому физика и картинка совпадают.
 */
export interface Terrain {
    heightAt(x: number, y: number): number;
    isWater(x: number, y: number): boolean;
}

export type Runway = {
    id: string;
    /** Центр полосы в ENU, м. */
    x: number;
    y: number;
    /** Магнитный курс посадки не учитываем: истинный курс по направлению «вперёд», рад. */
    heading: number;
    length_m: number;
    width_m: number;
    elevation_m: number;
};

export const theatreSchema = z.object({
    slug: z.string(),
    origin_lat: z.number(),
    origin_lon: z.number(),
    placeholder: z.boolean(),
    seed: z.number().int(),
    /** Расстояние от аэродрома до береговой линии на восток, м. */
    coast_east_m: z.number(),
    /** Где начинаются горы на западе, м (отрицательный x). */
    mountains_start_m: z.number(),
    mountains_peak_m: z.number(),
    /** Берег материка на востоке (Италия), м; null — только остров. */
    mainland_coast_x_m: z.number().nullable().default(null),
    runways: z
        .array(
            z.object({
                id: z.string(),
                x: z.number(),
                y: z.number(),
                heading: z.number(),
                length_m: z.number().positive(),
                width_m: z.number().positive(),
                elevation_m: z.number(),
            }),
        )
        .min(1),
});

export type TheatreConfig = z.infer<typeof theatreSchema>;

/**
 * Театр «Корсика, Алезани» — процедурная заглушка до офлайн-нарезки Copernicus DEM (раздел 4).
 * Плоская прибрежная равнина, море на востоке, горы на западе. Данные — resources/sim/theatres/corsica.json.
 */
export const CORSICA_ALESAN: TheatreConfig = parseTheatre(corsicaJson);

export function parseTheatre(input: unknown): TheatreConfig {
    return theatreSchema.parse(input);
}

const smoothstep = (e0: number, e1: number, x: number): number => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);

    return t * t * (3 - 2 * t);
};

export class ProceduralTerrain implements Terrain {
    constructor(private readonly theatre: TheatreConfig) {}

    get runways(): Runway[] {
        return this.theatre.runways;
    }

    private coastX(y: number): number {
        return this.theatre.coast_east_m + 900 * valueNoise2(this.theatre.seed, 0.37, y / 6000);
    }

    private mainlandX(y: number): number {
        const m = this.theatre.mainland_coast_x_m;

        return m === null ? Infinity : m + 1500 * valueNoise2(this.theatre.seed + 9, 0.71, y / 9000);
    }

    heightAt(x: number, y: number): number {
        const t = this.theatre;
        const coast = this.coastX(y);
        const mainland = this.mainlandX(y);

        if (x > mainland) {
            // Материк: прибрежная равнина и холмы вглубь (заглушка до DEM).
            const inland = x - mainland;

            return (
                8 * smoothstep(0, 1500, inland) +
                220 * smoothstep(4000, 20000, inland) * (0.6 + 0.4 * valueNoise2(t.seed + 11, x / 3000, y / 3000)) +
                25 * smoothstep(800, 3000, inland) * (0.5 + 0.5 * valueNoise2(t.seed + 12, x / 900, y / 900))
            );
        }

        if (x > coast) {
            return 0;
        }

        // Прибрежная равнина: плавный подъём от моря.
        const plain = t.runways[0]?.elevation_m ?? 10;
        let h = plain * smoothstep(coast, coast - 2500, x);

        // Холмы и горы на запад.
        const hills = 60 * smoothstep(-2500, -6000, x) * (0.5 + 0.5 * valueNoise2(t.seed + 1, x / 1500, y / 1500));
        const ridge = smoothstep(t.mountains_start_m, t.mountains_start_m - 18000, x);
        const relief =
            0.55 * valueNoise2(t.seed + 2, x / 7000, y / 7000) +
            0.3 * valueNoise2(t.seed + 3, x / 2500, y / 2500) +
            0.15 * valueNoise2(t.seed + 4, x / 900, y / 900);

        h += hills + ridge * t.mountains_peak_m * clamp(0.65 + 0.5 * relief, 0, 1.2);

        // Площадка аэродрома выровнена.
        for (const runway of t.runways) {
            const dx = x - runway.x;
            const dy = y - runway.y;
            const along = dx * Math.sin(runway.heading) + dy * Math.cos(runway.heading);
            const across = dx * Math.cos(runway.heading) - dy * Math.sin(runway.heading);
            const inside =
                smoothstep(runway.length_m / 2 + 900, runway.length_m / 2 + 200, Math.abs(along)) *
                smoothstep(runway.width_m / 2 + 600, runway.width_m / 2 + 150, Math.abs(across));

            h = h + (runway.elevation_m - h) * inside;
        }

        return h;
    }

    isWater(x: number, y: number): boolean {
        return x > this.coastX(y) && x <= this.mainlandX(y);
    }
}

/** Плоская земля — для изолированных тестов физики. */
export class FlatTerrain implements Terrain {
    constructor(private readonly elevation = 0) {}

    heightAt(): number {
        return this.elevation;
    }

    isWater(): boolean {
        return false;
    }
}
