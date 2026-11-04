import type { Vec3 } from './math';
import { clamp, lerp, vec } from './math';
import { valueNoise2 } from './rng';

/** Международная стандартная атмосфера (до 20 км). */
export const SEA_LEVEL = { temperatureK: 288.15, pressurePa: 101325, density: 1.225 } as const;
export const GRAVITY = 9.80665;
const R_AIR = 287.05287;
const LAPSE = 0.0065;
const TROPOPAUSE_M = 11000;

export type AtmosphereSample = { temperatureK: number; pressurePa: number; density: number; speedOfSound: number };

export function isa(altitudeM: number): AtmosphereSample {
    const h = clamp(altitudeM, -500, 20000);
    let temperatureK: number;
    let pressurePa: number;

    if (h <= TROPOPAUSE_M) {
        temperatureK = SEA_LEVEL.temperatureK - LAPSE * h;
        pressurePa = SEA_LEVEL.pressurePa * Math.pow(temperatureK / SEA_LEVEL.temperatureK, GRAVITY / (R_AIR * LAPSE));
    } else {
        const t11 = SEA_LEVEL.temperatureK - LAPSE * TROPOPAUSE_M;
        const p11 = SEA_LEVEL.pressurePa * Math.pow(t11 / SEA_LEVEL.temperatureK, GRAVITY / (R_AIR * LAPSE));

        temperatureK = t11;
        pressurePa = p11 * Math.exp((-GRAVITY * (h - TROPOPAUSE_M)) / (R_AIR * t11));
    }

    return {
        temperatureK,
        pressurePa,
        density: pressurePa / (R_AIR * temperatureK),
        speedOfSound: Math.sqrt(1.4 * R_AIR * temperatureK),
    };
}

export const PA_PER_INHG = 3386.389;

/** Слой ветра из конфига миссии: направление, ОТКУДА дует (градусы), скорость м/с. */
export type WindLayer = { altitude_m: number; from_deg: number; speed_ms: number };

export type WeatherConfig = {
    wind: WindLayer[];
    /** Интенсивность турбулентности, м/с СКО порывов. */
    turbulence_ms: number;
};

export const calmWeather = (): WeatherConfig => ({ wind: [], turbulence_ms: 0 });

/** Вектор ветра (куда движется воздух) в ENU на высоте; линейная интерполяция по слоям. */
export function windAt(weather: WeatherConfig, altitudeM: number): Vec3 {
    const layers = [...weather.wind].sort((a, b) => a.altitude_m - b.altitude_m);

    if (layers.length === 0) {
        return vec();
    }

    let fromDeg = layers[0]!.from_deg;
    let speed = layers[0]!.speed_ms;

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i]!;
        const next = layers[i + 1];

        if (altitudeM <= layer.altitude_m) {
            fromDeg = layer.from_deg;
            speed = layer.speed_ms;
            break;
        }

        if (next === undefined) {
            fromDeg = layer.from_deg;
            speed = layer.speed_ms;
            break;
        }

        if (altitudeM < next.altitude_m) {
            const t = (altitudeM - layer.altitude_m) / (next.altitude_m - layer.altitude_m);
            let delta = next.from_deg - layer.from_deg;

            delta = ((delta + 540) % 360) - 180;
            fromDeg = layer.from_deg + delta * t;
            speed = lerp(layer.speed_ms, next.speed_ms, t);
            break;
        }
    }

    const toRad = ((fromDeg + 180) * Math.PI) / 180;

    return vec(Math.sin(toRad) * speed, Math.cos(toRad) * speed, 0);
}

/** Турбулентность как сид-шум по пространству и времени (раздел 7.1). */
export function turbulenceAt(weather: WeatherConfig, seed: number, position: Vec3, timeS: number): Vec3 {
    const sigma = weather.turbulence_ms;

    if (sigma <= 0) {
        return vec();
    }

    const sx = position.x / 120 + timeS * 0.35;
    const sy = position.y / 120 - timeS * 0.21;

    return vec(
        sigma * valueNoise2(seed ^ 0x1111, sx, sy),
        sigma * valueNoise2(seed ^ 0x2222, sy, sx),
        sigma * 0.6 * valueNoise2(seed ^ 0x3333, sx + position.z / 200, sy),
    );
}
