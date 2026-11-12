export const TRAFFIC_CLASSES = Object.freeze(['sedan', 'hatch', 'suv', 'sports', 'van', 'truck']);

export function createTrafficPolicy(density = 22) {
  return { density: Math.max(4, Math.min(48, density)), laneChanges: true, overtaking: true };
}
