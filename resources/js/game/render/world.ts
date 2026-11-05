import * as THREE from 'three';
import type { Runway, Terrain } from '@/sim/core';

export type GraphicsPreset = 'low' | 'medium' | 'high';

export type WorldScene = {
    scene: THREE.Scene;
    sun: THREE.DirectionalLight;
    /** Сдвинуть сетку рельефа за камерой (дальние маршруты): пересчёт порциями по кадрам. */
    update(east: number, north: number): void;
    dispose(): void;
};

const REBUILD_VERTICES_PER_FRAME = 6000;

const PRESETS: Record<GraphicsPreset, { size: number; segments: number; fog: number }> = {
    low: { size: 40000, segments: 160, fog: 22000 },
    medium: { size: 60000, segments: 256, fog: 32000 },
    high: { size: 80000, segments: 384, fog: 45000 },
};

function terrainColor(height: number, slope: number, out: THREE.Color): THREE.Color {
    if (height < 3) {
        return out.setRGB(0.76, 0.7, 0.52); // песок у воды
    }

    if (slope > 0.55 || height > 1500) {
        return out.setRGB(0.47, 0.45, 0.42); // скалы
    }

    if (height > 500) {
        return out.setRGB(0.28, 0.36, 0.22); // маквис
    }

    return out.setRGB(0.42, 0.48, 0.28); // равнина
}

function runwayTexture(runway: Runway): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');

    canvas.width = 64;
    canvas.height = 1024;

    const ctx = canvas.getContext('2d');

    if (ctx) {
        ctx.fillStyle = '#5d5a52';
        ctx.fillRect(0, 0, 64, 1024);
        ctx.fillStyle = '#d8d4c8';

        for (let y = 60; y < 964; y += 48) {
            ctx.fillRect(30, y, 4, 24);
        }

        ctx.fillRect(4, 8, 56, 6);
        ctx.fillRect(4, 1010, 56, 6);
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(runway.id, 32, 1000);
    }

    const texture = new THREE.CanvasTexture(canvas);

    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;

    return texture;
}

/**
 * Сцена театра. Рельеф строится по той же функции высот, что и физика: картинка совпадает с землёй.
 */
export function createWorld(terrain: Terrain, runways: Runway[], preset: GraphicsPreset = 'medium'): WorldScene {
    const p = PRESETS[preset];
    const scene = new THREE.Scene();
    const disposables: { dispose(): void }[] = [];

    scene.background = new THREE.Color(0x9cc3e6);
    scene.fog = new THREE.Fog(0x9cc3e6, p.fog * 0.25, p.fog);

    const hemi = new THREE.HemisphereLight(0xdfefff, 0x5b5a3c, 1.1);
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);

    sun.position.set(-4000, 9000, 3000);
    scene.add(hemi, sun);

    // Рельеф: сетка в плоскости XZ Three.js (x — восток, -z — север), центр сетки следует за камерой.
    const step = p.size / p.segments;
    const color = new THREE.Color();
    const terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

    const fillVertex = (pos: THREE.BufferAttribute, colors: Float32Array, i: number, cx: number, cn: number): void => {
        const x = pos.getX(i) + cx;
        const north = -pos.getZ(i) + cn;
        const water = terrain.isWater(x, north);
        const h = water ? -6 : terrain.heightAt(x, north);
        const slope = Math.abs(terrain.heightAt(x + step, north) - terrain.heightAt(x - step, north)) / (2 * step);

        pos.setY(i, h);
        terrainColor(water ? 0 : h, slope, color).toArray(colors, i * 3);
    };

    const makeGeometry = (): THREE.PlaneGeometry => {
        const g = new THREE.PlaneGeometry(p.size, p.size, p.segments, p.segments);

        g.rotateX(-Math.PI / 2);
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count * 3), 3));

        return g;
    };

    let geometry = makeGeometry();
    const terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
    let center = { east: 0, north: 0 };

    {
        const pos = geometry.attributes.position as THREE.BufferAttribute;
        const colors = (geometry.attributes.color as THREE.BufferAttribute).array as Float32Array;

        for (let i = 0; i < pos.count; i++) {
            fillVertex(pos, colors, i, 0, 0);
        }

        geometry.computeVertexNormals();
    }

    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);
    disposables.push(terrainMaterial);

    // Фоновая перестройка: новая сетка заполняется порциями и подменяет старую целиком.
    let pending: { geometry: THREE.PlaneGeometry; next: number; east: number; north: number } | null = null;

    // Море.
    const seaGeometry = new THREE.PlaneGeometry(p.size * 4, p.size * 4);
    const seaMaterial = new THREE.MeshStandardMaterial({ color: 0x2b5c7e, roughness: 0.35, metalness: 0.1 });
    const sea = new THREE.Mesh(seaGeometry, seaMaterial);

    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.5;
    scene.add(sea);
    disposables.push(seaGeometry, seaMaterial);

    // Полосы.
    for (const runway of runways) {
        const texture = runwayTexture(runway);
        const rwGeometry = new THREE.PlaneGeometry(runway.width_m, runway.length_m);
        const rwMaterial = new THREE.MeshLambertMaterial({ map: texture, polygonOffset: true, polygonOffsetFactor: -4 });
        const strip = new THREE.Mesh(rwGeometry, rwMaterial);

        strip.rotation.x = -Math.PI / 2;
        strip.rotation.z = -runway.heading;
        strip.position.set(runway.x, runway.elevation_m + 0.05, -runway.y);
        scene.add(strip);
        disposables.push(texture, rwGeometry, rwMaterial);
    }

    return {
        scene,
        sun,
        update: (east, north) => {
            sea.position.set(east, -0.5, -north);

            if (pending === null) {
                if (Math.hypot(east - center.east, north - center.north) > p.size / 4) {
                    const snap = step * 8;

                    pending = { geometry: makeGeometry(), next: 0, east: Math.round(east / snap) * snap, north: Math.round(north / snap) * snap };
                }

                return;
            }

            const pos = pending.geometry.attributes.position as THREE.BufferAttribute;
            const colors = (pending.geometry.attributes.color as THREE.BufferAttribute).array as Float32Array;
            const end = Math.min(pos.count, pending.next + REBUILD_VERTICES_PER_FRAME);

            for (let i = pending.next; i < end; i++) {
                fillVertex(pos, colors, i, pending.east, pending.north);
            }

            pending.next = end;

            if (end >= pos.count) {
                pending.geometry.computeVertexNormals();
                geometry.dispose();
                geometry = pending.geometry;
                terrainMesh.geometry = geometry;
                terrainMesh.position.set(pending.east, 0, -pending.north);
                center = { east: pending.east, north: pending.north };
                pending = null;
            }
        },
        dispose: () => {
            geometry.dispose();
            pending?.geometry.dispose();
            disposables.forEach((d) => d.dispose());
        },
    };
}
