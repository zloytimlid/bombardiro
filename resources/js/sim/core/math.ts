/**
 * Векторы и кватернионы симядра. Мир — ENU (x восток, y север, z вверх),
 * связанные оси самолёта — FRD (x вперёд, y вправо, z вниз).
 */
export type Vec3 = { x: number; y: number; z: number };
export type Quat = { w: number; x: number; y: number; z: number };

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
});
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => {
    const l = length(a);

    return l > 1e-12 ? scale(a, 1 / l) : vec();
};

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Приближение величины к цели с постоянной времени tau (инерционное звено 1-го порядка). */
export const approach = (value: number, target: number, tau: number, dt: number): number =>
    tau <= 0 ? target : value + (target - value) * (1 - Math.exp(-dt / tau));

/** Приближение с ограничением скорости изменения. */
export const moveTowards = (value: number, target: number, maxDelta: number): number =>
    Math.abs(target - value) <= maxDelta ? target : value + Math.sign(target - value) * maxDelta;

/** Угол в диапазоне (-π, π]. */
export const wrapPi = (a: number): number => {
    let r = a % (2 * Math.PI);

    if (r <= -Math.PI) {
        r += 2 * Math.PI;
    } else if (r > Math.PI) {
        r -= 2 * Math.PI;
    }

    return r;
};

/** Линейная интерполяция по таблице [[x, y], ...], отсортированной по x. */
export const interpolateTable = (table: ReadonlyArray<readonly [number, number]>, x: number): number => {
    const first = table[0];
    const last = table[table.length - 1];

    if (first === undefined || last === undefined) {
        return 0;
    }

    if (x <= first[0]) {
        return first[1];
    }

    if (x >= last[0]) {
        return last[1];
    }

    for (let i = 1; i < table.length; i++) {
        const b = table[i];
        const a = table[i - 1];

        if (a !== undefined && b !== undefined && x <= b[0]) {
            return lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]));
        }
    }

    return last[1];
};

export const quatIdentity = (): Quat => ({ w: 1, x: 0, y: 0, z: 0 });

export const quatMul = (a: Quat, b: Quat): Quat => ({
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});

export const quatNormalize = (q: Quat): Quat => {
    const l = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);

    return { w: q.w / l, x: q.x / l, y: q.y / l, z: q.z / l };
};

/** Поворот вектора кватернионом (из связанных осей в мировые). */
export const rotate = (q: Quat, v: Vec3): Vec3 => {
    const t = scale(cross(q, v), 2);

    return add(add(v, scale(t, q.w)), cross(q, t));
};

/** Обратный поворот (из мировых осей в связанные). */
export const rotateInverse = (q: Quat, v: Vec3): Vec3 => rotate({ w: q.w, x: -q.x, y: -q.y, z: -q.z }, v);

/** Интегрирование ориентации по угловой скорости в связанных осях. */
export const integrateQuat = (q: Quat, omegaBody: Vec3, dt: number): Quat => {
    const dq = quatMul(q, { w: 0, x: omegaBody.x, y: omegaBody.y, z: omegaBody.z });

    return quatNormalize({
        w: q.w + 0.5 * dq.w * dt,
        x: q.x + 0.5 * dq.x * dt,
        y: q.y + 0.5 * dq.y * dt,
        z: q.z + 0.5 * dq.z * dt,
    });
};

type Mat3 = [number, number, number, number, number, number, number, number, number];

const quatFromMatrix = (m: Mat3): Quat => {
    const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
    const trace = m00 + m11 + m22;

    if (trace > 0) {
        const s = Math.sqrt(trace + 1) * 2;

        return quatNormalize({ w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s });
    }

    if (m00 > m11 && m00 > m22) {
        const s = Math.sqrt(1 + m00 - m11 - m22) * 2;

        return quatNormalize({ w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s });
    }

    if (m11 > m22) {
        const s = Math.sqrt(1 + m11 - m00 - m22) * 2;

        return quatNormalize({ w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s });
    }

    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;

    return quatNormalize({ w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s });
};

/**
 * Ориентация по углам: курс (от севера по часовой), тангаж (нос вверх +), крен (правое крыло вниз +).
 * Матрица связанные FRD → NED по стандарту, затем NED → ENU.
 */
export const attitudeFromEuler = (heading: number, pitch: number, roll: number): Quat => {
    const [cp, sp] = [Math.cos(pitch), Math.sin(pitch)];
    const [cr, sr] = [Math.cos(roll), Math.sin(roll)];
    const [ch, sh] = [Math.cos(heading), Math.sin(heading)];
    // C: FRD → NED
    const c00 = cp * ch;
    const c01 = sr * sp * ch - cr * sh;
    const c02 = cr * sp * ch + sr * sh;
    const c10 = cp * sh;
    const c11 = sr * sp * sh + cr * ch;
    const c12 = cr * sp * sh - sr * ch;
    const c20 = -sp;
    const c21 = sr * cp;
    const c22 = cr * cp;

    // ENU = [[0,1,0],[1,0,0],[0,0,-1]] · NED
    return quatFromMatrix([c10, c11, c12, c00, c01, c02, -c20, -c21, -c22]);
};

export type Euler = { heading: number; pitch: number; roll: number };

/** Обратное преобразование: курс в [0, 2π), тангаж и крен в радианах. */
export const eulerFromAttitude = (q: Quat): Euler => {
    const xb = rotate(q, vec(1, 0, 0));
    const yb = rotate(q, vec(0, 1, 0));
    const zb = rotate(q, vec(0, 0, 1));
    // C (FRD → NED) = M · R; строка 2 C = (-xb.z, -yb.z, -zb.z)
    const c20 = -xb.z;
    const c21 = -yb.z;
    const c22 = -zb.z;
    const pitch = Math.asin(clamp(-c20, -1, 1));
    const roll = Math.atan2(c21, c22);
    let heading = Math.atan2(xb.x, xb.y);

    if (heading < -1e-12) {
        heading += 2 * Math.PI;
    } else if (heading < 0) {
        heading = 0;
    }

    return { heading, pitch, roll };
};
