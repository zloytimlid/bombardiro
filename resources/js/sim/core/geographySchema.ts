import { z } from 'zod';

/**
 * География больших театров (этап 4): полигоны суши, оси хребтов, долины, перевалы — широта/долгота.
 * Отдельный модуль, чтобы схема театра (terrain.ts) и рельеф (geoTerrain.ts) не зависели друг от друга по кругу.
 */
const latLon = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

export const geographySchema = z.object({
    grid_m: z.number().positive().default(2000),
    /** Полигоны суши по часовой или против — неважно; внутренние озёра не поддерживаются. */
    land: z.array(z.array(latLon).min(3)).min(1),
    ridges: z.array(z.object({ name: z.string(), points: z.array(latLon).min(2), peak_m: z.number().positive(), half_width_m: z.number().positive() })).default([]),
    valleys: z.array(z.object({ name: z.string(), points: z.array(latLon).min(2), floor_m: z.number(), half_width_m: z.number().positive() })).default([]),
    passes: z.array(z.object({ name: z.string(), lat: z.number(), lon: z.number(), height_m: z.number(), radius_m: z.number().positive() })).default([]),
    /** Прибрежная равнина: ширина подъёма от уреза воды и высота её края, м. */
    coastal_plain_m: z.number().positive().default(6000),
    coastal_plain_height_m: z.number().default(60),
});

export type GeographyConfig = z.infer<typeof geographySchema>;
