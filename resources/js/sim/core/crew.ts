import type { Station } from './config';
import { STATIONS } from './config';
import type { Skill } from './content';

/**
 * Экипаж (раздел 6.7): 8 мест, ранения, занятость, СПУ и круговой индикатор угроз.
 * Без натуралистичных сцен: тяжёлое ранение = член экипажа выбывает из строя.
 */
export type Health = 'ok' | 'wounded' | 'incapacitated';

export type CrewTaskKind = 'extinguish' | 'first_aid' | 'emergency_gear' | 'fuel_transfer';

export type CrewTask = {
    kind: CrewTaskKind;
    remainingS: number;
    /** Станция раненого (первая помощь) или бак (перекачка). */
    target: string | null;
};

export type CrewMember = {
    station: Station;
    health: Health;
    /** Эффективность станции 0..1: ранение, гипоксия; первая помощь возвращает часть. */
    efficiency: number;
    controller: 'ai' | 'human';
    skill: Skill;
    treated: boolean;
    bailedOut: boolean;
    /** Тик, когда ИИ прыгнет (задержка 2–5 с после команды). */
    bailOutAtTick: number | null;
    task: CrewTask | null;
};

export type IntercomSpeaker = Station | 'tower' | 'base' | 'system';

/** Сообщение СПУ: ключ из каталога фраз (lang/*.json → intercom.*) и параметры. */
export type IntercomMessage = {
    tick: number;
    from: IntercomSpeaker;
    key: string;
    params: Record<string, string | number>;
};

export type ThreatMarker = {
    id: number;
    /** Направление по часовой системе 1–12 относительно носа. */
    clock: number;
    level: 'high' | 'level' | 'low';
    kind: 'fighter' | 'flak';
    reportedBy: Station;
    expiresTick: number;
};

export type CrewState = {
    members: Record<Station, CrewMember>;
    intercom: IntercomMessage[];
    threats: ThreatMarker[];
    nextThreatId: number;
    /** Кто сейчас пилотирует: пилот или второй пилот («Взял управление»). */
    flyingStation: 'pilot' | 'copilot';
    takeControlRequestedTick: number | null;
    bailOutOrdered: boolean;
    prepareBailOut: boolean;
    oxygenOn: boolean;
};

const WOUNDED_EFFICIENCY = 0.55;
const TREATED_EFFICIENCY = 0.8;
export const INTERCOM_KEEP = 40;
export const THREAT_TTL_S = 10;

export function createCrew(skill: Skill, humans: Station[] = []): CrewState {
    const members = {} as Record<Station, CrewMember>;

    for (const station of STATIONS) {
        members[station] = {
            station,
            health: 'ok',
            efficiency: 1,
            controller: humans.includes(station) ? 'human' : 'ai',
            skill,
            treated: false,
            bailedOut: false,
            bailOutAtTick: null,
            task: null,
        };
    }

    return {
        members,
        intercom: [],
        threats: [],
        nextThreatId: 1,
        flyingStation: 'pilot',
        takeControlRequestedTick: null,
        bailOutOrdered: false,
        prepareBailOut: false,
        oxygenOn: true,
    };
}

/** Может ли станция работать: в строю, на борту, не занята ремонтом. */
export function isActive(member: CrewMember): boolean {
    return member.health !== 'incapacitated' && !member.bailedOut;
}

export function isAvailable(member: CrewMember): boolean {
    return isActive(member) && member.task === null;
}

export function say(crew: CrewState, tick: number, from: IntercomSpeaker, key: string, params: Record<string, string | number> = {}): void {
    crew.intercom.push({ tick, from, key, params });

    if (crew.intercom.length > INTERCOM_KEEP) {
        crew.intercom.splice(0, crew.intercom.length - INTERCOM_KEEP);
    }
}

export function wound(crew: CrewState, station: Station, heavy: boolean, tick: number): void {
    const member = crew.members[station];

    if (!isActive(member)) {
        return;
    }

    if (heavy || member.health === 'wounded') {
        member.health = 'incapacitated';
        member.efficiency = 0;
        member.task = null;
        say(crew, tick, 'system', 'intercom.crew_down', { station });
    } else {
        member.health = 'wounded';
        member.efficiency = Math.min(member.efficiency, WOUNDED_EFFICIENCY);
        say(crew, tick, station, 'intercom.wounded', { station });
    }
}

/** Первая помощь (бортовой стрелок): возвращает часть эффективности. */
export function treat(crew: CrewState, station: Station): void {
    const member = crew.members[station];

    if (member.health === 'wounded' && !member.treated) {
        member.treated = true;
        member.efficiency = Math.max(member.efficiency, TREATED_EFFICIENCY);
    }
}

/** Направление по часовой системе: 12 — нос, 3 — правый борт. Азимут в связанных осях, рад. */
export function clockOf(azimuth: number): number {
    const deg = ((azimuth * 180) / Math.PI + 360) % 360;
    const clock = Math.round(deg / 30) % 12;

    return clock === 0 ? 12 : clock;
}

export function addThreat(crew: CrewState, marker: Omit<ThreatMarker, 'id' | 'expiresTick'>, tick: number, ttlTicks: number): ThreatMarker {
    // Повторный доклад того же направления обновляет метку, а не плодит новые.
    const existing = crew.threats.find((t) => t.clock === marker.clock && t.kind === marker.kind && t.level === marker.level);

    if (existing) {
        existing.expiresTick = tick + ttlTicks;

        return existing;
    }

    const threat: ThreatMarker = { ...marker, id: crew.nextThreatId++, expiresTick: tick + ttlTicks };

    crew.threats.push(threat);

    return threat;
}

export function expireThreats(crew: CrewState, tick: number): void {
    crew.threats = crew.threats.filter((t) => t.expiresTick > tick);
}

/** Экипаж на борту и в строю (для оценки состояния экипажа в разборе). */
export function crewSummary(crew: CrewState): { ok: number; wounded: number; incapacitated: number; bailedOut: number } {
    const summary = { ok: 0, wounded: 0, incapacitated: 0, bailedOut: 0 };

    for (const member of Object.values(crew.members)) {
        if (member.bailedOut) {
            summary.bailedOut++;
        }

        summary[member.health === 'ok' ? 'ok' : member.health === 'wounded' ? 'wounded' : 'incapacitated']++;
    }

    return summary;
}
