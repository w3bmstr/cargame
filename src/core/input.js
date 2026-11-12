/** Input action names shared by keyboard, touch, and future gamepad adapters. */
export const INPUT_ACTIONS = Object.freeze(['left', 'right', 'gas', 'brake', 'boost']);

export function createInputState() {
  return Object.fromEntries(INPUT_ACTIONS.map((action) => [action, false]));
}
