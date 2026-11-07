/**
 * Пути в осях полосы для фона главного меню: рулёжки самолётов и дороги машин — одна выборка точек,
 * один «следователь пути» (pointAt).
 */
/** Путь руления в осях полосы (along, across): точки через ~1 м, курс по касательной, начало ближайшего разворота. */
export type TaxiPoint = { along: number; across: number; yaw: number; s: number; turn: boolean; nextTurnS: number };
export type TaxiPath = { points: TaxiPoint[]; length: number };

export type RawPoint = { along: number; across: number; yaw: number; turn: boolean };

/** Прямой участок до точки (шаг ~1 м, без начальной точки, если путь уже начат). */
export function line(raw: RawPoint[], fromAlong: number, fromAcross: number, toAlong: number, toAcross: number): void {
    const length = Math.hypot(toAlong - fromAlong, toAcross - fromAcross);
    const n = Math.max(1, Math.ceil(length));
    const yaw = Math.atan2(toAcross - fromAcross, toAlong - fromAlong);

    for (let i = raw.length === 0 ? 0 : 1; i <= n; i++) {
        raw.push({ along: fromAlong + ((toAlong - fromAlong) * i) / n, across: fromAcross + ((toAcross - fromAcross) * i) / n, yaw, turn: false });
    }
}

/** Дуга радиуса r вокруг (cx, cy) от угла from до to; курс — по касательной в сторону движения. */
export function arc(raw: RawPoint[], cx: number, cy: number, r: number, from: number, to: number): void {
    const n = Math.max(8, Math.ceil(Math.abs(to - from) * r));
    const dir = Math.sign(to - from);

    for (let i = 1; i <= n; i++) {
        const phi = from + ((to - from) * i) / n;

        raw.push({ along: cx + r * Math.cos(phi), across: cy + r * Math.sin(phi), yaw: Math.atan2(dir * Math.cos(phi), -dir * Math.sin(phi)), turn: true });
    }
}

/** Накопленная длина и начало ближайшего разворота впереди (для торможения заранее). */
export function finishPath(raw: RawPoint[]): TaxiPath {
    let s = 0;
    const points: TaxiPoint[] = raw.map((p, i) => {
        if (i > 0) {
            const prev = raw[i - 1]!;

            s += Math.hypot(p.along - prev.along, p.across - prev.across);
        }

        return { ...p, s, nextTurnS: Infinity };
    });
    let next = Infinity;

    for (let i = points.length - 1; i >= 0; i--) {
        const pt = points[i]!;

        if (pt.turn && !(points[i - 1]?.turn ?? false)) {
            next = pt.s;
        }

        pt.nextTurnS = pt.turn ? pt.s : next;
    }

    return { points, length: s };
}

/** Точка пути по пройденному расстоянию: положение, курс (по кратчайшему углу), участок разворота. */
export function pointAt(path: TaxiPath, s: number): TaxiPoint {
    const pts = path.points;
    let i = 1;

    while (i < pts.length - 1 && pts[i]!.s < s) {
        i++;
    }

    const a = pts[i - 1]!;
    const b = pts[i]!;
    const k = b.s > a.s ? Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s))) : 1;

    return {
        along: a.along + (b.along - a.along) * k,
        across: a.across + (b.across - a.across) * k,
        yaw: a.yaw + angleDelta(b.yaw, a.yaw) * k,
        s,
        turn: b.turn,
        nextTurnS: b.nextTurnS,
    };
}

/** Разность углов в (−π, π]. */
export function angleDelta(to: number, from: number): number {
    return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * Путь по ломаной со скруглёнными углами радиуса r (дорожная сеть): прямые участки — через ~1 м, на углах — дуги.
 * Угол, на котором дуга не помещается между соседними точками, скругляется меньшим радиусом.
 */
export function roundedPath(waypoints: { along: number; across: number }[], radius: number): TaxiPath {
    const raw: RawPoint[] = [];
    let from = waypoints[0]!;

    for (let i = 1; i < waypoints.length; i++) {
        const b = waypoints[i]!;
        const c = waypoints[i + 1];

        if (c === undefined) {
            line(raw, from.along, from.across, b.along, b.across);
            break;
        }

        const a = waypoints[i - 1]!;
        const ux = b.along - a.along;
        const uy = b.across - a.across;
        const vx = c.along - b.along;
        const vy = c.across - b.across;
        const lu = Math.hypot(ux, uy);
        const lv = Math.hypot(vx, vy);
        const turn = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);

        if (Math.abs(turn) < 1e-6) {
            continue;
        }

        // Касательные точки дуги: на расстоянии t = r·tg(θ/2) от вершины.
        const r = Math.min(radius, (Math.min(lu, lv) / 2) / Math.tan(Math.abs(turn) / 2));
        const t = r * Math.tan(Math.abs(turn) / 2);
        const startAlong = b.along - (ux / lu) * t;
        const startAcross = b.across - (uy / lu) * t;

        line(raw, from.along, from.across, startAlong, startAcross);

        // Центр — по нормали к входящему отрезку в сторону поворота (вправо — плюс в осях полосы).
        const side = Math.sign(turn);
        const cx = startAlong - (uy / lu) * r * side;
        const cy = startAcross + (ux / lu) * r * side;
        const phi0 = Math.atan2(startAcross - cy, startAlong - cx);

        arc(raw, cx, cy, r, phi0, phi0 + turn);
        from = { along: b.along + (vx / lv) * t, across: b.across + (vy / lv) * t };
    }

    return finishPath(raw);
}

/** Путь, смещённый вправо по ходу на offset м (правая полоса дороги). */
export function offsetPath(path: TaxiPath, offset: number): TaxiPath {
    return finishPath(
        path.points.map((p) => ({ along: p.along - Math.sin(p.yaw) * offset, across: p.across + Math.cos(p.yaw) * offset, yaw: p.yaw, turn: p.turn })),
    );
}
