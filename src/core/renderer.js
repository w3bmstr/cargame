import * as THREE from 'three';

/** Shared renderer policy for future render passes and scalable quality tiers. */
export function createRenderer(canvas, options = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: options.antialias ?? true,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = options.shadows ?? true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, options.maxPixelRatio ?? 2));
  if (renderer.shadowMap.enabled) {
    renderer.shadowMap.autoUpdate = true;
  }
  return renderer;
}
