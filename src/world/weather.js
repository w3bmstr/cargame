export const WEATHER_MODES = Object.freeze(['clear', 'light-rain', 'heavy-rain', 'snow', 'mist', 'thunderstorm']);

export function isPrecipitation(mode) {
  return mode === 'light-rain' || mode === 'heavy-rain' || mode === 'thunderstorm' || mode === 'snow';
}
