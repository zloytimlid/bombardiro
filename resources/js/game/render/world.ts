import * as THREE from 'three';
import type { Runway, Terrain } from '@/sim/core';

export type GraphicsPreset = 'low' | 'medium' | 'high';

export type WorldScene = {
    scene: THREE.Scene;
    sun: THREE.DirectionalLight;
    dispose(): void;
};

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

    // Рельеф: сетка в плоскости XZ Three.js (x — восток, -z — север).
    const geometry = new THREE.PlaneGeometry(p.size, p.size, p.segments, p.segments);

    geometry.rotateX(-Math.PI / 2);

    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const color = new THREE.Color();
    const step = p.size / p.segments;

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const north = -pos.getZ(i);
        const water = terrain.isWater(x, north);
        const h = water ? -6 : terrain.heightAt(x, north);
        const slope = Math.abs(terrain.heightAt(x + step, north) - terrain.heightAt(x - step, north)) / (2 * step);

        pos.setY(i, h);
        terrainColor(water ? 0 : h, slope, color).toArray(colors, i * 3);
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    const terrainMesh = new THREE.Mesh(geometry, terrainMaterial);

    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);
    disposables.push(geometry, terrainMaterial);

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
        dispose: () => disposables.forEach((d) => d.dispose()),
    };
}
