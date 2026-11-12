export const byId = (id, root = document) => root.getElementById(id);
export const prefersReducedMotion = () =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
