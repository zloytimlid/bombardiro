import * as THREE from 'three';
import type { Quat, Vec3 } from '@/sim/core';

/**
 * Мир симядра — ENU (z вверх), Three.js — Y вверх: three = (x, z, -y).
 * Модели строятся прямо в связанных осях FRD; Q_ENU_TO_THREE переводит их в сцену.
 */
export const Q_ENU_TO_THREE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

export const toThree = (v: Vec3, out = new THREE.Vector3()): THREE.Vector3 => out.set(v.x, v.z, -v.y);

/** Ориентация самолёта (FRD → ENU) в ориентацию объекта Three.js. */
export const attitudeToThree = (q: Quat, out = new THREE.Quaternion()): THREE.Quaternion =>
    out.copy(Q_ENU_TO_THREE).multiply(new THREE.Quaternion(q.x, q.y, q.z, q.w));

/** Камера Three.js смотрит по -Z с верхом +Y; в FRD это нос (+x) и «вверх» (-z). */
export const Q_CAMERA_IN_FRD = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)),
);
