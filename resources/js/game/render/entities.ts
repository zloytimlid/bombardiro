import * as THREE from 'three';
import type { Vec3 } from '@/sim/core';
import { attitudeFromEuler } from '@/sim/core';
import type { MissionStatic, WorldView } from '@/sim/view';
import { createAircraftModel } from './aircraftModel';
import type { AircraftModel } from './aircraftModel';
import { attitudeToThree, toThree } from './coords';

/**
 * Динамические объекты сцены этапа 2: ведомые, истребители, разрывы зениток, трассеры,
 * бомбы, разрывы на земле, цель (мост по пролётам). Всё из пулов — без аллокаций в кадре.
 */
export type Entities = {
    update(view: WorldView, dt: number): void;
    dispose(): void;
};

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Ориентация по вектору скорости (нос по скорости, без крена) для точечных моделей. */
function orientAlong(object: THREE.Object3D, position: Vec3, velocity: Vec3, bank = 0): void {
    toThree(position, object.position);
    toThree(velocity, tmp).normalize();

    if (tmp.lengthSq() < 1e-6) {
        return;
    }

    tmp2.copy(object.position).add(tmp);
    object.up.copy(UP);
    object.lookAt(tmp2);
    object.rotateZ(bank);
}

function createFighterModel(materials: THREE.Material[], geometries: THREE.BufferGeometry[]): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.MeshLambertMaterial({ color: 0x55605a });
    const under = new THREE.MeshLambertMaterial({ color: 0x8e9aa0 });
    const add = <T extends THREE.BufferGeometry>(geo: T): T => (geometries.push(geo), geo);

    materials.push(body, under);

    // Ось модели: +z Three.js после lookAt смотрит на цель, поэтому нос — по +z.
    const fuselage = new THREE.Mesh(add(new THREE.CylinderGeometry(0.55, 0.3, 9, 10)), body);

    fuselage.rotation.x = Math.PI / 2;
    g.add(fuselage);

    const wing = new THREE.Mesh(add(new THREE.BoxGeometry(10, 0.18, 1.8)), under);

    wing.position.set(0, -0.3, 1.0);
    g.add(wing);

    const tail = new THREE.Mesh(add(new THREE.BoxGeometry(3.4, 0.12, 0.9)), under);

    tail.position.set(0, 0, -4.0);
    g.add(tail);

    const fin = new THREE.Mesh(add(new THREE.BoxGeometry(0.12, 1.6, 1.0)), body);

    fin.position.set(0, 0.8, -4.0);
    g.add(fin);

    return g;
}

export function createEntities(scene: THREE.Scene, statics: MissionStatic): Entities {
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const disposeExtra: (() => void)[] = [];

    // Ведомые — та же временная модель B-25J.
    const wingmen = new Map<number, AircraftModel>();

    // Истребители.
    const fighters = new Map<number, THREE.Group>();
    const smokeMaterial = new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.6 });

    materials.push(smokeMaterial);

    // Разрывы зениток: тёмные облачка, растут и тают.
    const burstGeometry = new THREE.IcosahedronGeometry(1, 1);
    const burstPool: THREE.Mesh[] = [];
    const burstMaterialHeavy = new THREE.MeshBasicMaterial({ color: 0x1b1b1b, transparent: true, opacity: 0.85, depthWrite: false });
    const burstMaterialLight = new THREE.MeshBasicMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.7, depthWrite: false });
    const flashMaterial = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 1, depthWrite: false });

    geometries.push(burstGeometry);
    materials.push(burstMaterialHeavy, burstMaterialLight, flashMaterial);

    // Трассеры: отрезки вдоль скорости.
    const MAX_TRACERS = 160;
    const tracerPositions = new Float32Array(MAX_TRACERS * 6);
    const tracerColors = new Float32Array(MAX_TRACERS * 6);
    const tracerGeometry = new THREE.BufferGeometry();

    tracerGeometry.setAttribute('position', new THREE.BufferAttribute(tracerPositions, 3));
    tracerGeometry.setAttribute('color', new THREE.BufferAttribute(tracerColors, 3));

    const tracerMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 });
    const tracers = new THREE.LineSegments(tracerGeometry, tracerMaterial);

    tracers.frustumCulled = false;
    scene.add(tracers);
    geometries.push(tracerGeometry);
    materials.push(tracerMaterial);

    // Бомбы и разрывы на земле.
    const bombGeometry = new THREE.CylinderGeometry(0.18, 0.18, 1.4, 8);
    const bombMaterial = new THREE.MeshLambertMaterial({ color: 0x3d4a2c });
    const impactMaterial = new THREE.MeshBasicMaterial({ color: 0x6b5a45, transparent: true, opacity: 0.8, depthWrite: false });
    const bombPool: THREE.Mesh[] = [];
    const impactPool: THREE.Mesh[] = [];

    geometries.push(bombGeometry);
    materials.push(bombMaterial, impactMaterial);

    // Цель: пролёты моста и опоры.
    const spanMaterial = new THREE.MeshLambertMaterial({ color: 0x77706a });
    const spanBroken = new THREE.MeshLambertMaterial({ color: 0x3b3430 });
    const pierMaterial = new THREE.MeshLambertMaterial({ color: 0x8a837c });
    const spans: THREE.Mesh[] = [];

    materials.push(spanMaterial, spanBroken, pierMaterial);

    for (const s of statics.target.sections) {
        const geo = new THREE.BoxGeometry(s.halfWidth * 2, 2.2, s.halfLength * 2);
        const span = new THREE.Mesh(geo, spanMaterial);

        geometries.push(geo);
        toThree({ ...s.center, z: s.center.z + 9 }, span.position);
        span.rotation.y = -statics.target.heading;
        scene.add(span);
        spans.push(span);

        const pierGeo = new THREE.BoxGeometry(3, 10, 3);
        const pier = new THREE.Mesh(pierGeo, pierMaterial);

        geometries.push(pierGeo);
        toThree({ ...s.center, z: s.center.z + 4 }, pier.position);
        pier.rotation.y = -statics.target.heading;
        scene.add(pier);
        disposeExtra.push(() => scene.remove(pier));
    }

    const pool = <T extends THREE.Object3D>(items: T[], count: number, make: () => T): T[] => {
        while (items.length < count) {
            const item = make();

            scene.add(item);
            items.push(item);
        }

        items.forEach((item, i) => (item.visible = i < count));

        return items;
    };

    return {
        update(view, dt) {
            void dt;

            // Ведомые.
            const seenWingmen = new Set<number>();

            for (const w of view.wingmen) {
                let model = wingmen.get(w.id);

                if (model === undefined) {
                    model = createAircraftModel();
                    scene.add(model.root);
                    wingmen.set(w.id, model);
                }

                seenWingmen.add(w.id);

                // Модель B-25J построена в FRD: ориентация как у ведущего — по курсу и наклону траектории.
                const heading = Math.atan2(w.velocity.x, w.velocity.y);
                const pitch = Math.atan2(w.velocity.z, Math.hypot(w.velocity.x, w.velocity.y));

                attitudeToThree(attitudeFromEuler(heading, pitch, 0), model.root.quaternion);
                toThree(w.position, model.root.position);

                for (const leg of model.gear) {
                    leg.visible = false;
                }
            }

            for (const [id, model] of wingmen) {
                if (!seenWingmen.has(id)) {
                    scene.remove(model.root);
                    model.dispose();
                    wingmen.delete(id);
                }
            }

            // Истребители.
            const seenFighters = new Set<number>();

            for (const f of view.fighters) {
                let model = fighters.get(f.id);

                if (model === undefined) {
                    model = createFighterModel(materials, geometries);
                    scene.add(model);
                    fighters.set(f.id, model);
                }

                seenFighters.add(f.id);
                orientAlong(model, f.position, f.velocity, f.phase === 'down' ? view.timeS * 3 : 0);
            }

            for (const [id, model] of fighters) {
                if (!seenFighters.has(id)) {
                    scene.remove(model);
                    fighters.delete(id);
                }
            }

            // Разрывы зениток: вспышка, затем растущее облачко.
            const bursts = pool(burstPool, view.bursts.length, () => new THREE.Mesh(burstGeometry, burstMaterialHeavy));

            view.bursts.forEach((b, i) => {
                const mesh = bursts[i];

                if (!mesh) {
                    return;
                }

                const heavy = b.typeId === 'heavy';

                mesh.material = b.ageS < 0.15 ? flashMaterial : heavy ? burstMaterialHeavy : burstMaterialLight;
                mesh.scale.setScalar((heavy ? 6 : 2.5) + b.ageS * (heavy ? 2.2 : 1));
                toThree(b.position, mesh.position);
            });

            // Трассеры.
            const n = Math.min(view.tracers.length, MAX_TRACERS);

            for (let i = 0; i < n; i++) {
                const t = view.tracers[i];

                if (!t) {
                    continue;
                }

                const speed = Math.hypot(t.velocity.x, t.velocity.y, t.velocity.z) || 1;
                const len = 18 / speed;
                const o = i * 6;

                tracerPositions[o] = t.position.x;
                tracerPositions[o + 1] = t.position.z;
                tracerPositions[o + 2] = -t.position.y;
                tracerPositions[o + 3] = t.position.x - t.velocity.x * len;
                tracerPositions[o + 4] = t.position.z - t.velocity.z * len;
                tracerPositions[o + 5] = -(t.position.y - t.velocity.y * len);

                const [r, g, b] = t.enemy ? [1, 0.85, 0.6] : [1, 0.45, 0.25];

                tracerColors.set([r, g, b, r * 0.4, g * 0.4, b * 0.4], o);
            }

            tracerGeometry.setDrawRange(0, n * 2);
            (tracerGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
            (tracerGeometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;

            // Бомбы.
            const bombs = pool(bombPool, view.bombs.length, () => new THREE.Mesh(bombGeometry, bombMaterial));

            view.bombs.forEach((b, i) => {
                const mesh = bombs[i];

                if (mesh) {
                    orientAlong(mesh, b.position, b.velocity);
                    mesh.rotateX(Math.PI / 2);
                }
            });

            // Разрывы бомб на земле: столб пыли растёт и оседает.
            const impacts = pool(impactPool, view.impacts.length, () => new THREE.Mesh(burstGeometry, impactMaterial));

            view.impacts.forEach((imp, i) => {
                const mesh = impacts[i];

                if (mesh) {
                    const grow = Math.min(imp.ageS / 3, 1);

                    mesh.scale.set(14 + 18 * grow, (imp.armed ? 26 : 4) * (1 - Math.min(imp.ageS / 25, 0.9)), 14 + 18 * grow);
                    toThree(imp.position, mesh.position);
                }
            });

            // Мост: разрушенный пролёт проседает.
            view.target.sections.forEach((s, i) => {
                const span = spans[i];

                if (span) {
                    const broken = s.damage >= s.strength;

                    span.material = broken ? spanBroken : spanMaterial;
                    span.position.y = s.center.z + (broken ? 2 : 9);
                    span.rotation.z = broken ? 0.25 : 0;
                }
            });

            void smokeMaterial;
        },
        dispose() {
            for (const model of wingmen.values()) {
                scene.remove(model.root);
                model.dispose();
            }

            for (const model of fighters.values()) {
                scene.remove(model);
            }

            for (const item of [...burstPool, ...bombPool, ...impactPool, ...spans, tracers]) {
                scene.remove(item);
            }

            disposeExtra.forEach((d) => d());
            geometries.forEach((g) => g.dispose());
            materials.forEach((m) => m.dispose());
        },
    };
}
