
import * as THREE from 'three';
import { createRenderer } from './core/renderer.js';

// The gameplay kernel retains the original driving model while the public
// bootstrap and subsystem modules provide a maintainable extension boundary.
const ROAD_W = 15, COAST = -8, OFFROAD = -32, CARS_N = 22;
const TRAFFIC_LANES = Object.freeze([-5.1, 5.1]);
let MAX_SPD = 76, BOOST_SPD = 100, ACCEL = 30, BRAKE = -56, STEER_ACCEL = 56, LAT_FRICTION = 11, CURVE_FORCE = 0.26, MAX_LAT_VEL = 13, CENTER_SPRING = 9;

let renderer, scene, camera, clock, sun, hemi, roadMesh, underMesh;
let smokeG, traffic = [], pts = [], curve = null, trackLen = 0;
let run = false, dead = false, paused = false, timeMode = 2; // 0 dawn..6 night, start DAY
let season = 1; // 0 spring 1 summer 2 autumn 3 winter
let lapTime = 0, bestLap = 0, bestScore = 0;
let groundMesh = null, treeLeafList = [], skyMesh = null, starMesh = null, hillMeshes = [];
let cloudGroup = null, sunGlow = null, horizonGlow = null;
let visualQuality = 'high';
let spd = 0, px = 0, pvx = 0, dist = 0, score = 0, overs = 0, lap = 1;
let boost = 100, boosting = false;
let kL = false, kR = false, kU = false, kD = false, kB = false;
let shake = 0, t = 0, slide = 0, prevT = 0, combo = 0, comboT = 0, nearT = 0;
let actx, engOsc, engGain, nGain, mctx, wheelAngle = 0;
let headlightL, headlightR, beamL, beamR, snowMesh;
let trackG = null, trackId = 0, carId = 0;
let timeLeft = 60, offT = 0, countdown = 0, cdShown = -1, topSpd = 0;
let drafting = false, sunDisc = null, moonDisc = null, moonGlow = null;
let rainOn = false, rainMesh = null, muted = false;

function initAudio() {
  if (actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)();
  engOsc = actx.createOscillator(); engOsc.type = 'sawtooth'; engOsc.frequency.value = 48;
  const o2 = actx.createOscillator(); o2.type = 'square'; o2.frequency.value = 48;
  const o2g = actx.createGain(); o2g.gain.value = 0.12; o2.connect(o2g);
  engGain = actx.createGain(); engGain.gain.value = 0;
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 780;
  engOsc.connect(f); o2g.connect(f); f.connect(engGain); engGain.connect(actx.destination);
  engOsc.start(); o2.start();
  const bs = 2 * actx.sampleRate;
  const buf = actx.createBuffer(1, bs, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < bs; i++) d[i] = Math.random() * 2 - 1;
  const ns = actx.createBufferSource(); ns.buffer = buf; ns.loop = true;
  nGain = actx.createGain(); nGain.gain.value = 0;
  const nf = actx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 860;
  ns.connect(nf); nf.connect(nGain); nGain.connect(actx.destination); ns.start();
}
function rpmOf() {
  if (spd < 1) return 0.2;
  const b = [0, 18, 32, 48, 62, 80]; let g = 1;
  while (g < 5 && spd >= b[g]) g++;
  return 0.35 + 0.6 * Math.min(1.15, (spd - b[g - 1]) / (b[g] - b[g - 1]));
}
function tickAudio() {
  if (!actx || !engOsc) return;
  if (actx.state === 'suspended') actx.resume();
  const rpm = rpmOf() + (boosting ? 0.08 : 0);
  engOsc.frequency.setTargetAtTime((42 + rpm * 135 + slide * 18) * (carId === 1 ? 1.3 : 1), actx.currentTime, 0.05);
  engGain.gain.setTargetAtTime(!muted && run && !dead && !paused ? (0.035 + rpm * 0.11 + (boosting ? 0.04 : 0)) : 0, actx.currentTime, 0.07);
  nGain.gain.setTargetAtTime(!muted && slide > 0.3 ? slide * 0.07 : 0, actx.currentTime, 0.06);
}
function crashSnd() {
  if (muted) return;
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = 'sawtooth'; o.frequency.value = 80; g.gain.value = 0.22;
  o.connect(g); g.connect(actx.destination); o.start();
  o.frequency.exponentialRampToValueAtTime(18, actx.currentTime + 0.4);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.45);
  o.stop(actx.currentTime + 0.5);
}

function chime(f) {
  if (muted) return;
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = 'sine'; o.frequency.value = f; g.gain.value = 0.12;
  o.connect(g); g.connect(actx.destination); o.start();
  o.frequency.exponentialRampToValueAtTime(f * 1.5, actx.currentTime + 0.12);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.18);
  o.stop(actx.currentTime + 0.2);
}

const CARS = [
  { n: 'GT COUPE', max: 76, boost: 100, acc: 30, brk: -56, st: 56, fr: 11, cf: 0.22, lat: 13, sp: 9 },
  { n: 'RALLY', max: 68, boost: 90, acc: 36, brk: -60, st: 70, fr: 14, cf: 0.17, lat: 15, sp: 10 }
];
const TRACKS = [
  'GRAND LOOP',
  'CLOVER RUN',
  'ALPINE PASS',
  'DESERT CANYON',
  'COASTAL SPRINT',
  'REDWOOD RALLY',
  'NEON NIGHT'
];
function loadBest() {
  try {
    bestScore = parseInt(localStorage.getItem('cd3_b' + trackId + carId) || '0', 10) || 0;
    bestLap = parseFloat(localStorage.getItem('cd3_l' + trackId + carId) || '0') || 0;
  } catch (e) { bestScore = 0; bestLap = 0; }
}
function applyCar() {
  const c = CARS[carId];
  MAX_SPD = c.max; BOOST_SPD = c.boost; ACCEL = c.acc; BRAKE = c.brk; STEER_ACCEL = c.st;
  LAT_FRICTION = c.fr; CURVE_FORCE = c.cf; MAX_LAT_VEL = c.lat; CENTER_SPRING = c.sp;
  const b = document.getElementById('car-btn'), k = document.getElementById('track-btn');
  document.body.classList.toggle('rally', carId === 1);
  loadBest();
  if (b) b.textContent = 'CAR: ' + c.n;
  if (k) k.textContent = 'TRACK: ' + TRACKS[trackId];
  const sc = document.getElementById('start-car'), st = document.getElementById('start-track');
  if (sc) sc.textContent = 'CAR: ' + c.n;
  if (st) st.textContent = 'TRACK: ' + TRACKS[trackId];
}
function buildTrackWorld() {
  if (trackG) { scene.remove(trackG); trackG.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  trackG = new THREE.Group(); scene.add(trackG);
  scene.add = o => trackG.add(o);
  try { buildTrack(); createRoad(); createWorld(); } finally { delete scene.add; }
  applyDayNight(); applySeason();
}
function switchCar() { carId = (carId + 1) % CARS.length; applyCar(); flash(CARS[carId].n); }
function switchTrack() {
  trackId = (trackId + 1) % TRACKS.length;
  buildTrackWorld(); spawnTraffic(); applyCar();
  t = 0; prevT = 0; px = 0; pvx = 0; lapTime = 0;
  const q = getP(0); camera.position.set(q.x, q.y + 1.15, q.z);
  flash(TRACKS[trackId]);
}

function buildTrack() {
  const samples = 320;
  pts = [];
  const A = 165, B = 98;
  for (let i = 0; i < samples; i++) {
    const ang = (i / samples) * Math.PI * 2;
    let x = A * Math.cos(ang) + 18 * Math.sin(2 * ang);
    let z = B * Math.sin(ang) + 12 * Math.cos(2 * ang) - 6 * Math.sin(3 * ang);
    if (trackId === 1) { const r = 135 * (1 + 0.2 * Math.sin(3 * ang) + 0.08 * Math.cos(5 * ang)); x = r * Math.cos(ang); z = r * Math.sin(ang); }
    const y = trackId === 1 ? 3.2 + 3.5 * Math.sin(3 * ang) + 1.2 * Math.sin(5 * ang + 0.5) : 3.2 + 3.2 * Math.sin(2 * ang) + 1.6 * Math.sin(3 * ang + 0.5);
    pts.push(new THREE.Vector3(x, y, z));
  }
  curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.45);
  trackLen = curve.getLength();
}

function sideUp(tang) {
  let side = new THREE.Vector3(0, 1, 0).cross(tang);
  if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
  side.normalize();
  return { side, up: new THREE.Vector3().copy(tang).cross(side).normalize() };
}

function createRoad() {
  const N = pts.length, hw = ROAD_W / 2, rumble = 1.2, loft = 0.2;
  function ringAt(u) {
    const p = curve.getPointAt(u), tang = curve.getTangentAt(u).normalize();
    const { side, up } = sideUp(tang);
    return {
      p0: p.clone().addScaledVector(side, hw + rumble).addScaledVector(up, loft),
      p1: p.clone().addScaledVector(side, hw).addScaledVector(up, loft),
      p2: p.clone().addScaledVector(side, -hw).addScaledVector(up, loft),
      p3: p.clone().addScaledVector(side, -(hw + rumble)).addScaledVector(up, loft)
    };
  }
  const rings = [];
  for (let i = 0; i < N; i++) rings.push(ringAt(i / N));
  rings.push(ringAt(0));
  const pos = [], col = [], idx = [];
  const aA = new THREE.Color(0x3a3a40), aB = new THREE.Color(0x323238);
  const rA = new THREE.Color(0xe8e8e8), rB = new THREE.Color(0xb01616);
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    [r.p0, r.p1, r.p2, r.p3].forEach(q => pos.push(q.x, q.y, q.z));
    const stripe = (i >> 1) & 1;
    const cR = stripe ? aB : aA, cU = stripe ? rB : rA;
    [cU, cR, cR, cU].forEach(c => col.push(c.r, c.g, c.b));
  }
  for (let i = 0; i < N; i++) {
    const a = i * 4, b = (i + 1) * 4;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
    idx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  roadMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, map: asphaltTex(), roughness: 0.36, metalness: 0.28,
    emissive: 0x101419, emissiveIntensity: 0.22, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2
  }));
  roadMesh.receiveShadow = true;
  scene.add(roadMesh);

  const upos = [], uidx = [];
  const uhw = hw + rumble + 1.4;
  for (let i = 0; i <= N; i++) {
    const u = i === N ? 0 : i / N;
    const p = curve.getPointAt(u), tang = curve.getTangentAt(u).normalize();
    const { side, up } = sideUp(tang);
    const a = p.clone().addScaledVector(side, uhw).addScaledVector(up, loft - 0.1);
    const b = p.clone().addScaledVector(side, -uhw).addScaledVector(up, loft - 0.1);
    upos.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = (i + 1) * 2;
    uidx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const ug = new THREE.BufferGeometry();
  ug.setAttribute('position', new THREE.Float32BufferAttribute(upos, 3));
  ug.setIndex(uidx); ug.computeVertexNormals();
  underMesh = new THREE.Mesh(ug, new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 1, side: THREE.DoubleSide }));
  scene.add(underMesh);

  const lq = [], li = []; let vi = 0;
  for (let i = 0; i < N; i += 2) {
    [i / N, (i + 1) / N].forEach(u => {
      const p = curve.getPointAt(u % 1), tg = curve.getTangentAt(u % 1).normalize();
      const { side, up } = sideUp(tg);
      [-0.14, 0.14].forEach(o => { const q = p.clone().addScaledVector(side, o).addScaledVector(up, loft + 0.06); lq.push(q.x, q.y, q.z); });
    });
    li.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3); vi += 4;
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lq, 3));
  lg.setIndex(li); lg.computeVertexNormals();
  scene.add(new THREE.Mesh(lg, new THREE.MeshStandardMaterial({ color: 0xe6c850, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 })));
  for (const off of [-(hw - 0.5), hw - 0.5]) {
    const ep = [], ei = [];
    for (let i = 0; i <= N; i++) {
      const u = (i % N) / N, p = curve.getPointAt(u), tg = curve.getTangentAt(u).normalize();
      const { side, up } = sideUp(tg);
      [off - 0.1, off + 0.1].forEach(o => { const q = p.clone().addScaledVector(side, o).addScaledVector(up, loft + 0.06); ep.push(q.x, q.y, q.z); });
    }
    for (let i = 0; i < N; i++) { const a = i * 2; ei.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3)); eg.setIndex(ei); eg.computeVertexNormals();
    scene.add(new THREE.Mesh(eg, new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 })));
  }
}

function grassTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); x.fillStyle = '#c8c8c8'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2500; i++) { const v = 170 + Math.random() * 85 | 0; x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(200, 200); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

function asphaltTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#34363a';
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 9000; i++) {
    const shade = 34 + Math.random() * 28 | 0;
    ctx.fillStyle = `rgba(${shade},${shade + 1},${shade + 4},${0.12 + Math.random() * 0.2})`;
    ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 1 + Math.random() * 2, 1 + Math.random());
  }
  for (let i = 0; i < 18; i++) {
    ctx.strokeStyle = `rgba(15,18,22,${0.18 + Math.random() * 0.16})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    const x = Math.random() * c.width;
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (Math.random() - 0.5) * 80, c.height);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.5, 48);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function createWorld() {
  groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1800, 1800),
    new THREE.MeshStandardMaterial({ color: 0x1a6a14, roughness: 0.88, metalness: 0.02, map: grassTex(), bumpMap: grassTex(), bumpScale: 0.06 })
  );
  groundMesh.rotation.x = -Math.PI / 2; groundMesh.position.y = -6; groundMesh.receiveShadow = true; scene.add(groundMesh);

  // Atmospheric sky gradient keeps the horizon readable without a heavy HDR asset.
  const skyGeo = new THREE.SphereGeometry(420, 32, 16);
  skyMesh = new THREE.Mesh(skyGeo, new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      horizon: { value: new THREE.Color(0x9bd5e7) },
      zenith: { value: new THREE.Color(0x1e67a0) },
      glow: { value: new THREE.Color(0xffc28a) }
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 horizon;
      uniform vec3 zenith;
      uniform vec3 glow;
      varying vec3 vWorld;
      void main() {
        float height = clamp(normalize(vWorld).y * 0.5 + 0.5, 0.0, 1.0);
        float top = smoothstep(0.08, 0.9, height);
        vec3 color = mix(horizon, zenith, top);
        float sunset = pow(max(0.0, 1.0 - abs(normalize(vWorld).y) * 5.0), 3.0);
        color += glow * sunset * 0.18;
        gl_FragColor = vec4(color, 1.0);
      }
    `
  }));
  scene.add(skyMesh);
  sunDisc = new THREE.Mesh(new THREE.SphereGeometry(18, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff0c0, fog: false, depthWrite: false }));
  scene.add(sunDisc);
  sunGlow = new THREE.Mesh(new THREE.SphereGeometry(30, 20, 12), new THREE.MeshBasicMaterial({
    color: 0xffb866, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, fog: false, depthWrite: false
  }));
  scene.add(sunGlow);
  moonDisc = new THREE.Mesh(new THREE.SphereGeometry(13, 16, 12), new THREE.MeshBasicMaterial({
    color: 0xc9dcff, fog: false, depthWrite: false
  }));
  moonGlow = new THREE.Mesh(new THREE.SphereGeometry(23, 18, 12), new THREE.MeshBasicMaterial({
    color: 0x8db7ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, fog: false, depthWrite: false
  }));
  scene.add(moonDisc, moonGlow);
  horizonGlow = new THREE.Mesh(new THREE.SphereGeometry(260, 24, 12), new THREE.MeshBasicMaterial({
    color: 0x6da6c4, transparent: true, opacity: 0.08, side: THREE.BackSide, fog: false, depthWrite: false
  }));
  horizonGlow.position.y = -10;
  scene.add(horizonGlow);

  cloudGroup = new THREE.Group();
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xdce9f2, transparent: true, opacity: 0.28, depthWrite: false, fog: true });
  const cloudCount = visualQuality === 'low' ? 5 : visualQuality === 'medium' ? 8 : 12;
  for (let i = 0; i < cloudCount; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + (i % 3);
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(9 + (j % 2) * 5, 10, 6), cloudMat);
      puff.position.set((j - puffs / 2) * 8, (j % 2) * 3, 0);
      puff.scale.y = 0.42;
      cloud.add(puff);
    }
    const a = i / cloudCount * Math.PI * 2;
    cloud.position.set(Math.cos(a) * (240 + (i % 3) * 35), 90 + (i % 4) * 10, Math.sin(a) * (240 + (i % 2) * 40));
    cloud.scale.setScalar(0.75 + (i % 3) * 0.16);
    cloudGroup.add(cloud);
  }
  scene.add(cloudGroup);

  // stars (night only visibility toggled)
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < (visualQuality === 'low' ? 180 : visualQuality === 'medium' ? 300 : 500); i++) {
    const r = 380;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.85 + 0.05); // upper hemisphere-ish
    starPos.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi) * 0.7 + 40, r * Math.sin(phi) * Math.sin(theta));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  starMesh = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, fog: false
  }));
  starMesh.visible = false;
  scene.add(starMesh);

  // distant hills
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x2a5a28, roughness: 1, flatShading: true, fog: false });
  for (let i = 0; i < 16; i++) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(35 + Math.random() * 40, 8, 6), hillMat.clone());
    const ang = (i / 16) * Math.PI * 2 + Math.random() * 0.15;
    hill.position.set(Math.cos(ang) * 280, -18, Math.sin(ang) * 280);
    hill.scale.y = 0.28 + Math.random() * 0.12;
    scene.add(hill);
    hillMeshes.push(hill);
  }

  const cone = new THREE.ConeGeometry(1.2, 3.5, 8);
  const trG = new THREE.CylinderGeometry(0.15, 0.24, 1.0, 6);
  const bark = new THREE.MeshStandardMaterial({ color: 0x3a2510, roughness: 1 });
  treeLeafList = [];
  for (let i = 0; i < pts.length; i += 3) {
    const u = i / pts.length;
    const p = curve.getPointAt(u), tang = curve.getTangentAt(u).normalize();
    const { side } = sideUp(tang);
    [-1, 1].forEach(dir => {
      if (Math.random() > 0.32) {
        const pos = p.clone().addScaledVector(side, dir * (13.5 + Math.random() * 7));
        const scale = 0.85 + Math.random() * 0.45;
        const tr = new THREE.Mesh(trG, bark);
        tr.castShadow = visualQuality !== 'low'; tr.receiveShadow = true;
        tr.position.copy(pos); tr.position.y = p.y + 0.5 * scale; tr.scale.setScalar(scale); scene.add(tr);
        const leafMat = new THREE.MeshStandardMaterial({
          color: 0x1a6a18, roughness: 0.88, flatShading: true,
          emissive: 0x061b08, emissiveIntensity: 0.28
        });
        const lf = new THREE.Mesh(cone, leafMat);
        lf.castShadow = visualQuality === 'high'; lf.receiveShadow = true;
        lf.position.copy(pos); lf.position.y = p.y + 2.55 * scale; lf.scale.setScalar(scale); scene.add(lf);
        treeLeafList.push(lf);
        const lf2 = new THREE.Mesh(cone, leafMat); lf2.castShadow = visualQuality === 'high'; lf2.receiveShadow = true; lf2.position.copy(pos); lf2.position.y = p.y + 3.3 * scale; lf2.scale.setScalar(scale * 0.7); scene.add(lf2);
      }
    });
  }
  // roadside marker posts (speed cues)
  const postMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6, metalness: 0.3 });
  const postGeo = new THREE.CylinderGeometry(0.06, 0.08, 1.4, 5);
  const capMat = new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xaa0000, emissiveIntensity: 0.35 });
  const capGeo = new THREE.SphereGeometry(0.12, 6, 6);
  for (let i = 0; i < pts.length; i += 8) {
    const u = i / pts.length;
    const p = curve.getPointAt(u);
    const tang = curve.getTangentAt(u).normalize();
    const { side, up } = sideUp(tang);
    [-1, 1].forEach(dir => {
      const pos = p.clone().addScaledVector(side, dir * (ROAD_W * 0.5 + 1.6)).addScaledVector(up, 0.7);
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.copy(pos); scene.add(post);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.copy(pos).addScaledVector(up, 0.75); scene.add(cap);
    });
  }
}

function applyDayNight() {
  // 0 dawn, 1 sunrise, 2 day, 3 noon, 4 evening, 5 dusk, 6 night
  const modes = [
    { // dawn - dim beams
      name: 'DAWN',
      bg: 0x6a7a9a, fog: 0x6a7a9a, fogNear: 50, fogFar: 200,
      hemiI: 0.35, hemiSky: 0x8a9ab8, hemiGnd: 0x2a3a20,
      sunI: 0.45, sunCol: 0xffc090,
      lights: true, lightPow: 12, exposure: 1.0
    },
    { // sunrise
      name: 'SUNRISE',
      bg: 0xc89070, fog: 0xc89070, fogNear: 55, fogFar: 210,
      hemiI: 0.45, hemiSky: 0xe8b090, hemiGnd: 0x3a4a28,
      sunI: 0.75, sunCol: 0xffb070,
      lights: false, lightPow: 0, exposure: 1.05
    },
    { // day
      name: 'DAY',
      bg: 0x5aabd0, fog: 0x5aabd0, fogNear: 60, fogFar: 230,
      hemiI: 0.55, hemiSky: 0xb0d8f0, hemiGnd: 0x3a5820,
      sunI: 1.05, sunCol: 0xfff2d8,
      lights: false, lightPow: 0, exposure: 1.1
    },
    { // noon
      name: 'NOON',
      bg: 0x4a9cc8, fog: 0x4a9cc8, fogNear: 70, fogFar: 250,
      hemiI: 0.7, hemiSky: 0xc8e8ff, hemiGnd: 0x4a6828,
      sunI: 1.35, sunCol: 0xffffff,
      lights: false, lightPow: 0, exposure: 1.2
    },
    { // evening - headlights on
      name: 'EVENING',
      bg: 0xb07850, fog: 0xb07850, fogNear: 55, fogFar: 200,
      hemiI: 0.38, hemiSky: 0xd09060, hemiGnd: 0x3a3018,
      sunI: 0.55, sunCol: 0xff9050,
      lights: true, lightPow: 18, exposure: 1.0
    },
    { // dusk
      name: 'DUSK',
      bg: 0x3a2a48, fog: 0x3a2a48, fogNear: 50, fogFar: 180,
      hemiI: 0.22, hemiSky: 0x5a4068, hemiGnd: 0x1a1810,
      sunI: 0.25, sunCol: 0xc06080,
      lights: true, lightPow: 26, exposure: 0.95
    },
    { // night - strongest beams
      name: 'NIGHT',
      bg: 0x050812, fog: 0x050812, fogNear: 45, fogFar: 160,
      hemiI: 0.24, hemiSky: 0x183050, hemiGnd: 0x080c06,
      sunI: 0.14, sunCol: 0x6688aa,
      lights: true, lightPow: 34, exposure: 0.92
    }
  ];
  const m = modes[timeMode];
  scene.background = new THREE.Color(m.bg);
  scene.fog = new THREE.Fog(m.fog, m.fogNear, m.fogFar);
  if (season === 3) scene.fog.near = m.fogNear * 0.85;
  if (skyMesh) {
    const sky = skyMesh.material.uniforms;
    const horizon = [0xffc28a, 0xffb98a, 0x9bd5e7, 0x8bc5e3, 0xff9a68, 0x4e426e, 0x132344][timeMode];
    const zenith = [0x406a9c, 0x477fb0, 0x1e67a0, 0x17588f, 0x3e4b7f, 0x171c42, 0x040a20][timeMode];
    sky.horizon.value.setHex(horizon);
    sky.zenith.value.setHex(zenith);
    sky.glow.value.setHex(m.sunCol);
    skyMesh.visible = true;
  }
  if (horizonGlow) {
    horizonGlow.material.color.set(m.hemiSky);
    horizonGlow.material.opacity = timeMode >= 5 ? 0.045 : 0.1;
  }
  if (cloudGroup) {
    cloudGroup.visible = timeMode < 6;
    cloudGroup.traverse(o => {
      if (o.material && o.material.opacity !== undefined) o.material.opacity = timeMode >= 4 ? 0.16 : 0.28;
    });
  }
  if (sunGlow) {
    sunGlow.visible = timeMode < 6;
    sunGlow.material.color.set(m.sunCol);
    sunGlow.material.opacity = timeMode <= 1 ? 0.22 : 0.13;
  }
  if (starMesh) {
    starMesh.visible = timeMode >= 5; // dusk + night
    starMesh.material.opacity = timeMode === 6 ? 0.95 : 0.45;
  }
  if (moonDisc) {
    moonDisc.visible = timeMode >= 5;
    moonGlow.visible = moonDisc.visible;
  }
  // hill tint
  const hillCols = [0x3a5a40, 0x4a6a38, 0x2a6a30, 0x2a6a30, 0x4a4a28, 0x2a2838, 0x1a2030];
  for (const h of hillMeshes) {
    if (h.material) h.material.color.setHex(hillCols[timeMode] || 0x2a5a28).lerp(new THREE.Color(m.bg), 0.35);
  }
  hemi.intensity = m.hemiI;
  hemi.color.set(m.hemiSky);
  hemi.groundColor.set(m.hemiGnd);
  sun.intensity = m.sunI;
  sun.color.set(m.sunCol);
  if (roadMesh?.material?.emissiveIntensity !== undefined) {
    roadMesh.material.emissiveIntensity = m.lights ? 0.58 : 0.22;
  }
  renderer.toneMappingExposure = m.exposure;
  if (headlightL) {
    headlightL.visible = m.lights;
    headlightR.visible = m.lights;
    headlightL.intensity = m.lightPow;
    headlightR.intensity = m.lightPow;
  }
  if (beamL) {
    beamL.visible = m.lights;
    beamR.visible = m.lights;
    // night brighter haze, evening subtler
    const op = m.lights ? Math.min(0.12, 0.04 + m.lightPow * 0.0015) : 0;
    beamL.material.opacity = op;
    beamR.material.opacity = op;
  }
  // traffic headlight glow stronger when dark
  const glow = m.lights ? Math.min(1.5, 0.4 + m.lightPow * 0.25) : 0.15;
  for (const c of traffic) {
    c.mesh.traverse(obj => {
      if (obj.isMesh && obj.material && obj.material.emissive) {
        if (obj.material.color && obj.material.emissive.getHex() > 0) {
          obj.material.emissiveIntensity = glow;
        }
      }
    });
  }
  updateModeLabel();
}

function applySeason() {
  // 0 spring, 1 summer, 2 autumn, 3 winter
  const seasons = [
    { ground: 0x2d7a28, leaf: [0x3a9a30, 0x50b040, 0x2a8020], name: 'SPRING' },
    { ground: 0x1a6a14, leaf: [0x145c12, 0x1a7018, 0x0e4a0e], name: 'SUMMER' },
    { ground: 0x5a4a20, leaf: [0xc45a18, 0xd4a020, 0xa03010], name: 'AUTUMN' },
    { ground: 0xd8e0e8, leaf: [0xe8eef4, 0xd0d8e0, 0xc0c8d0], name: 'WINTER' }
  ];
  const s = seasons[season];
  if (groundMesh) groundMesh.material.color.setHex(s.ground);
  for (let i = 0; i < treeLeafList.length; i++) {
    const col = s.leaf[i % s.leaf.length];
    treeLeafList[i].material.color.setHex(col);
    // winter: slightly emissive snow feel
    treeLeafList[i].material.emissive.setHex(season === 3 ? 0x222228 : 0x061b08);
    treeLeafList[i].material.emissiveIntensity = season === 3 ? 0.18 : 0.28;
  }
  // Keep fog changes reversible when switching seasons repeatedly.
  if (scene.fog) {
    const modeFogNear = [50, 55, 60, 70, 55, 50, 45][timeMode];
    scene.fog.near = season === 3 ? modeFogNear * 0.85 : modeFogNear;
  }
  if (snowMesh) snowMesh.visible = season === 3;
  setRain(season === 0);
  updateModeLabel();
}

function setRain(on) {
  rainOn = on;
  if (!rainMesh) {
    const p = new Float32Array(4200);
    for (let i = 0; i < p.length; i += 6) {
      p[i] = (Math.random() - 0.5) * 60; p[i + 1] = (Math.random() - 0.5) * 60; p[i + 2] = (Math.random() - 0.5) * 60;
      p[i + 3] = p[i]; p[i + 4] = p[i + 1] + 0.9; p[i + 5] = p[i + 2];
    }
    const gm = new THREE.BufferGeometry(); gm.setAttribute('position', new THREE.BufferAttribute(p, 3));
    rainMesh = new THREE.LineSegments(gm, new THREE.LineBasicMaterial({ color: 0xb9d8ee, transparent: true, opacity: 0.48, linewidth: 1 }));
    rainMesh.frustumCulled = false; scene.add(rainMesh);
  }
  rainMesh.visible = on;
  rainMesh.material.opacity = visualQuality === 'low' ? 0.3 : 0.48;
  if (roadMesh) { roadMesh.material.roughness = on ? 0.18 : 0.55; roadMesh.material.metalness = on ? 0.5 : 0.25; }
}
function tickRain(dt) {
  if (!rainMesh || !rainMesh.visible) return;
  const a = rainMesh.geometry.attributes.position.array, c = camera.position, cc = [c.x, c.y, c.z];
  for (let j = 0; j < a.length; j += 6) {
    a[j + 1] -= 38 * dt;
    for (let k = 0; k < 3; k++) a[j + k] = cc[k] + ((a[j + k] - cc[k] + 30) % 60 + 60) % 60 - 30;
    a[j + 3] = a[j]; a[j + 4] = a[j + 1] + 0.9; a[j + 5] = a[j + 2];
  }
  rainMesh.geometry.attributes.position.needsUpdate = true;
}
function initSnow() {
  const p = new Float32Array(1500);
  for (let i = 0; i < p.length; i++) p[i] = (Math.random() - 0.5) * 60;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  snowMesh = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xf2f8ff, size: visualQuality === 'low' ? 0.16 : 0.22, transparent: true, opacity: 0.88, depthWrite: false }));
  snowMesh.frustumCulled = false; snowMesh.visible = false;
  scene.add(snowMesh);
}
function tickSnow(dt) {
  if (!snowMesh || !snowMesh.visible) return;
  const a = snowMesh.geometry.attributes.position.array, c = camera.position, cc = [c.x, c.y, c.z];
  for (let i = 0; i < a.length; i += 3) {
    a[i + 1] -= 5 * dt;
    for (let k = 0; k < 3; k++) a[i + k] = cc[k] + ((a[i + k] - cc[k] + 30) % 60 + 60) % 60 - 30;
  }
  snowMesh.geometry.attributes.position.needsUpdate = true;
}
function updateModeLabel() {
  const times = ['DAWN','SUNRISE','DAY','NOON','EVENING','DUSK','NIGHT'];
  const seasons = ['SPRING','SUMMER','AUTUMN','WINTER'];
  const el = document.getElementById('mode-btn');
  if (el) el.textContent = times[timeMode] + ' · ' + seasons[season];
}


function prof(pts, w, bev) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const gm = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, steps: 1 });
  gm.rotateY(-Math.PI / 2); gm.translate(w / 2, 0, 0);
  return gm;
}
const KINDS = {
  sedan: [[.6, .95], [.05, 1.38], [-.95, 1.38], [-1.5, .95]],
  hatch: [[.6, .95], [.1, 1.4], [-1.3, 1.4], [-1.8, .95]],
  suv: [[.7, .95], [.35, 1.62], [-1.5, 1.62], [-1.75, .95]],
  sports: [[.3, .95], [-.25, 1.25], [-1.0, 1.25], [-1.35, .95]],
  van: [[.85, .95], [.75, 1.8], [-1.9, 1.8], [-1.95, .95]]
};
function makeCar(color, big) {
  const g = new THREE.Group();
  const M = (c, r, m) => new THREE.MeshPhysicalMaterial({
    color: c, roughness: r, metalness: m, clearcoat: m > 0.25 ? 0.35 : 0, clearcoatRoughness: 0.18
  });
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); return m; };
  const tire = M(0x0b0b0c, 0.9, 0), rim = M(0xb8bcc0, 0.3, 0.8), dark = M(0x111214, 0.6, 0.2), glass = M(0x14202c, 0.08, 0.85), chrome = M(0xc8ccd0, 0.2, 0.9);
  const wheel = (x, z, r, w) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), tire); t.rotation.z = Math.PI / 2; t.position.set(x, r, z); g.add(t);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, w + 0.02, 10), rim); h.rotation.z = Math.PI / 2; h.position.set(x, r, z); g.add(h);
  };
  const lamp = (x, y, z, w, col, em, i) => box(w, 0.1, 0.05, new THREE.MeshStandardMaterial({ color: col, emissive: em, emissiveIntensity: i, roughness: 0.3 }), x, y, z);
  const shadow = (w, d, z) => {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }));
    sh.rotation.x = -Math.PI / 2; sh.position.set(0, 0.01, z); g.add(sh);
  };
  const paint = M(color, 0.28, 0.35);
  if (big) {
    if (Math.random() < 0.4) {
      box(2.4, 2.9, 9.5, paint, 0, 1.75, 0);
      box(2.42, 0.95, 8.8, glass, 0, 2.3, 0); box(2.3, 0.8, 0.05, glass, 0, 2.2, 4.77);
      box(2.42, 0.1, 9.5, M(0xeeeeee, 0.5, 0.1), 0, 3.25, 0);
      [[-1.1, 3.1], [1.1, 3.1], [-1.1, -2.9], [1.1, -2.9]].forEach(([x, z]) => wheel(x, z, 0.5, 0.32));
      [-0.8, 0.8].forEach(x => lamp(x, 0.9, 4.77, 0.4, 0xfff5c0, 0xffe080, 0.8));
      [-0.9, 0.9].forEach(x => lamp(x, 0.9, -4.77, 0.4, 0xff2020, 0xaa0000, 0.5));
      shadow(2.6, 9.8, 0);
    } else {
      box(2.1, 2.0, 2.0, paint, 0, 1.4, 3.0);
      box(1.9, 0.8, 0.06, glass, 0, 1.85, 4.02);
      box(0.9, 0.6, 0.05, chrome, 0, 0.95, 4.03); box(2.2, 0.28, 0.2, chrome, 0, 0.5, 4.1);
      [-0.9, 0.9].forEach(x => { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.3, 8), chrome); s.position.set(x, 2.9, 2.1); g.add(s); });
      box(2.0, 0.5, 8.4, dark, 0, 0.6, 0.4);
      box(2.3, 2.7, 5.8, M(0xdcdcdc, 0.6, 0.1), 0, 2.15, -1.0);
      box(2.32, 0.45, 5.8, paint, 0, 2.4, -1.0);
      [[-1, 3], [1, 3], [-1, -2.2], [1, -2.2], [-1, -3.4], [1, -3.4]].forEach(([x, z]) => wheel(x, z, 0.5, 0.32));
      [-0.7, 0.7].forEach(x => lamp(x, 0.95, 4.03, 0.35, 0xfff5c0, 0xffe080, 0.8));
      [-0.85, 0.85].forEach(x => lamp(x, 0.95, -3.93, 0.4, 0xff2020, 0xaa0000, 0.5));
      shadow(2.6, 8.6, 0.4);
    }
    return g;
  }
  const r = Math.random(), kind = r < 0.3 ? 'sedan' : r < 0.5 ? 'hatch' : r < 0.7 ? 'suv' : r < 0.85 ? 'sports' : 'van';
  const gh = KINDS[kind], sy = kind === 'sports' ? 0.88 : 1;
  const body = new THREE.Mesh(prof([[-2, .3], [2, .3], [2, .62], [1.7, .82], [.7, .95], [-1.5, .95], [-1.9, .88], [-2, .65]], 1.75, 0.05), paint);
  const cab = new THREE.Mesh(prof(gh, 1.5, 0.02), glass);
  body.scale.y = sy; cab.scale.y = sy; g.add(body); g.add(cab);
  const topY = gh[1][1] * sy, rz = (gh[1][0] + gh[2][0]) / 2;
  box(1.4, 0.05, gh[1][0] - gh[2][0], paint, 0, topY + 0.02, rz);
  [-0.95, 0.95].forEach(x => box(0.1, 0.08, 0.14, paint, x, 0.98 * sy, gh[0][0] - 0.1));
  box(1.8, 0.16, 0.14, dark, 0, 0.38, 2.0); box(1.8, 0.16, 0.14, dark, 0, 0.38, -2.0);
  box(0.9, 0.14, 0.04, dark, 0, 0.55, 2.06); box(0.4, 0.12, 0.03, M(0xeeeeee, 0.5, 0), 0, 0.5, -2.07);
  if (kind === 'sports') box(1.5, 0.05, 0.3, dark, 0, 1.1, -1.85);
  [[-0.88, 1.25], [0.88, 1.25], [-0.88, -1.25], [0.88, -1.25]].forEach(([x, z]) => wheel(x, z, 0.34, 0.24));
  [-0.55, 0.55].forEach(x => lamp(x, 0.55, 2.08, 0.34, 0xfff5c0, 0xffe080, 0.8));
  [-0.58, 0.58].forEach(x => lamp(x, 0.6, -2.08, 0.4, 0xff2020, 0xaa0000, 0.5));
  shadow(2, 4.3, 0);
  return g;
}

function makeCarV2(color, truck) {
  const g = new THREE.Group();
  const M = (c, r, m) => new THREE.MeshPhysicalMaterial({
    color: c, roughness: r, metalness: m, clearcoat: m > 0.25 ? 0.3 : 0, clearcoatRoughness: 0.2
  });
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); return m; };
  const tire = M(0x0b0b0c, 0.9, 0), rim = M(0xb8bcc0, 0.3, 0.8), dark = M(0x111214, 0.6, 0.2), glass = M(0x14202c, 0.08, 0.85);
  const wheel = (x, z, r, w) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), tire); t.rotation.z = Math.PI / 2; t.position.set(x, r, z); g.add(t);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, w + 0.02, 10), rim); h.rotation.z = Math.PI / 2; h.position.set(x, r, z); g.add(h);
  };
  const lamp = (x, y, z, w, col, em, i) => box(w, 0.1, 0.05, new THREE.MeshStandardMaterial({ color: col, emissive: em, emissiveIntensity: i, roughness: 0.3 }), x, y, z);
  const shadow = (w, d, z) => {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }));
    sh.rotation.x = -Math.PI / 2; sh.position.set(0, 0.01, z); g.add(sh);
  };
  const paint = M(color, truck ? 0.35 : 0.28, 0.35);
  if (truck) {
    box(2.1, 2.0, 2.0, paint, 0, 1.4, 3.0);
    box(1.9, 0.8, 0.06, glass, 0, 1.85, 4.02);
    box(2.0, 0.5, 8.4, dark, 0, 0.6, 0.4);
    box(2.3, 2.7, 5.8, M(0xdcdcdc, 0.6, 0.1), 0, 2.15, -1.0);
    [[-1, 3], [1, 3], [-1, -2.2], [1, -2.2], [-1, -3.4], [1, -3.4]].forEach(([x, z]) => wheel(x, z, 0.5, 0.32));
    [-0.7, 0.7].forEach(x => lamp(x, 0.95, 4.03, 0.35, 0xfff5c0, 0xffe080, 0.8));
    [-0.85, 0.85].forEach(x => lamp(x, 0.95, -3.93, 0.4, 0xff2020, 0xaa0000, 0.5));
    shadow(2.6, 8.6, 0.4);
    return g;
  }
  const k = Math.random(), ch = k < 0.5 ? 0.42 : k < 0.8 ? 0.58 : 0.46, cl = k < 0.5 ? 1.5 : k < 0.8 ? 2.0 : 1.3, cz = k < 0.5 ? -0.2 : k < 0.8 ? -0.3 : -0.55;
  box(1.72, 0.4, 3.9, paint, 0, 0.5, 0);
  const cg = new THREE.CylinderGeometry(0.62, 0.9, ch, 4); cg.rotateY(Math.PI / 4);
  const cab = new THREE.Mesh(cg, glass); cab.scale.set(1, 1, cl / 1.27); cab.position.set(0, 0.7 + ch / 2, cz); g.add(cab);
  box(0.9, 0.04, cl * 0.7, paint, 0, 0.7 + ch + 0.02, cz);
  [-0.98, 0.98].forEach(x => box(0.1, 0.08, 0.14, paint, x, 0.82, cz + cl * 0.3));
  box(1.76, 0.18, 0.12, dark, 0, 0.36, 1.97); box(1.76, 0.18, 0.12, dark, 0, 0.36, -1.97);
  box(0.9, 0.14, 0.04, dark, 0, 0.52, 1.96); box(0.4, 0.12, 0.03, M(0xeeeeee, 0.5, 0), 0, 0.45, -1.99);
  [[-0.88, 1.2], [0.88, 1.2], [-0.88, -1.2], [0.88, -1.2]].forEach(([x, z]) => wheel(x, z, 0.34, 0.24));
  [-0.55, 0.55].forEach(x => lamp(x, 0.55, 1.96, 0.34, 0xfff5c0, 0xffe080, 0.8));
  [-0.58, 0.58].forEach(x => lamp(x, 0.58, -1.96, 0.4, 0xff2020, 0xaa0000, 0.5));
  shadow(2, 4, 0);
  return g;
}

function makeCarOld(color) {
  const g = new THREE.Group();
  const bodyM = new THREE.MeshPhysicalMaterial({ color, roughness: 0.24, metalness: 0.62, clearcoat: 0.45, clearcoatRoughness: 0.16 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.38, 3.6), bodyM);
  body.position.y = 0.44; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.4, 1.4), dark);
  cabin.position.set(0, 0.82, -0.1); g.add(cabin);
  const wG = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10);
  const wM = new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.9 });
  [[-0.88, 0.32, 1.1], [0.88, 0.32, 1.1], [-0.88, 0.32, -1.1], [0.88, 0.32, -1.1]].forEach(([x, y, z]) => {
    const w = new THREE.Mesh(wG, wM); w.rotation.z = Math.PI / 2; w.position.set(x, y, z); g.add(w);
  });
  // headlights for traffic at night
  const hl = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 6, 6),
    new THREE.MeshStandardMaterial({ color: 0xfff5c0, emissive: 0xffe080, emissiveIntensity: 0.8 })
  );
  hl.position.set(-0.45, 0.48, 1.85); g.add(hl);
  const hr = hl.clone(); hr.position.x = 0.45; g.add(hr);
  const tm = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xaa0000, emissiveIntensity: 0.4 });
  [-0.42, 0.42].forEach(x => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.05), tm);
    l.position.set(x, 0.46, -1.85); g.add(l);
  });
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(2, 4), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.01; g.add(sh);
  return g;
}

function spawnTraffic() {
  traffic.forEach(c => scene.remove(c.mesh));
  traffic = [];
  const cols = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c];
  for (let i = 0; i < CARS_N; i++) {
    const big = Math.random() < 0.18;
    const mesh = makeCar(cols[Math.random() * cols.length | 0], big);
    mesh.traverse(obj => {
      if (obj.isMesh) {
        obj.castShadow = visualQuality === 'high';
        obj.receiveShadow = true;
      }
    });
    scene.add(mesh);
    traffic.push({
      mesh, t: 0.07 + (Math.floor(i / 3) + 0.2 + Math.random() * 0.6) / Math.ceil(CARS_N / 3) * 0.86 + (i % 3) * 0.035, lane: i % 3,
      off: (i % 3 - 1) * 5,
      spd: big ? 16 + Math.random() * 8 : 20 + Math.random() * 30, big, done: false
    });
  }
}

function getP(tt) { tt = ((tt % 1) + 1) % 1; return curve.getPointAt(tt); }
function getT(tt) { tt = ((tt % 1) + 1) % 1; return curve.getTangentAt(tt).normalize(); }
function getKappa(tt) {
  const ds = 6, dT = ds / trackLen;
  const t1 = getT(tt), t2 = getT(tt + dT);
  return (t1.x * t2.z - t1.z * t2.x) / ds;
}
function place(mesh, tt, lateral) {
  const p = getP(tt), tang = getT(tt);
  const { side, up } = sideUp(tang);
  mesh.position.copy(p).addScaledVector(side, lateral).addScaledVector(up, 0.24);
  mesh.up.copy(up);
  mesh.lookAt(mesh.position.clone().add(tang));
}

function initSmoke() {
  smokeG = new THREE.Group(); scene.add(smokeG);
  const geo = new THREE.SphereGeometry(0.28, 5, 4);
  for (let i = 0; i < 20; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x999, transparent: true, opacity: 0.2, depthWrite: false }));
    m.visible = false;
    m.userData = { life: 0, max: 1, vel: new THREE.Vector3() };
    smokeG.add(m);
  }
}
function tickSmoke(dt) {
  if (!smokeG) return;
  for (const m of smokeG.children) {
    if (!m.visible) continue;
    m.userData.life += dt;
    const k = m.userData.life / m.userData.max;
    if (k >= 1) { m.visible = false; continue; }
    m.position.addScaledVector(m.userData.vel, dt);
    m.userData.vel.y += 0.6 * dt;
    m.scale.multiplyScalar(1 + 0.6 * dt);
    m.material.opacity = (1 - k) * 0.22;
  }
}

function drawMap() {
  if (!mctx || !pts.length) return;
  const ctx = mctx, w = 90, h = 90;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, w, h);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const sc = Math.min((w - 16) / (maxX - minX || 1), (h - 16) / (maxZ - minZ || 1));
  const ox = w / 2 - (minX + maxX) / 2 * sc, oz = h / 2 - (minZ + maxZ) / 2 * sc;
  ctx.strokeStyle = '#777'; ctx.lineWidth = 3; ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], x = p.x * sc + ox, y = p.z * sc + oz;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.stroke();
  const pp = getP(t);
  ctx.fillStyle = '#f30'; ctx.beginPath(); ctx.arc(pp.x * sc + ox, pp.z * sc + oz, 3.5, 0, 6.3); ctx.fill();
  drawMirror();
}

function drawMirror() {
  const mc = document.getElementById('mrc');
  if (!mc || !curve) return;
  const ctx = mc.getContext('2d');
  const w = mc.width, h = mc.height;
  const skies = ['#6a7a9a','#c89070','#5aabd0','#4a9cc8','#b07850','#3a2a48','#060a14'];
  const grounds = ['#2a4030','#3a5030','#145010','#1a6018','#3a4020','#1a1810','#0a2010'];
  ctx.fillStyle = skies[timeMode] || skies[2];
  ctx.fillRect(0, 0, w, h * 0.42);
  ctx.fillStyle = grounds[timeMode] || grounds[2];
  ctx.fillRect(0, h * 0.42, w, h * 0.58);
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.moveTo(w * 0.36, h * 0.42); ctx.lineTo(w * 0.64, h * 0.42);
  ctx.lineTo(w * 0.92, h); ctx.lineTo(w * 0.08, h);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#a09040'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.42); ctx.lineTo(w * 0.5, h); ctx.stroke();
  ctx.setLineDash([]);
  for (const c of traffic) {
    const back = ((t - c.t) + 1) % 1;
    if (back > 0.002 && back < 0.07) {
      const depth = back / 0.07;
      const mx = w * 0.5 + (c.off - px) * 3.5 * (1 - depth);
      const my = h * 0.42 + depth * h * 0.52;
      const sz = 5 * (1 - depth * 0.65);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(mx - sz / 2, my - sz / 2, sz, sz * 0.55);
    }
  }
}

function flash(txt) {
  const el = document.getElementById('combo');
  el.textContent = txt; el.style.opacity = '1';
  clearTimeout(el._t); el._t = setTimeout(() => el.style.opacity = '0', 800);
}

function formatTime(sec) {
  const s = Math.max(0, sec|0);
  const m = (s / 60) | 0;
  const r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

function updateDash() {
  const mph = Math.round(spd * 2.237);
  const gear = spd < 1 ? 'N' : spd < 18 ? '1' : spd < 32 ? '2' : spd < 48 ? '3' : spd < 62 ? '4' : '5';
  const speedReadout = document.getElementById('speed-readout');
  const speedUnit = document.getElementById('speed-unit');
  speedReadout.firstChild.nodeValue = mph;
  speedUnit.textContent = 'mph · ' + gear;
  document.getElementById('dash-lap-value').textContent = lap;
  document.getElementById('dash-score-value').textContent = Math.floor(score);
  const status = document.getElementById('dash-status');
  status.textContent = boosting ? 'BOOST ACTIVE' : Math.abs(px) >= ROAD_W * 0.5 ? 'OFF TRACK' : slide > 0.5 ? 'CORNER LOAD' : gear === 'N' ? 'READY TO DRIVE' : 'CRUISING';
  status.style.color = boosting ? '#5ddcff' : Math.abs(px) >= ROAD_W * 0.5 ? '#ff9b72' : slide > 0.5 ? '#ffd36e' : '#728b8a';
  document.getElementById('spd-needle').style.transform = `rotate(${-120 + Math.min(220, mph) / 220 * 240}deg)`;
  const rpm = Math.min(1, rpmOf() + (boosting ? 0.06 : 0));
  document.getElementById('rpm-needle').style.transform = `rotate(${-120 + rpm * 240}deg)`;
  const targetWheel = ((kL ? 1 : 0) + (kR ? -1 : 0)) * 38;
  wheelAngle += (targetWheel - wheelAngle) * 0.18;
  document.getElementById('wheel').style.transform = `translateX(-50%) rotate(${wheelAngle}deg)`;
  document.getElementById('boost-fill').style.width = boost + '%';
}

function update(dt) {
  if (!run || dead || paused) { tickAudio(); return; }
  if (countdown > 0) {
    countdown -= dt;
    const n = Math.max(0, Math.ceil(countdown));
    if (n !== cdShown) { cdShown = n; flash(n > 0 ? String(n) : 'GO!'); chime(n > 0 ? 440 : 880); }
    if (countdown > 0) { tickAudio(); return; }
  }

  boosting = kB && boost > 5 && spd > 8;
  if (boosting) { boost = Math.max(0, boost - 22 * dt); spd += ACCEL * 1.55 * dt; }
  else boost = Math.min(100, boost + 10 * dt);
  if (kU) spd += ACCEL * (1 - 0.65 * Math.pow(spd / MAX_SPD, 2)) * dt;
  else if (kD) spd += BRAKE * (rainOn ? 0.8 : 1) * dt;
  else spd += COAST * dt;

  const maxS = boosting ? BOOST_SPD : MAX_SPD;
  if (Math.abs(px) >= ROAD_W * 0.5) {
    spd += OFFROAD * dt;
    pvx -= Math.sign(px || 1) * 8 * dt;
    if (spd > 12 && smokeG) {
      const p = getP(t);
      const tang = getT(t);
      const { side, up } = sideUp(tang);
      const pos = p.clone().addScaledVector(side, px).addScaledVector(up, 0.2);
      const m = smokeG.children.find(c => !c.visible);
      if (m) {
        m.visible = true;
        m.position.copy(pos);
        m.scale.setScalar(0.5);
        m.material.opacity = 0.25;
        m.userData.life = 0; m.userData.max = 0.4;
        m.userData.vel.set((Math.random()-0.5), 0.8, (Math.random()-0.5));
      }
    }
  }
  if (drafting) spd += 7 * dt;
  drafting = false;
  spd -= getT(t).y * 25 * dt;
  spd = THREE.MathUtils.clamp(spd, 0, maxS);

  const steerIn = (kL ? 1 : 0) + (kR ? -1 : 0);
  pvx += steerIn * STEER_ACCEL * Math.min(1, spd / 10) * (1 - 0.3 * Math.min(1, spd / MAX_SPD)) * dt;
  const kappa = getKappa(t);
  pvx += -spd * spd * kappa * CURVE_FORCE * dt;
  pvx -= Math.sign(px) * Math.max(0, Math.abs(px) - 3) * CENTER_SPRING * 0.5 * dt;
  pvx -= pvx * LAT_FRICTION * (rainOn ? 0.75 : 1) * dt;
  pvx = THREE.MathUtils.clamp(pvx, -MAX_LAT_VEL, MAX_LAT_VEL);
  px += pvx * dt;
  px = THREE.MathUtils.clamp(px, -ROAD_W * 0.9, ROAD_W * 0.9);

  slide = Math.min(1, Math.max(0, (Math.abs(spd * spd * kappa) - 20) / 30));

  prevT = t;
  t = (t + (spd * dt) / trackLen) % 1;
  lapTime += dt;
  timeLeft -= dt;
  if (timeLeft <= 0) { doCrash('TIME UP!'); return; }
  if (prevT > 0.9 && t < 0.1) {
    // proper order each lap: dawnâ†’sunriseâ†’dayâ†’noonâ†’eveningâ†’duskâ†’nightâ†’...
    timeMode = (timeMode + 1) % 7;
    applyDayNight();
    // after a full day cycle (back to same slot from start), shift season
    // advance season every 7 laps
    const newBest = bestLap <= 0 || lapTime < bestLap;
    if (newBest) bestLap = lapTime;
    if (lap % 7 === 0) {
      season = (season + 1) % 4;
      applySeason();
      const sn = ['SPRING','SUMMER','AUTUMN','WINTER'][season];
      flash(sn + ' · ' + ['DAWN','SUNRISE','DAY','NOON','EVENING','DUSK','NIGHT'][timeMode]);
    } else if (newBest) {
      flash('BEST LAP ' + formatTime(bestLap));
    } else {
      flash('LAP ' + (lap + 1));
    }
    lap++; timeLeft = Math.min(99, timeLeft + 25); chime(660);
    score += 500;
    lapTime = 0;
  }
  dist += spd * dt; topSpd = Math.max(topSpd, spd);
  score += Math.floor(spd * dt * 1.1);
  if (boosting) score += Math.floor(spd * dt * 0.35);

  tickSmoke(dt); tickSnow(dt); tickRain(dt);
  nearT = Math.max(0, nearT - dt);
  comboT = Math.max(0, comboT - dt);
  if (comboT <= 0) combo = 0;

  const eye = getP(t), tang = getT(t);
  const { side, up } = sideUp(tang);
  const eyePos = eye.clone().addScaledVector(side, px).addScaledVector(up, 1.15).addScaledVector(tang, 0.4);

  // Low beams: bumper height, aimed down onto asphalt ~10â€“12m ahead
  if (headlightL) {
    const carPos = eye.clone().addScaledVector(side, px);
    // Headlamp height ~0.65m, slight forward of cabin
    const bumper = carPos.clone().addScaledVector(up, 0.65).addScaledVector(tang, 1.1);
    const posL = bumper.clone().addScaledVector(side, -0.95);
    const posR = bumper.clone().addScaledVector(side,  0.95);
    // Dipped beam: hit road surface, slight outward for twin pools
    const aimL = carPos.clone().addScaledVector(up, 0.02).addScaledVector(tang, 11).addScaledVector(side, -1.6);
    const aimR = carPos.clone().addScaledVector(up, 0.02).addScaledVector(tang, 11).addScaledVector(side,  1.6);

    headlightL.position.copy(posL);
    headlightR.position.copy(posR);
    headlightL.target.position.copy(aimL);
    headlightR.target.position.copy(aimR);
    headlightL.target.updateMatrixWorld(true);
    headlightR.target.updateMatrixWorld(true);

    if (beamL && beamR) {
      for (const [beam, from, to] of [[beamL, posL, aimL], [beamR, posR, aimR]]) {
        const mid = from.clone().add(to).multiplyScalar(0.5);
        beam.position.copy(mid);
        beam.up.copy(up);
        beam.lookAt(to);
        beam.rotateX(Math.PI / 2);
      }
    }
  }

  for (const c of traffic) {
    // mild AI: ease off if player is right behind
    const ahead = ((c.t - t) + 1) % 1;
    if (ahead > 0.004 && ahead < 0.03 && Math.abs(px - c.off) < 2.2) drafting = true;
    let aiSpd = c.spd * (1 + Math.min(0.3, (lap - 1) * 0.03));
    if (ahead < 0.04 && ahead > 0 && Math.abs(px - c.off) < 4) aiSpd *= 0.85;
    let tgt = aiSpd;
    for (const d of traffic) {
      if (d === c || d.lane !== c.lane) continue;
      const gap = ((d.t - c.t) + 1) % 1 * trackLen - ((c.big ? 9 : 4.2) + (d.big ? 9 : 4.2)) / 2;
      if (gap < 45) tgt = Math.min(tgt, (d.cur || d.spd) + Math.max(0, gap - 30) * 0.6);
    }
    if (!c.cur) c.cur = tgt;
    c.cur += (tgt - c.cur) * Math.min(1, 6 * dt);
    c.t = (c.t + (c.cur * dt) / trackLen) % 1;
    place(c.mesh, c.t, c.off);
    const dT = ((c.t - t) + 1) % 1;
    c.mesh.visible = dT < 0.38 || dT > 0.9;
    const lat = Math.abs(px - c.off);
    const nearDT = ((t - c.t) + 1) % 1;
    if (!c.done && nearDT < 0.014 && nearDT > 0 && lat < 5.5) {
      c.done = true; overs++; combo++; comboT = 3;
      score += 150 + combo * 30; boost = Math.min(100, boost + 8);
      flash(combo > 1 ? `x${combo} OVERTAKE` : 'OVERTAKE');
      timeLeft = Math.min(99, timeLeft + 1.5); chime(880);
      if (lat < 3.6 && spd > 35) { score += 75; timeLeft += 1; flash('CLOSE PASS +75'); }
    }
    if (nearDT > 0.06) { c.done = false; c.hit = false; }
    if (nearDT < 0.009 && lat < (c.big ? 2.7 : 2.2) && spd > c.spd * 0.8 && !c.hit) {
      c.hit = true;
      spd *= 0.5; pvx *= 0.3; timeLeft -= 3; chime(120); pvx += (px >= c.off ? 1 : -1) * 7; score = Math.max(0, score - 50); shake = 0.55; combo = 0;
    }
  }

  if (Math.abs(px) > ROAD_W * 0.5 + 0.6 && spd > 28) offT += dt; else offT = Math.max(0, offT - dt * 2);
  if (offT > 0.9 || (Math.abs(px) > ROAD_W * 0.8 && spd > MAX_SPD * 0.4)) { doCrash('RAN OFF THE ROAD!'); return; }

  const lean = THREE.MathUtils.clamp(-pvx * 0.02 - steerIn * 0.04, -0.12, 0.12);
  const camUp = up.clone().applyAxisAngle(tang, lean);
  const look = eyePos.clone().addScaledVector(tang, 28).addScaledVector(up, -0.2).addScaledVector(side, px * 0.015 + lean * 2);
  if (shake > 0) {
    eyePos.x += (Math.random() - 0.5) * shake * 0.35;
    eyePos.y += (Math.random() - 0.5) * shake * 0.2;
    shake = Math.max(0, shake - dt * 2.5);
  }
  if (spd > 20) eyePos.y += Math.sin(performance.now() * 0.04) * 0.012 * (spd / MAX_SPD);
  camera.position.lerp(eyePos, 1 - Math.pow(0.0008, dt));
  camera.up.copy(camUp);
  camera.lookAt(look);
  if (sunDisc) {
    const e = [0.08, 0.12, 0.3, 0.55, 0.15, 0.04, -0.2][timeMode];
    sunDisc.visible = timeMode < 6; sunDisc.material.color.copy(sun.color);
    sunDisc.position.set(0.7, e, 0.65).normalize().multiplyScalar(450).add(camera.position);
    if (sunGlow) {
      sunGlow.visible = sunDisc.visible;
      sunGlow.position.copy(sunDisc.position);
      sunGlow.scale.setScalar(1 + Math.sin(performance.now() * 0.001) * 0.03);
    }
    if (moonDisc) {
      const moonHeight = timeMode === 6 ? 0.62 : 0.48;
      moonDisc.position.set(-0.72, moonHeight, -0.5).normalize().multiplyScalar(430).add(camera.position);
      moonGlow.position.copy(moonDisc.position);
    }
  }
  camera.fov = 66 + (spd / MAX_SPD) * 14 + (boosting ? 6 : 0);
  camera.updateProjectionMatrix();

  document.getElementById('dist').textContent = Math.floor(dist);
  const tle = document.getElementById('tl');
  tle.textContent = Math.ceil(timeLeft); tle.style.color = timeLeft < 10 ? '#f55' : '';
  document.getElementById('lines').style.opacity = Math.max(0, (spd - 45) / 50);
  document.getElementById('score').textContent = Math.floor(score);
  document.getElementById('over').textContent = overs;
  document.getElementById('lap').textContent = lap;
  const lt = document.getElementById('laptime');
  if (lt) lt.textContent = formatTime(lapTime);
  const bs = document.getElementById('best');
  if (bs) bs.textContent = Math.floor(Math.max(bestScore, score));
  const tip = document.getElementById('tip');
  if (Math.abs(px) >= ROAD_W * 0.5) { tip.textContent = offT > 0.3 ? 'GET BACK ON THE ROAD!' : 'OFF TRACK'; tip.style.opacity = '1'; }
  else if (slide > 0.5) { tip.textContent = 'EASE OFF'; tip.style.opacity = '1'; }
  else if (drafting) { tip.textContent = 'SLIPSTREAM'; tip.style.opacity = '0.7'; }
  else if (boosting) { tip.textContent = 'BOOST'; tip.style.opacity = '0.7'; }
  else tip.style.opacity = '0';

  updateDash(); tickAudio(); drawMap();
}

function doCrash(why) {
  dead = true; run = false; paused = false; shake = 1; combo = 0; pvx = 0;
  crashSnd();
  document.querySelector('#crash h2').textContent = why || 'CRASHED!';
  if (score > bestScore) {
    bestScore = score;
    try { localStorage.setItem('cd3_b' + trackId + carId, String(bestScore|0)); } catch (e) {}
  }
  if (bestLap > 0) {
    try { localStorage.setItem('cd3_l' + trackId + carId, String(bestLap)); } catch (e) {}
  }
  document.getElementById('final').textContent = Math.floor(bestScore > score ? bestScore : score) + ' (run ' + Math.floor(score) + ')';
  const fl = document.getElementById('final-lap');
  if (fl) fl.textContent = bestLap > 0 ? formatTime(bestLap) : '—';
  document.getElementById('final-stats').textContent = 'Laps ' + (lap - 1) + ' · Overtakes ' + overs + ' · Top ' + Math.round(topSpd * 2.237) + ' mph';
  document.getElementById('crash').style.display = 'flex';
  ['dash', 'hud-top', 'minimap', 'mirror', 'hood', 'mode-btn', 'pause-btn', 'car-btn', 'track-btn', 'touch-controls'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('pause').style.display = 'none';
}

function frame() {
  requestAnimationFrame(frame);
  if (cloudGroup) cloudGroup.rotation.y += 0.000035;
  if (sunDisc && camera) {
    const e = [0.08, 0.12, 0.3, 0.55, 0.15, 0.04, -0.2][timeMode];
    sunDisc.visible = timeMode < 6;
    sunDisc.position.set(0.7, e, 0.65).normalize().multiplyScalar(450).add(camera.position);
    if (sunGlow) {
      sunGlow.visible = sunDisc.visible;
      sunGlow.position.copy(sunDisc.position);
    }
    if (moonDisc) {
      const moonHeight = timeMode === 6 ? 0.62 : 0.48;
      moonDisc.visible = timeMode >= 5;
      moonGlow.visible = moonDisc.visible;
      moonDisc.position.set(-0.72, moonHeight, -0.5).normalize().multiplyScalar(430).add(camera.position);
      moonGlow.position.copy(moonDisc.position);
    }
  }
  update(Math.min(0.04, clock.getDelta()));
  renderer.render(scene, camera);
}

function onKey(e, down) {
  if (down && !e.repeat && (e.code === 'Escape' || e.code === 'KeyP')) {
    if (run && !dead) togglePause();
    return;
  }
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': kL = down; break;
    case 'ArrowRight': case 'KeyD': kR = down; break;
    case 'ArrowUp': case 'KeyW': kU = down; break;
    case 'ArrowDown': case 'KeyS': case 'Space': kD = down; e.preventDefault(); break;
    case 'ShiftLeft': case 'ShiftRight': kB = down; break;
    case 'KeyC': if (down && !e.repeat) switchCar(); break;
    case 'KeyV': if (down && !e.repeat) switchTrack(); break;
    case 'KeyM': if (down && !e.repeat) { muted = !muted; flash(muted ? 'SOUND OFF' : 'SOUND ON'); } break;
    case 'KeyR': if (down && !e.repeat) { setRain(!rainOn); flash(rainOn ? 'RAIN' : 'CLEAR'); } break;
  }
}

function showUI(on) {
  const d = on ? 'block' : 'none';
  document.getElementById('dash').style.display = d;
  document.getElementById('hud-top').style.display = on ? 'flex' : 'none';
  document.getElementById('minimap').style.display = d;
  document.getElementById('mirror').style.display = d;
  document.getElementById('hood').style.display = d;
  document.getElementById('mode-btn').style.display = d;
  document.getElementById('pause-btn').style.display = d;
  document.getElementById('car-btn').style.display = d;
  document.getElementById('track-btn').style.display = d;
  const touch = document.getElementById('touch-controls');
  touch.style.display = on && matchMedia('(hover: none), (pointer: coarse)').matches ? 'flex' : 'none';
}

function togglePause() {
  if (!run || dead) return;
  paused = !paused;
  document.getElementById('pause').style.display = paused ? 'flex' : 'none';
  document.getElementById('pause-btn').textContent = paused ? 'RESUME' : 'PAUSE';
  if (paused) {
    kL = kR = kU = kD = kB = false;
    document.querySelectorAll('.touch-control').forEach(button => button.classList.remove('active'));
  }
}

function start() {
  try {
    initAudio();
  } catch (error) {
    // Audio is optional; browser autoplay and embedded WebViews may reject it.
    console.warn('CAR DRIVE 3D audio unavailable; continuing without engine audio.', error);
    actx = null;
  }
  document.getElementById('start').style.display = 'none';
  document.getElementById('crash').style.display = 'none';
  showUI(true);
  spd = 0; px = 0; pvx = 0; t = 0; dist = 0; score = 0; overs = 0; lap = 1;
  boost = 100; dead = false; run = true; shake = 0; slide = 0; combo = 0; prevT = 0; wheelAngle = 0;
  paused = false; lapTime = 0; timeLeft = 60; offT = 0;
  countdown = 3; cdShown = -1; topSpd = 0;
  { const q = getP(0); camera.position.set(q.x, q.y + 1.15, q.z); }
  kL = kR = kU = kD = kB = false;
  document.getElementById('pause').style.display = 'none';
  document.getElementById('pause-btn').textContent = 'PAUSE';
  spawnTraffic();
}

export function init() {
  const canvas = document.getElementById('c');
  const pixels = innerWidth * innerHeight;
  visualQuality = pixels > 2400000 && (globalThis.devicePixelRatio || 1) <= 2 ? 'high' : pixels > 1000000 ? 'medium' : 'low';
  renderer = createRenderer(canvas, { antialias: visualQuality !== 'low', shadows: true, maxPixelRatio: visualQuality === 'high' ? 2 : 1.35 });
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.1, 700);
  clock = new THREE.Clock();

  hemi = new THREE.HemisphereLight(0xb0d8f0, 0x3a5820, 0.8);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0x9ab8c8, 0.18));
  sun = new THREE.DirectionalLight(0xfff2d8, 1.05);
  sun.position.set(40, 70, 30);
  sun.castShadow = visualQuality !== 'low';
  sun.shadow.mapSize.set(visualQuality === 'high' ? 2048 : 1024, visualQuality === 'high' ? 2048 : 1024);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0002;
  scene.add(sun);

  // Realistic low-beam pair (halogen ~3200K)
  // SpotLight(color, intensity, distance, angle rad, penumbra, decay)
  // Approx. 28-degree cone, soft cutoff, distance falloff
  headlightL = new THREE.SpotLight(0xffd4a0, 32, 55, 0.42, 0.75, 1.6);
  headlightR = new THREE.SpotLight(0xffd4a0, 32, 55, 0.42, 0.75, 1.6);
  headlightL.castShadow = false;
  headlightR.castShadow = false;
  scene.add(headlightL);
  scene.add(headlightR);
  scene.add(headlightL.target);
  scene.add(headlightR.target);

  // Subtle volumetric cone (not arcade neon)
  function makeBeam() {
    const geo = new THREE.CylinderGeometry(0.12, 2.4, 16, 20, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe0b0,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  }
  beamL = makeBeam();
  beamR = makeBeam();

  buildTrackWorld(); initSmoke(); initSnow(); spawnTraffic();
  applyDayNight();
  applySeason();

  mctx = document.getElementById('mc').getContext('2d');
  const p = getP(0), tang = getT(0);
  const { up } = sideUp(tang);
  camera.position.copy(p).addScaledVector(up, 1.15).addScaledVector(tang, 0.4);
  camera.lookAt(p.clone().addScaledVector(tang, 20));

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  addEventListener('keydown', e => onKey(e, true));
  addEventListener('keyup', e => onKey(e, false));
  document.addEventListener('visibilitychange', () => { if (document.hidden && run && !dead && !paused) togglePause(); });

  let tx = null;
  canvas.addEventListener('touchstart', e => {
    tx = e.touches[0].clientX; kU = true;
    if (e.touches.length >= 2) kB = true;
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    if (tx == null) return;
    const d = e.touches[0].clientX - tx;
    kL = d < -24; kR = d > 24;
  }, { passive: true });
  canvas.addEventListener('touchend', e => {
    tx = null; kL = kR = kU = false;
    if (e.touches.length < 2) kB = false;
  });

  document.getElementById('start-car').onclick = switchCar;
  document.getElementById('start-track').onclick = switchTrack;
  document.getElementById('car-btn').onclick = switchCar;
  document.getElementById('track-btn').onclick = switchTrack;
  const startGame = (event) => {
    event?.preventDefault();
    start();
  };
  document.getElementById('start-btn').onclick = startGame;
  document.getElementById('restart-btn').onclick = startGame;
  document.getElementById('pause-btn').onclick = togglePause;
  document.getElementById('resume-btn').onclick = togglePause;
  document.getElementById('mode-btn').onclick = () => {
    timeMode = (timeMode + 1) % 7;
    applyDayNight();
  };
  document.getElementById('mode-btn').oncontextmenu = (e) => {
    e.preventDefault();
    season = (season + 1) % 4;
    applySeason();
  };
  document.querySelectorAll('.touch-control').forEach(button => {
    const control = button.dataset.control;
    const setControl = (down) => {
      if (paused || dead) return;
      button.classList.toggle('active', down);
      if (control === 'left') kL = down;
      if (control === 'right') kR = down;
      if (control === 'gas') kU = down;
      if (control === 'brake') kD = down;
      if (control === 'boost') kB = down;
    };
    button.addEventListener('pointerdown', e => {
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      setControl(true);
    });
    button.addEventListener('pointerup', () => setControl(false));
    button.addEventListener('pointercancel', () => setControl(false));
    button.addEventListener('lostpointercapture', () => setControl(false));
  });
  try {
    bestScore = parseInt(localStorage.getItem('cd3_best') || '0', 10) || 0;
    const bl = parseFloat(localStorage.getItem('cd3_bestlap') || '0');
    if (bl > 0) bestLap = bl;
  } catch (e) { bestScore = 0; }
  applyCar();
  frame();
}
