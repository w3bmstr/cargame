export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const damp = (current, target, smoothing, dt) =>
  current + (target - current) * (1 - Math.exp(-smoothing * dt));
