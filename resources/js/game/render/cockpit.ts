import * as THREE from 'three';
import { PANEL_HEIGHT, PANEL_WIDTH } from './instruments';

/**
 * Временная кабина пилота в осях FRD: приборная доска с canvas-текстурой, козырёк, стойки фонаря.
 */
export type Cockpit = {
    group: THREE.Group;
    panelCanvas: HTMLCanvasElement;
    panelTexture: THREE.CanvasTexture;
    dispose(): void;
};

export function createCockpit(): Cockpit {
    const group = new THREE.Group();
    const panelCanvas = document.createElement('canvas');

    panelCanvas.width = PANEL_WIDTH;
    panelCanvas.height = PANEL_HEIGHT;

    const panelTexture = new THREE.CanvasTexture(panelCanvas);

    panelTexture.colorSpace = THREE.SRGBColorSpace;
    panelTexture.anisotropy = 4;

    const panelGeometry = new THREE.PlaneGeometry(1.65, 0.55);
    const panelMaterial = new THREE.MeshBasicMaterial({ map: panelTexture });
    const panel = new THREE.Mesh(panelGeometry, panelMaterial);

    // Нормаль доски смотрит на пилота (-x), «вверх» доски — вверх (-z).
    panel.setRotationFromMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)));
    // Доска — по оси фюзеляжа (стенки кабины симметричны относительно неё).
    panel.position.set(5.45, 0, -0.12);
    // Доска слегка наклонена к пилоту.
    panel.rotateX(-0.25);

    const frameMaterial = new THREE.MeshLambertMaterial({ color: 0x2a2c26 });
    const glare = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.8, 0.06), frameMaterial);

    glare.position.set(5.55, 0, -0.42);

    const pillarGeometry = new THREE.BoxGeometry(0.05, 0.05, 0.8);
    const pillars = [-0.85, 0.85].map((y) => {
        const pillar = new THREE.Mesh(pillarGeometry, frameMaterial);

        pillar.position.set(5.75, y, -0.85);
        pillar.rotation.y = 0.35;

        return pillar;
    });
    const centerPost = new THREE.Mesh(pillarGeometry, frameMaterial);

    centerPost.position.set(5.85, 0, -0.85);
    centerPost.rotation.y = 0.4;

    const roofBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.9, 0.05), frameMaterial);

    roofBar.position.set(5.4, 0, -1.25);

    group.add(panel, glare, ...pillars, centerPost, roofBar);

    return {
        group,
        panelCanvas,
        panelTexture,
        dispose: () => {
            panelGeometry.dispose();
            panelMaterial.dispose();
            panelTexture.dispose();
            frameMaterial.dispose();
            pillarGeometry.dispose();
            glare.geometry.dispose();
            roofBar.geometry.dispose();
        },
    };
}
