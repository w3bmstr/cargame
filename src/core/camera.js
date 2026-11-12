import * as THREE from 'three';

export function createCamera(aspect = 1) {
  return new THREE.PerspectiveCamera(62, aspect, 0.05, 700);
}
