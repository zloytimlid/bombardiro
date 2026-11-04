import type { AircraftDerived, AircraftInput, AircraftState } from '../aircraft';
import { clamp, wrapPi } from '../math';
import type { Runway } from '../terrain';
import type { AutopilotTargets } from './autopilot';
import { Autopilot } from './autopilot';

/**
 * Полёт по кругу ИИ-пилотом: взлёт, левый круг, заход по глиссаде 3°, посадка, пробег.
 * Это сценарий обучающего полёта этапа 1 и основа дерева поведения пилота (этап 2).
 */
export type CircuitPhase =
    | 'takeoff_roll'
    | 'rotate'
    | 'climb'
    | 'crosswind'
    | 'downwind'
    | 'base'
    | 'final'
    | 'flare'
    | 'rollout'
    | 'stopped';

export type CircuitOptions = {
    runway: Runway;
    patternAltitudeAgl: number;
    rotateSpeed: number;
    climbSpeed: number;
    patternSpeed: number;
    approachSpeed: number;
    /** Ширина круга (смещение посадочной прямой от траверза), м. */
    patternWidth: number;
    /** Длина посадочной прямой до торца, м. */
    finalLength: number;
};

export const defaultCircuit = (runway: Runway): CircuitOptions => ({
    runway,
    patternAltitudeAgl: 400,
    rotateSpeed: 52,
    climbSpeed: 62,
    patternSpeed: 72,
    approachSpeed: 58,
    patternWidth: 2600,
    finalLength: 5000,
});

const GLIDE = (3 * Math.PI) / 180;

export class CircuitPilot {
    phase: CircuitPhase = 'takeoff_roll';
    private readonly ap = new Autopilot();
    private phaseTime = 0;

    constructor(private readonly options: CircuitOptions) {}

    /** Координаты в системе полосы: along — вдоль курса от центра, across — вправо. */
    private runwayFrame(x: number, y: number): { along: number; across: number } {
        const r = this.options.runway;
        const dx = x - r.x;
        const dy = y - r.y;

        return {
            along: dx * Math.sin(r.heading) + dy * Math.cos(r.heading),
            across: dx * Math.cos(r.heading) - dy * Math.sin(r.heading),
        };
    }

    private headingTo(from: { along: number; across: number }, to: { along: number; across: number }): number {
        const r = this.options.runway;
        const local = Math.atan2(to.across - from.across, to.along - from.along);

        return wrapPi(r.heading + local);
    }

    private setPhase(phase: CircuitPhase): void {
        this.phase = phase;
        this.phaseTime = 0;
    }

    update(state: AircraftState, d: AircraftDerived, dt: number): AircraftInput {
        const o = this.options;
        const r = o.runway;
        const pos = this.runwayFrame(state.position.x, state.position.y);
        const threshold = -r.length_m / 2;
        const touchdown = threshold + 300;
        const patternAlt = r.elevation_m + o.patternAltitudeAgl;
        // Курс на ось полосы с поправкой на боковое уклонение.
        const centerlineHeading = (gain: number): number => wrapPi(r.heading - clamp(Math.atan(pos.across / gain), -0.5, 0.5));

        this.phaseTime += dt;

        let t: AutopilotTargets;

        switch (this.phase) {
            case 'takeoff_roll':
                t = { throttle: 1, heading: centerlineHeading(60), pitch: 0, flaps: 0.25, gearDown: true };

                if (d.indicatedAirspeed > o.rotateSpeed) {
                    this.setPhase('rotate');
                }
                break;
            case 'rotate':
                t = { throttle: 1, heading: centerlineHeading(60), pitch: 0.12, flaps: 0.25, gearDown: true };

                if (state.contact === 'air' && d.agl > 8) {
                    this.setPhase('climb');
                }
                break;
            case 'climb':
                t = {
                    throttle: 1,
                    heading: centerlineHeading(200),
                    airspeedByPitch: o.climbSpeed,
                    gearDown: d.agl < 30,
                    flaps: d.agl < 120 ? 0.25 : 0,
                };

                if (d.altitude > patternAlt - 120 && pos.along > r.length_m / 2 + 1200) {
                    this.setPhase('crosswind');
                }
                break;
            case 'crosswind': {
                const target = { along: pos.along + 600, across: -o.patternWidth };

                t = { altitude: patternAlt, heading: this.headingTo(pos, target), airspeed: o.patternSpeed, gearDown: false, flaps: 0 };

                if (pos.across < -o.patternWidth + 400) {
                    this.setPhase('downwind');
                }
                break;
            }
            case 'downwind': {
                const target = { along: threshold - o.finalLength, across: -o.patternWidth };

                t = {
                    altitude: patternAlt,
                    heading: this.headingTo(pos, target),
                    airspeed: o.patternSpeed,
                    gearDown: pos.along < threshold,
                    flaps: pos.along < threshold ? 0.4 : 0,
                };

                if (pos.along < threshold - o.finalLength + 900) {
                    this.setPhase('base');
                }
                break;
            }
            case 'base': {
                const target = { along: threshold - o.finalLength - 300, across: 0 };

                t = {
                    altitude: Math.max(r.elevation_m + (o.finalLength + 300) * Math.tan(GLIDE), patternAlt - 120),
                    heading: this.headingTo(pos, target),
                    airspeed: o.approachSpeed + 8,
                    gearDown: true,
                    flaps: 0.6,
                };

                if (pos.across > -500) {
                    this.setPhase('final');
                }
                break;
            }
            case 'final': {
                const distance = touchdown - pos.along;
                const glideAlt = r.elevation_m + Math.max(distance, 0) * Math.tan(GLIDE);
                const glideVs = -d.trueAirspeed * Math.tan(GLIDE);

                t = {
                    verticalSpeed: clamp(glideVs + 0.15 * (glideAlt - d.altitude), -6, 2),
                    heading: centerlineHeading(250),
                    airspeed: o.approachSpeed,
                    gearDown: true,
                    flaps: 1,
                    maxBank: 0.35,
                };

                if (d.agl < 9) {
                    this.setPhase('flare');
                }
                break;
            }
            case 'flare':
                t = {
                    verticalSpeed: clamp(-0.12 * d.agl - 0.4, -1.6, -0.4),
                    heading: centerlineHeading(250),
                    throttle: 0,
                    gearDown: true,
                    flaps: 1,
                    maxBank: 0.1,
                };

                if (state.contact === 'gear') {
                    this.setPhase('rollout');
                }
                break;
            case 'rollout':
                t = {
                    throttle: 0,
                    heading: centerlineHeading(60),
                    pitch: this.phaseTime < 2 ? d.pitch * 0.5 : -0.05,
                    gearDown: true,
                    flaps: 1,
                    brakes: this.phaseTime > 2 ? 0.7 : 0,
                };

                if (d.trueAirspeed < 1.5) {
                    this.setPhase('stopped');
                }
                break;
            case 'stopped':
                t = { throttle: 0, gearDown: true, flaps: 0, brakes: 1 };
                break;
        }

        return this.ap.update(state, d, t, dt);
    }
}
