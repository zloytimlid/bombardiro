import type { Skill } from '../../content';

/**
 * Уровни ИИ-экипажа «новичок / опытный / ветеран» (раздел 6): время реакции, точность,
 * скорость синхронизации прицела, ошибки навигации и расшифровки. Все числа — игровые.
 */
export type CrewSkillProfile = {
    reactionS: number;
    /** Ошибка наведения пулемёта, мрад (СКО). */
    aimErrorMrad: number;
    /** Постоянная времени синхронизации прицела, с, и остаточная ошибка оценки скорости/сноса (доля, рад). */
    syncTauS: number;
    syncRateBias: number;
    syncDriftBiasRad: number;
    /** Ошибка ввода высоты в прицел (доля). */
    altitudeErrorShare: number;
    /** Ошибка измерения сноса визиром, рад, и путевой скорости (доля). */
    driftErrorRad: number;
    groundSpeedErrorShare: number;
    decodeErrorChance: number;
    /** Ошибка «на глаз» при отказе прицела (доля дальности). */
    eyeballErrorShare: number;
};

export const SKILL_PROFILES: Record<Skill, CrewSkillProfile> = {
    novice: {
        reactionS: 2.5,
        aimErrorMrad: 12,
        syncTauS: 22,
        syncRateBias: 0.012,
        syncDriftBiasRad: 0.006,
        altitudeErrorShare: 0.012,
        driftErrorRad: 0.025,
        groundSpeedErrorShare: 0.04,
        decodeErrorChance: 0.12,
        eyeballErrorShare: 0.12,
    },
    experienced: {
        reactionS: 1.4,
        aimErrorMrad: 7,
        syncTauS: 14,
        syncRateBias: 0.005,
        syncDriftBiasRad: 0.003,
        altitudeErrorShare: 0.006,
        driftErrorRad: 0.015,
        groundSpeedErrorShare: 0.025,
        decodeErrorChance: 0.04,
        eyeballErrorShare: 0.07,
    },
    veteran: {
        reactionS: 0.8,
        aimErrorMrad: 4,
        syncTauS: 9,
        syncRateBias: 0.002,
        syncDriftBiasRad: 0.0015,
        altitudeErrorShare: 0.003,
        driftErrorRad: 0.008,
        groundSpeedErrorShare: 0.012,
        decodeErrorChance: 0.01,
        eyeballErrorShare: 0.04,
    },
};

/** Задержка реакции: копит время, пока условие держится. */
export class Reaction {
    private elapsed = 0;

    constructor(private readonly delayS: number) {}

    /** true, когда условие держится дольше задержки. */
    update(condition: boolean, dt: number): boolean {
        this.elapsed = condition ? this.elapsed + dt : 0;

        return this.elapsed >= this.delayS;
    }

    reset(): void {
        this.elapsed = 0;
    }
}
