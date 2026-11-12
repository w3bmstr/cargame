/** Browser audio policy helpers. The gameplay kernel owns its synth graph. */
export function resumeAudioContext(context) {
  if (context?.state === 'suspended') return context.resume();
  return Promise.resolve();
}
