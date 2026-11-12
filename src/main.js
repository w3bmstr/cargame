import { init } from './game.js';
import { TRACK_DEFINITIONS } from './world/track.js';
import { TERRAIN_QUALITY } from './world/terrain.js';
import { WEATHER_MODES } from './world/weather.js';
import { TRAFFIC_CLASSES } from './world/traffic.js';

// Public registry for future tracks, quality menus, weather selection, and
// vehicle catalogs without coupling those features to the legacy kernel.
globalThis.CarDrive3D = Object.freeze({
  tracks: TRACK_DEFINITIONS,
  terrainQuality: TERRAIN_QUALITY,
  weatherModes: WEATHER_MODES,
  trafficClasses: TRAFFIC_CLASSES,
});

// Single application entry point. Keep startup deterministic for browser and
// embedded WebView hosts that load the HTML more than once.
if (!globalThis.__carDrive3dStarted) {
  globalThis.__carDrive3dStarted = true;
  init();
}
