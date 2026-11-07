import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createAircraftModel, mirrorSpan } from './aircraftModel';

/** Доля треугольников, у которых нормаль по обходу вершин совпадает с нормалью вершины (грань «наружу»). */
function outwardShare(g: THREE.BufferGeometry): number {
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const index = g.getIndex();
    const count = index ? index.count : pos.count;
    const at = (i: number): number => (index ? index.getX(i) : i);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    let outward = 0;

    for (let i = 0; i + 2 < count; i += 3) {
        a.fromBufferAttribute(pos, at(i));
        b.fromBufferAttribute(pos, at(i + 1));
        c.fromBufferAttribute(pos, at(i + 2));
        n.fromBufferAttribute(nor, at(i)).add(new THREE.Vector3().fromBufferAttribute(nor, at(i + 1))).add(new THREE.Vector3().fromBufferAttribute(nor, at(i + 2)));

        const face = b.clone().sub(a).cross(c.clone().sub(a));

        outward += face.dot(n) > 0 ? 1 : 0;
    }

    return outward / (count / 3);
}

describe('aircraft model mirroring', () => {
    // Крыло — ExtrudeGeometry (без индекса), как в модели; плюс индексированная геометрия.
    const wing = (): THREE.BufferGeometry => {
        const shape = new THREE.Shape();

        shape.moveTo(1, 0);
        shape.lineTo(0.5, 3);
        shape.lineTo(-0.5, 3);
        shape.lineTo(-1, 0);
        shape.closePath();

        return new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 2 });
    };

    it('keeps faces pointing outward after mirroring a wing panel', () => {
        expect(outwardShare(wing())).toBeGreaterThan(0.95);
        expect(outwardShare(mirrorSpan(wing()))).toBeGreaterThan(0.95);
    });

    it('keeps faces pointing outward for indexed geometry too', () => {
        expect(outwardShare(mirrorSpan(new THREE.BoxGeometry(1, 2, 0.3)))).toBe(1);
    });

    it('mirrors across the span (y), not along the chord or thickness', () => {
        const g = mirrorSpan(wing());

        g.computeBoundingBox();
        expect(g.boundingBox!.max.y).toBeLessThanOrEqual(0.2);
        expect(g.boundingBox!.min.y).toBeLessThan(-2.5);
    });

    it('a plain negative scale (the old way) turns the panel inside out', () => {
        const g = wing();

        g.scale(1, -1, 1);
        expect(outwardShare(g)).toBeLessThan(0.05);
    });

    it('puts the cockpit canopy and the top turret on top of the fuselage, symmetric about the centreline', () => {
        // Окружение тестов — node: надписям и знакам хватит заглушки canvas (геометрии текстуры не нужны).
        const ctx = new Proxy({}, { get: (_t, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true });
        const g = globalThis as unknown as { document?: unknown };
        const saved = g.document;

        g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

        try {
            const model = createAircraftModel();

            model.root.updateMatrixWorld(true);

            for (const name of ['canopy', 'top_turret']) {
                const dome = model.root.getObjectByName(name)!;
                const box = new THREE.Box3().setFromObject(dome);

                // Оси модели — FRD: y — вправо, z — вниз. Купол — поровну на оба борта и выше точки крепления.
                expect(box.min.y, name).toBeCloseTo(-box.max.y, 3);
                expect(box.max.y - box.min.y, name).toBeGreaterThan(0.9);
                expect(box.min.z, name).toBeLessThan(dome.position.z - 0.4);
                expect(box.max.z, name).toBeLessThanOrEqual(dome.position.z + 1e-6);
            }

            model.dispose();
        } finally {
            g.document = saved;
        }
    });
});
