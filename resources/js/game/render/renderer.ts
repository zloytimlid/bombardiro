import * as THREE from 'three';

/**
 * Рендерер сцены (раздел 4: WebGPU — после MVP, этап 6): WebGL 2 по умолчанию; WebGPU — по настройке,
 * если браузер его поддерживает. Модуль three/webgpu грузится отдельным чанком только при выборе WebGPU;
 * любая ошибка инициализации — откат на WebGL 2.
 */
export type SceneRenderer = {
    readonly domElement: HTMLCanvasElement;
    readonly kind: 'webgl' | 'webgpu';
    setPixelRatio(ratio: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    render(scene: THREE.Scene, camera: THREE.Camera): void;
    dispose(): void;
};

function configure<R extends { outputColorSpace: string; toneMapping: THREE.ToneMapping }>(r: R): R {
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;

    return r;
}

export async function createRenderer(kind: 'webgl' | 'webgpu', antialias: boolean): Promise<SceneRenderer> {
    if (kind === 'webgpu' && typeof navigator !== 'undefined' && 'gpu' in navigator) {
        try {
            const { WebGPURenderer } = await import('three/webgpu');
            const r = configure(new WebGPURenderer({ antialias, powerPreference: 'high-performance' }));

            await r.init();

            return Object.assign(r as unknown as Omit<SceneRenderer, 'kind'>, { kind: 'webgpu' as const });
        } catch (e) {
            console.warn('[render] WebGPU unavailable, falling back to WebGL 2', e);
        }
    }

    const r = configure(new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance' }));

    return Object.assign(r, { kind: 'webgl' as const });
}
