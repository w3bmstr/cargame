import * as THREE from 'three';

/** Scene factory used by future standalone tracks and environments. */
export function createScene() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x050812, 45, 160);
  return scene;
}
