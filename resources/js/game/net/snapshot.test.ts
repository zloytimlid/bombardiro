import { describe, expect, it } from 'vitest';
import { vec } from '@/sim/core/math';
import { b25j, milkRun, milkRunWorld } from '@/sim/core/testing';
import brennerJson from '../../../sim/missions/brenner.json';
import mtoWestJson from '../../../sim/theatres/mto-west.json';
import { createCrewAI } from '@/sim/core/ai/crew';
import { DEFAULT_CONTENT } from '@/sim/core/content';
import { toEnu } from '@/sim/core/mission/geo';
import { parseMission } from '@/sim/core/mission/schema';
import { CORSICA_ALESAN, parseTheatre, ProceduralTerrain } from '@/sim/core/terrain';
import { MissionWorld } from '@/sim/core/world';
import { cmdSchema, eventSchema, inputSchema, parseMessage, PROTOCOL_VERSION, protocolMismatch, snapSchema } from './schemas';
import { createDecodeState, createEncodeState, decodeSnap, encodeSnap } from './snapshot';

const busyWorld = () => {
    const w = milkRunWorld({ seed: 4, start: { phase: 'route', position: vec(60000, 31000, 3000), heading: 1.5, speedMs: 98, enginesRunning: true, gearDown: false, legIndex: 3 } });
    const extra = { ...milkRun.threats.fighter_waves[0]!, id: 'big', count: 10, skill: 'veteran' as const, attacks: ['head_on' as const, 'beam' as const, 'high_six' as const] };

    (w.mission.threats.fighter_waves as (typeof extra)[]).push(extra);
    w.spawnWave('big');
    w.run(60 * 30);

    return w;
};

describe('client-snap encoding (section 9.2)', () => {
    it('stays within 4 KB even with 10 fighters, tracers and a keyframe', () => {
        const w = busyWorld();
        const enc = createEncodeState();
        const key = JSON.stringify(encodeSnap(w, true, { pilot: 3 }, enc));

        w.step();

        const fast = JSON.stringify(encodeSnap(w, false, { pilot: 3 }, enc));

        console.info(`snapshot sizes: key ${key.length} B, fast ${fast.length} B, fighters ${w.fighters.length}, tracers ${w.bullets.filter((x) => x.tracer).length}`);

        expect(key.length).toBeLessThanOrEqual(4096);
        expect(fast.length).toBeLessThanOrEqual(4096);
        expect(fast.length).toBeLessThan(key.length);
    }, 30000);

    it('stays within 4 KB on the heaviest mission (Brenner: 6 sections, flak alley, 6 fighters)', () => {
        const mission = parseMission(brennerJson);
        const theatre = parseTheatre(mtoWestJson);
        const ip = mission.waypoints.find((x) => x.type === 'ip')!;
        const p = toEnu(theatre, ip.lat, ip.lon);
        const w = new MissionWorld({
            config: b25j,
            content: DEFAULT_CONTENT,
            mission: { ...mission, triggers: [] },
            theatre,
            difficulty: 'historical',
            skill: 'experienced',
            humans: [],
            aiFactory: createCrewAI,
            start: { phase: 'bomb_run', position: vec(p.x, p.y, 4200), heading: 0.15, speedMs: 98, enginesRunning: true, gearDown: false, legIndex: mission.waypoints.indexOf(ip) },
        });

        for (const wave of mission.threats.fighter_waves) {
            w.spawnWave(wave.id);
        }

        let worst = 0;
        const enc = createEncodeState();

        for (let i = 0; i < 40; i++) {
            w.run(30);
            worst = Math.max(worst, JSON.stringify(encodeSnap(w, i % 15 === 0, { pilot: 3 }, enc)).length);
        }

        console.info(`brenner snapshot worst ${worst} B`);
        expect(worst).toBeLessThanOrEqual(4096);
    }, 60000);

    it('round-trips through the schema and decodes with 1 cm / 1e-4 rad precision', () => {
        const w = busyWorld();
        const enc = createEncodeState();
        const dec = createDecodeState();
        const ctx = { config: b25j, terrain: new ProceduralTerrain(CORSICA_ALESAN), weather: { wind: milkRun.weather.wind, turbulence_ms: 0 }, station: 'tail_gunner' as const, targetSections: w.target.sections, targetHeading: w.target.heading };
        const wire = JSON.parse(JSON.stringify(encodeSnap(w, true, {}, enc))) as unknown;
        const msg = parseMessage(snapSchema, wire, 'snap');

        expect(msg).not.toBeNull();

        const view = decodeSnap(msg!, dec, ctx, null);
        const a = w.aircraft;

        expect(view).not.toBeNull();
        expect(Math.abs(view!.aircraft.position.x - a.position.x)).toBeLessThanOrEqual(0.005);
        expect(Math.abs(view!.aircraft.attitude.z - a.attitude.z)).toBeLessThanOrEqual(1e-4);
        expect(view!.fighters).toHaveLength(w.fighters.length);
        expect(view!.mounts.map((m) => m.id)).toEqual(w.mounts.map((m) => m.id));
        expect(view!.phase).toBe(w.phase);
        expect(view!.derived.altitude).toBeCloseTo(w.derived().altitude, 1);
        expect(view!.station).toBe('tail_gunner');

        // Быстрый кадр без ключевого применяется поверх последнего ключевого.
        w.run(10);

        const next = decodeSnap(encodeSnap(w, false, {}, enc), dec, ctx, view);

        expect(next!.tick).toBe(w.tick);
        expect(next!.crew).toEqual(view!.crew);
    }, 30000);

    it('cannot decode before the first keyframe and ignores stale frames', () => {
        const w = milkRunWorld();
        const enc = createEncodeState();
        const dec = createDecodeState();
        const ctx = { config: b25j, terrain: new ProceduralTerrain(CORSICA_ALESAN), weather: { wind: [], turbulence_ms: 0 }, station: 'pilot' as const, targetSections: w.target.sections, targetHeading: w.target.heading };
        const early = encodeSnap(w, false, {}, enc);

        expect(decodeSnap(early, dec, ctx, null)).toBeNull();

        w.run(5);
        expect(decodeSnap(encodeSnap(w, true, {}, enc), dec, ctx, null)).not.toBeNull();
        expect(decodeSnap(early, dec, ctx, null)).toBeNull();
    });
});

describe('protocol messages', () => {
    it('rejects invalid messages and detects a protocol mismatch', () => {
        expect(parseMessage(inputSchema, { v: PROTOCOL_VERSION, s: 'pilot', b: 0, a: [[1, { type: 'gear', down: true }]] }, 'input')).not.toBeNull();
        expect(parseMessage(inputSchema, { v: PROTOCOL_VERSION, s: 'pilot', b: 'x', a: [] }, 'input')).toBeNull();
        expect(parseMessage(cmdSchema, { v: PROTOCOL_VERSION, type: 'chat', from: 1, seq: 1, text: '' }, 'cmd')).toBeNull();
        expect(protocolMismatch({ v: PROTOCOL_VERSION + 1 })).toBe(true);
        expect(protocolMismatch({ v: PROTOCOL_VERSION })).toBe(false);
    });

    it('accepts empty records that Reverb re-encoded as empty arrays', () => {
        const ok = parseMessage(eventSchema, { v: PROTOCOL_VERSION, e: [{ seq: 1, tick: 0, type: 'phase', payload: [] }] }, 'event');

        expect(ok?.e[0]?.payload).toEqual({});
    });
});
