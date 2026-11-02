// =====================================================================
// STATUE MUSEUM: AFTER HOURS
// A full-body "red light, green light" game for one player and a webcam.
// Sneak through a museum at night by walking in place. When the guard
// turns around, freeze as the artwork on the pedestal next to you.
//
// p5.js draws everything; ml5.js bodyPose (MoveNet) tracks the body.
// Artworks (the pose catalog) live in artworks.js.
// =====================================================================

// ---------- Tuning ---------------------------------------------------
// If detection feels too strict or too loose in your room, change these.
const CONFIG = {
  passThreshold: 0.68,   // pose similarity (0..1) needed to fool the guard
  goldThreshold: 0.85,   // average similarity for a gold "forgery" rating
  silverThreshold: 0.75, // ...and for silver (anything that passes below is bronze)
  moveThreshold: 0.03,   // smoothed body motion above this counts as "moving"
  stepsPerGallery: 14,   // walking-in-place steps to cross one gallery
  stepLift: 0.13,        // how much higher one knee must be than the other (torso lengths)
  greenMin: 4, greenMax: 8, // seconds of green light before the guard turns
  warnTime: 1.0,         // the guard's turning warning
  graceTime: 1.8,        // time to strike the pose before inspection starts
  inspectTime: 3.0,      // how long the guard stares at you
  passHold: 1.5,         // holding a matching pose this long fools the guard early
  factTime: 6,           // seconds the fact card stays up before moving on
  panTime: 1.6,          // seconds to slide over to the next statue
  holdToSelect: 2.5,     // seconds to hold the torch pose to select
  jacksToAdvance: 3,     // jumping jacks to move to the next screen
  earHold: 1.0,          // seconds of hand-to-ear for the audio guide
  minConfidence: 0.3,    // ignore keypoints the model is less sure about
};

// ---------- Layout (the game is drawn at 1280x720 and scaled) --------
const VW = 1280, VH = 720;
const FLOOR_Y = 600;
const PEDESTAL = { x: 300, top: 470, w: 190 };
const PLAYER_X = 680;
const GUARD_X = 1080;
const CAM = { x: VW - 340, y: VH - 260, w: 320, h: 240 };

const COL = {
  wallTop: '#151026', wallBottom: '#251a3a', floor: '#120d1d',
  marble: '#ece6da', marbleShade: '#b9b2a6', shadow: '#232b4a', outline: '#6f7bb8',
  green: '#3ddc84', red: '#ff4d5e', amber: '#ffb347', gold: '#f5c542',
  silver: '#c9d1dc', bronze: '#c98a4b', text: '#f4efe6', dim: '#a59cbd',
};

// ---------- Pose tracking state --------------------------------------
let bodyPose, video;
let body = null;             // smoothed keypoints of the main player: name -> {x, y, c}
let rawPrev = null;          // previous raw keypoints, for motion
let motion = 0;              // smoothed motion, in torso lengths per pose frame
let torso = 100;             // torso length in video pixels (our unit of size)
let lastPoseAt = -99999;     // millis() of the last frame with a person in it
let everSawBody = false;

const SEGMENTS = [
  // name, from, to, weight
  ['lUpper', 'left_shoulder', 'left_elbow', 1],
  ['lFore', 'left_elbow', 'left_wrist', 1],
  ['rUpper', 'right_shoulder', 'right_elbow', 1],
  ['rFore', 'right_elbow', 'right_wrist', 1],
  ['lThigh', 'left_hip', 'left_knee', 0.6],
  ['lShin', 'left_knee', 'left_ankle', 0.6],
  ['rThigh', 'right_hip', 'right_knee', 0.6],
  ['rShin', 'right_knee', 'right_ankle', 0.6],
  ['torso', 'hipMid', 'shoulderMid', 0.5],
];
const MIRROR = {
  lUpper: 'rUpper', rUpper: 'lUpper', lFore: 'rFore', rFore: 'lFore',
  lThigh: 'rThigh', rThigh: 'lThigh', lShin: 'rShin', rShin: 'lShin', torso: 'torso',
};
const BONES = [
  ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
];

// ---------- Game state -------------------------------------------------
let screen = 'title';        // title | howto | play | fact | caught | end
let howtoPage = 0;
let game;                    // per-run state, see newGame()
let holds = {};              // hold-to-select timers
let jacks = { state: 'closed', count: 0, lastAt: 0 };
let walker = { lastSide: null };
let earArmed = true;
let flash = { text: '', col: COL.text, t: 0 };
let caughtReason = '';
let caughtTimer = 0;
let debug = false;
let keyboardMode = false;    // K: play with keys only (for testing without a camera)
let lastMatch = { score: 0, coverage: 0 };

function newGame() {
  game = {
    gallery: 0,
    score: 0,
    caughtCount: 0,
    results: [],             // per gallery: { rating, avg }
    scroll: 0,
  };
  startGallery();
}

function startGallery() {
  Object.assign(game, {
    phase: 'green',
    phaseTime: 0,
    greenLength: random(CONFIG.greenMin, CONFIG.greenMax),
    steps: 0,
    suspicion: 0,
    passTime: 0,             // how long the current pose has matched
    pan: 0,                  // 1 -> 0 while sliding over from the previous statue
    sims: [],
    galleryAvg: 0,
    guardTurn: 0,            // 0 = facing away, 1 = facing the player
  });
}

// =====================================================================
// p5 + ml5 setup
// =====================================================================
function preload() {
  bodyPose = ml5.bodyPose('MoveNet', { flipped: true });
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  // Ask the camera for 4:3 so the picture isn't squashed into 640x480,
  // which would skew every limb angle the pose matching relies on.
  video = createCapture({ video: { width: 640, height: 480 }, audio: false }, { flipped: true });
  video.size(640, 480);
  video.hide();
  bodyPose.detectStart(video, gotPoses);
  textFont('Georgia');
  newGame();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// ml5 calls this every time it has looked at a new video frame.
function gotPoses(results) {
  if (!results || results.length === 0) return;

  // In a busy classroom, track the biggest (closest) person.
  let best = null, bestArea = -1;
  for (const p of results) {
    const pts = p.keypoints.filter(k => k.confidence > CONFIG.minConfidence);
    if (pts.length < 5) continue;
    const xs = pts.map(k => k.x), ys = pts.map(k => k.y);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (area > bestArea) { bestArea = area; best = p; }
  }
  if (!best) return;

  const raw = {};
  for (const k of best.keypoints) raw[k.name] = { x: k.x, y: k.y, c: k.confidence };
  addMidpoints(raw);

  // Body size, so every threshold works whether you stand near or far.
  const ls = raw.left_shoulder, rs = raw.right_shoulder;
  if (raw.shoulderMid && raw.hipMid) {
    torso = lerp(torso, dist(raw.shoulderMid.x, raw.shoulderMid.y, raw.hipMid.x, raw.hipMid.y), 0.3);
  } else if (ok(ls) && ok(rs)) {
    torso = lerp(torso, dist(ls.x, ls.y, rs.x, rs.y) * 1.5, 0.3);
  }
  torso = Math.max(torso, 20);

  // Motion: average keypoint movement since the last frame, in torso lengths.
  if (rawPrev) {
    let sum = 0, n = 0;
    for (const name in raw) {
      const a = raw[name], b = rawPrev[name];
      if (a && b && a.c > 0.4 && b.c > 0.4) { sum += dist(a.x, a.y, b.x, b.y); n++; }
    }
    if (n > 3) motion = lerp(motion, sum / n / torso, 0.3);
  }
  rawPrev = raw;

  // Smoothed copy for pose matching and drawing (less jitter).
  if (!body) body = {};
  for (const name in raw) {
    const r = raw[name], s = body[name];
    // Midpoints are null when a shoulder or hip is out of view.
    if (!r) body[name] = null;
    else if (!ok(s)) body[name] = { ...r };
    else body[name] = { x: lerp(s.x, r.x, 0.5), y: lerp(s.y, r.y, 0.5), c: r.c };
  }
  lastPoseAt = millis();
  everSawBody = true;
}

function addMidpoints(pts) {
  const mid = (a, b) => (ok(pts[a]) && ok(pts[b]))
    ? { x: (pts[a].x + pts[b].x) / 2, y: (pts[a].y + pts[b].y) / 2, c: Math.min(pts[a].c, pts[b].c) }
    : null;
  pts.shoulderMid = mid('left_shoulder', 'right_shoulder');
  pts.hipMid = mid('left_hip', 'right_hip');
}

// =====================================================================
// Pose helpers (also used by artworks.js)
// =====================================================================
function ok(p) { return p && p.c > CONFIG.minConfidence; }
function kp(name) { return body && ok(body[name]) ? body[name] : null; }
function tracking() { return keyboardMode || (body && millis() - lastPoseAt < 700); }

function distT(a, b) {
  const p = kp(a), q = kp(b);
  return p && q ? dist(p.x, p.y, q.x, q.y) / torso : null;
}

// 1 when the wrist is within maxT torso lengths of the target, fading to 0 at twice that.
function wristNear(wrist, target, maxT) {
  const d = distT(wrist, target);
  if (d === null) return 0;
  return constrain(1 - (d - maxT) / maxT, 0, 1);
}

// 1 when either wrist is at least marginT torso lengths above the reference point.
function anyWristAbove(ref, marginT) {
  const r = kp(ref);
  if (!r) return 0;
  let best = 0;
  for (const w of ['left_wrist', 'right_wrist']) {
    const p = kp(w);
    if (!p) continue;
    const above = (r.y - p.y) / torso;
    best = Math.max(best, constrain(above / marginT, 0, 1));
  }
  return best;
}

// 1 when the legs are straight (standing), 0 when deeply bent (crouching).
// Unknown (legs out of frame) counts as 0.5.
function legsStraight() {
  let vals = [];
  for (const side of ['left', 'right']) {
    const h = kp(side + '_hip'), k = kp(side + '_knee'), a = kp(side + '_ankle');
    if (!h || !k || !a) continue;
    const len = dist(h.x, h.y, k.x, k.y) + dist(k.x, k.y, a.x, a.y);
    vals.push(constrain(map(dist(h.x, h.y, a.x, a.y) / len, 0.8, 0.97, 0, 1), 0, 1));
  }
  return vals.length ? Math.min(...vals) : 0.5;
}

// 1 when a wrist is about level with a shoulder and close to it.
function handAtShoulder() {
  let best = 0;
  for (const w of ['left_wrist', 'right_wrist']) {
    const p = kp(w);
    if (!p) continue;
    for (const sh of ['left_shoulder', 'right_shoulder']) {
      const q = kp(sh);
      if (!q) continue;
      const dx = Math.abs(p.x - q.x) / torso, dy = Math.abs(p.y - q.y) / torso;
      best = Math.max(best, constrain(1 - Math.max(dx - 0.2, 0) / 0.3 - Math.max(dy - 0.15, 0) / 0.2, 0, 1));
    }
  }
  return best;
}

function handBehindBack(wrist) {
  if (!kp(wrist)) return 0.85; // hidden behind the body
  return wristNear(wrist, 'hipMid', 0.45);
}

function segAngle(from, to) {
  const a = kp(from), b = kp(to);
  if (!a || !b) return null;
  return degrees(Math.atan2(b.y - a.y, b.x - a.x));
}

function angDiff(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function targetAngle(art, seg) {
  return seg === 'torso' ? -90 + (art.lean || 0) : art.pose[seg];
}

// Compare the player's segment angles with an artwork. Returns 0..1.
function matchAngles(art, mirrored) {
  let sum = 0, weight = 0, total = 0, worstArm = 1;
  for (const [name, from, to, w] of SEGMENTS) {
    total += w;
    const ang = segAngle(from, to);
    if (ang === null) continue;
    const t = mirrored ? 180 - targetAngle(art, MIRROR[name]) : targetAngle(art, name);
    const d = angDiff(ang, t);
    // 10 degrees off ~ 0.92, 20 ~ 0.72, 30 ~ 0.48, 45 ~ 0.19
    const s = Math.exp(-Math.pow(d / 35, 2));
    const wt = name.endsWith('Thigh') || name.endsWith('Shin') ? (art.legWeight ?? w) : w;
    sum += s * wt;
    weight += wt;
    total += wt - w;
    if (name.includes('Upper') || name.includes('Fore')) worstArm = Math.min(worstArm, s);
  }
  // An average alone is too forgiving (straight legs match almost every
  // statue), so one arm that is way off pulls the whole score down.
  const mean = weight > 0 ? sum / weight : 0;
  return { score: mean * (0.6 + 0.4 * worstArm), coverage: weight / total };
}

function poseSimilarity(art) {
  if (keyboardMode && keyIsDown(80)) return { score: 1, coverage: 1 }; // hold P to fake a perfect pose
  if (!body) return { score: 0, coverage: 0 };
  const a = matchAngles(art, false), b = matchAngles(art, true);
  const best = a.score >= b.score ? a : b;
  let score = best.score;
  if (art.extra) score = score * 0.65 + art.extra() * 0.35;
  // Can't see enough of you? Don't hand out a perfect score.
  if (best.coverage < 0.45) score *= best.coverage / 0.45;
  return { score, coverage: best.coverage };
}

function currentMotion() {
  if (keyboardMode) return keyIsDown(32) ? 1 : 0;
  return motion;
}

// --- Gesture: torch pose (menu "select"): one arm straight up, the other down.
function torchPose() {
  const nose = kp('nose');
  const lw = kp('left_wrist'), rw = kp('right_wrist');
  const ls = kp('left_shoulder'), rs = kp('right_shoulder');
  if (!nose || !lw || !rw || !ls || !rs) return false;
  const up = w => w.y < nose.y - 0.35 * torso;
  const down = (w, s) => w.y > s.y;
  return (up(lw) && down(rw, rs)) || (up(rw) && down(lw, ls));
}

// --- Gesture: hand to ear (audio guide)
function handToEar() {
  const pairs = [['left_wrist', 'left_ear'], ['right_wrist', 'right_ear'], ['left_wrist', 'right_ear'], ['right_wrist', 'left_ear']];
  return pairs.some(([w, e]) => { const d = distT(w, e); return d !== null && d < 0.35; });
}

// --- Gesture: jumping jacks (state machine: closed -> open -> closed = 1 rep)
function updateJacks() {
  const nose = kp('nose'), lw = kp('left_wrist'), rw = kp('right_wrist');
  const ls = kp('left_shoulder'), rs = kp('right_shoulder');
  const la = kp('left_ankle'), ra = kp('right_ankle');
  if (!nose || !lw || !rw || !ls || !rs) return;
  const shoulderW = Math.abs(ls.x - rs.x);
  const armsUp = lw.y < nose.y && rw.y < nose.y;
  const armsDown = lw.y > ls.y && rw.y > rs.y;
  // Feet are often out of frame on a laptop; then arms alone count.
  const feet = la && ra;
  const legsOpen = !feet || Math.abs(la.x - ra.x) > shoulderW * 1.3;
  const legsClosed = !feet || Math.abs(la.x - ra.x) < shoulderW * 1.1;
  if (jacks.state === 'closed' && armsUp && legsOpen) {
    jacks.state = 'open';
  } else if (jacks.state === 'open' && armsDown && legsClosed) {
    jacks.state = 'closed';
    countJack();
  }
}

function countJack() {
  jacks.count++;
  jacks.lastAt = millis();
  sfx.chime(jacks.count);
}

function resetJacks() { jacks.count = 0; }

// --- Gesture: walking in place. A step is one knee rising above the
// other, alternating sides. If knees are out of frame, swinging arms count.
function updateWalk() {
  const lk = kp('left_knee'), rk = kp('right_knee');
  let diff = null, lift = CONFIG.stepLift;
  if (lk && rk) diff = (lk.y - rk.y) / torso;
  else {
    const lw = kp('left_wrist'), rw = kp('right_wrist');
    if (lw && rw) { diff = (lw.y - rw.y) / torso; lift = 0.3; }
  }
  if (diff === null) return;
  if (diff < -lift && walker.lastSide !== 'L') { walker.lastSide = 'L'; onStep(); }
  else if (diff > lift && walker.lastSide !== 'R') { walker.lastSide = 'R'; onStep(); }
}

// Hold-to-confirm: the ring fills while the gesture is held, drains when it breaks.
function hold(key, active, seconds, dt) {
  let v = holds[key] || 0;
  v = active ? v + dt / seconds : Math.max(0, v - dt / seconds * 1.5);
  if (v >= 1) { holds[key] = 0; return { fired: true, frac: 1 }; }
  holds[key] = v;
  return { fired: false, frac: v };
}

// =====================================================================
// Main loop
// =====================================================================
function draw() {
  const dt = Math.min(deltaTime / 1000, 0.1);
  background(0);

  const s = Math.min(width / VW, height / VH);
  push();
  translate((width - VW * s) / 2, (height - VH * s) / 2);
  scale(s);
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(0, 0, VW, VH);
  drawingContext.clip();

  if (body && !keyboardMode) updateJacks();
  update(dt);
  render(dt);
  drawCamera();
  if (debug) drawDebug();

  drawingContext.restore();
  pop();
}

function update(dt) {
  audio.update(dt);
  if (flash.t > 0) flash.t -= dt;

  // Audio guide: hold a hand to your ear.
  const ear = screen !== 'caught' && hold('ear', tracking() && !keyboardMode && earArmed && handToEar(), CONFIG.earHold, dt);
  if (ear && ear.fired) { earArmed = false; audioGuide(); }
  if (!handToEar()) earArmed = true;
  lastEar = ear ? ear.frac : 0;

  if (screen === 'title') updateTitle(dt);
  else if (screen === 'howto') updateHowto(dt);
  else if (screen === 'play') updatePlay(dt);
  else if (screen === 'fact') updateFact(dt);
  else if (screen === 'caught') updateCaught(dt);
  else if (screen === 'end') updateEnd(dt);
}
let lastEar = 0;
let lastTorch = 0;

function updateTitle(dt) {
  const t = hold('torch', tracking() && torchPose(), CONFIG.holdToSelect, dt);
  lastTorch = t.frac;
  if (t.fired) { sfx.ding(); go('play'); return; }
  if (jacks.count >= CONFIG.jacksToAdvance) { sfx.whoosh(); howtoPage = 0; go('howto'); }
}

function updateHowto(dt) {
  const t = hold('torch', tracking() && torchPose(), CONFIG.holdToSelect, dt);
  lastTorch = t.frac;
  if (t.fired) { sfx.ding(); go('play'); return; }
  if (jacks.count >= CONFIG.jacksToAdvance) {
    sfx.whoosh();
    resetJacks();
    howtoPage++;
    if (howtoPage >= HOWTO.length) go('title');
  }
}

function updatePlay(dt) {
  // Slide over to the new statue before the gallery starts.
  if (game.pan > 0) { game.pan = Math.max(0, game.pan - dt / CONFIG.panTime); return; }

  // Pause if we've lost sight of the player, so tracking glitches never cost a life.
  if (!tracking()) { audio.setMusic(0); return; }

  const art = ARTWORKS[game.gallery];
  lastMatch = poseSimilarity(art);

  if (game.phase === 'green') {
    game.phaseTime += dt;
    game.guardTurn = Math.max(0, game.guardTurn - dt * 2);
    game.suspicion = Math.max(0, game.suspicion - 8 * dt);
    audio.setMusic(1);
    if (!keyboardMode) updateWalk();
    if (game.phaseTime >= game.greenLength || game.steps >= CONFIG.stepsPerGallery) setPhase('warn');
  } else if (game.phase === 'warn') {
    game.phaseTime += dt;
    game.guardTurn = Math.min(1, game.phaseTime / CONFIG.warnTime);
    if (game.phaseTime >= CONFIG.warnTime) setPhase('grace');
  } else if (game.phase === 'grace') {
    game.phaseTime += dt;
    game.guardTurn = 1;
    if (game.phaseTime >= CONFIG.graceTime) setPhase('inspect');
  } else if (game.phase === 'inspect') {
    game.phaseTime += dt;
    const moving = currentMotion() > CONFIG.moveThreshold;
    if (moving) game.suspicion += 90 * dt;
    else if (lastMatch.score < CONFIG.passThreshold) game.suspicion += (CONFIG.passThreshold - lastMatch.score) * 170 * dt;
    game.sims.push(lastMatch.score);
    game.moving = moving;
    if (game.suspicion >= 100) {
      caughtReason = moving
        ? 'The guard saw you move!'
        : `That doesn't look much like ${art.title}...`;
      return getCaught();
    }
    // Fooled the guard: move straight on to the next statue.
    game.passTime = !moving && lastMatch.score >= CONFIG.passThreshold ? game.passTime + dt : 0;
    if (game.passTime >= CONFIG.passHold || game.phaseTime >= CONFIG.inspectTime) {
      game.galleryAvg = average(game.sims);
      sfx.relief();
      clearGallery();
    }
  }
}

function setPhase(p) {
  game.phase = p;
  game.phaseTime = 0;
  game.moving = false;
  if (p === 'warn') { sfx.turn(); audio.setMusic(0); }
  if (p === 'grace') { sfx.freeze(); game.sims = []; game.passTime = 0; }
}

function onStep() {
  if (screen !== 'play' || !game || game.phase !== 'green' || !tracking()) return;
  game.steps = Math.min(CONFIG.stepsPerGallery, game.steps + 1);
  game.scroll += 22;
  sfx.step();
}

function clearGallery() {
  const avg = game.galleryAvg;
  const rating = avg >= CONFIG.goldThreshold ? 'gold' : avg >= CONFIG.silverThreshold ? 'silver' : 'bronze';
  const points = { gold: 300, silver: 200, bronze: 100 }[rating];
  game.results[game.gallery] = { rating, avg };
  game.score += points;
  sfx.ding();
  game.factTimer = CONFIG.factTime;
  go('fact');
}

function getCaught() {
  game.caughtCount++;
  caughtTimer = 3.5;
  sfx.alarm();
  audio.setMusic(0);
  go('caught');
}

function updateCaught(dt) {
  caughtTimer -= dt;
  if (caughtTimer <= 0) { startGallery(); go('play'); }
}

function updateFact(dt) {
  game.factTimer -= dt;
  if (game.factTimer <= 0 || jacks.count >= CONFIG.jacksToAdvance) {
    sfx.whoosh();
    if (window.speechSynthesis) speechSynthesis.cancel();
    game.gallery++;
    if (game.gallery >= ARTWORKS.length) go('end');
    else {
      startGallery();
      game.pan = 1;
      game.scroll += VW; // the wall slides along with the statues
      go('play');
    }
  }
}

function updateEnd(dt) {
  const t = hold('torch', tracking() && torchPose(), CONFIG.holdToSelect, dt);
  lastTorch = t.frac;
  if (t.fired || jacks.count >= CONFIG.jacksToAdvance) { sfx.ding(); newGame(); go('title'); }
}

function go(next) {
  screen = next;
  holds = {};
  resetJacks();
  jacks.state = 'closed';
  if (next === 'title') newGame();
}

function showFlash(text, col) { flash = { text, col, t: 1.6 }; }

function average(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

function audioGuide() {
  let text;
  if (screen === 'fact' || screen === 'play' || screen === 'caught') {
    const art = ARTWORKS[Math.min(game.gallery, ARTWORKS.length - 1)];
    text = screen === 'fact'
      ? `${art.title}, by ${art.artist}, ${art.year}. ${art.facts.join(' ')}`
      : `Audio guide. This is ${art.title}, by ${art.artist}. To blend in: ${art.cue}`;
  } else {
    text = 'Welcome to the museum after hours. Walk in place to sneak forward. '
      + 'When the guard turns around, freeze in the pose of the statue beside you. '
      + 'Hold one arm straight up like a torch to begin.';
  }
  speak(text);
}

function speak(text) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

// =====================================================================
// Rendering
// =====================================================================
function render(dt) {
  if (screen === 'title') return drawTitle();
  if (screen === 'howto') return drawHowto();
  if (screen === 'end') return drawEnd();

  drawGallery();
  if (screen === 'play') drawPlayHud();
  if (screen === 'fact') drawFactCard();
  if (screen === 'caught') drawCaught();
}

// ----- Background ------------------------------------------------------
function drawRoom(scroll = 0) {
  const ctx = drawingContext;
  const g = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
  g.addColorStop(0, COL.wallTop);
  g.addColorStop(1, COL.wallBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, FLOOR_Y);

  // Picture frames on the wall scroll past as you sneak forward.
  const spacing = 300;
  const off = -(scroll % spacing);
  for (let i = -1; i < VW / spacing + 2; i++) {
    const x = off + i * spacing + 40;
    const idx = Math.floor(scroll / spacing) + i;
    noFill();
    stroke('#6b5531');
    strokeWeight(8);
    rect(x, 110, 150, 110);
    noStroke();
    const hue = (idx * 67) % 360;
    colorMode(HSB);
    fill(hue, 35, 28);
    rect(x + 4, 114, 142, 102);
    fill((hue + 140) % 360, 30, 40);
    ellipse(x + 50 + (idx % 3) * 20, 165, 50, 40);
    colorMode(RGB);
  }

  // Moonlight from a high window.
  noStroke();
  fill(180, 200, 255, 18);
  quad(VW * 0.45, 0, VW * 0.6, 0, VW * 0.75, FLOOR_Y, VW * 0.4, FLOOR_Y);

  // Floor.
  fill(COL.floor);
  rect(0, FLOOR_Y, VW, VH - FLOOR_Y);
  stroke(255, 255, 255, 12);
  strokeWeight(1);
  for (let i = 0; i < 14; i++) {
    const x = ((i * 120 - scroll * 1.4) % (VW + 240) + VW + 240) % (VW + 240) - 120;
    line(x, FLOOR_Y, x - 220, VH);
  }
  noStroke();
}

function drawGallery() {
  const art = ARTWORKS[Math.min(game.gallery, ARTWORKS.length - 1)];
  if (game.pan > 0 && game.gallery > 0) {
    // The previous statue slides off to the left as the new one slides in.
    const p = 1 - game.pan;
    const off = p * p * (3 - 2 * p) * VW;
    drawRoom(game.scroll - VW + off);
    drawPedestal(ARTWORKS[game.gallery - 1], -off);
    drawPedestal(art, VW - off);
  } else {
    drawRoom(game.scroll);
    drawPedestal(art);
  }
  drawPlayerFigure();
  drawGuard(game.guardTurn, screen === 'caught');
}

function drawPedestal(art, dx = 0) {
  const { top, w } = PEDESTAL;
  const x = PEDESTAL.x + dx;
  // Spotlight.
  noStroke();
  fill(255, 240, 200, 16);
  triangle(x, 0, x - 170, FLOOR_Y, x + 170, FLOOR_Y);
  // Plinth.
  fill('#3a3350');
  rect(x - w / 2, top, w, FLOOR_Y - top);
  fill('#4a4266');
  rect(x - w / 2 - 12, top - 14, w + 24, 16, 3);
  rect(x - w / 2 - 12, FLOOR_Y - 12, w + 24, 12, 3);
  // Brass plaque.
  fill('#b08d3c');
  rect(x - 78, top + 30, 156, 72, 4);
  fill('#2a2010');
  textAlign(CENTER, CENTER);
  textSize(art.title.length > 20 ? 12 : 15);
  textStyle(BOLD);
  text(art.title, x - 72, top + 36, 144, 34);
  textStyle(NORMAL);
  textSize(11);
  text(`${art.artist}, ${art.year}`, x - 72, top + 70, 144, 28);

  // The statue itself, drawn from the same numbers the game scores against.
  const pts = referencePoints(art);
  const feet = Math.max(pts.left_ankle.y, pts.right_ankle.y);
  const S = 92;
  const oy = top - 14 - feet * S;
  drawProps(art, pts, x, oy, S, 'back');
  drawFigure(pts, x, oy, S, { fill: COL.marble, shade: COL.marbleShade, line: '#8a8376' });
  drawProps(art, pts, x, oy, S, 'front');
}

// Build a stick figure (in torso units, hips at 0,0) from an artwork's angles.
function referencePoints(art) {
  const P = {};
  const lean = radians(art.lean || 0);
  const up = { x: Math.sin(lean), y: -Math.cos(lean) };
  const across = { x: Math.cos(lean), y: Math.sin(lean) };
  const neck = { x: up.x, y: up.y };
  P.shoulderMid = neck;
  P.hipMid = { x: 0, y: 0 };
  P.left_shoulder = { x: neck.x - across.x * 0.33, y: neck.y - across.y * 0.33 };
  P.right_shoulder = { x: neck.x + across.x * 0.33, y: neck.y + across.y * 0.33 };
  P.left_hip = { x: -0.17, y: 0 };
  P.right_hip = { x: 0.17, y: 0 };
  P.nose = { x: neck.x + up.x * 0.4, y: neck.y + up.y * 0.4 };
  const seg = (from, ang, len) => ({ x: from.x + Math.cos(radians(ang)) * len, y: from.y + Math.sin(radians(ang)) * len });
  const p = art.pose;
  P.left_elbow = seg(P.left_shoulder, p.lUpper, 0.5);
  P.left_wrist = seg(P.left_elbow, p.lFore, 0.45);
  P.right_elbow = seg(P.right_shoulder, p.rUpper, 0.5);
  P.right_wrist = seg(P.right_elbow, p.rFore, 0.45);
  P.left_knee = seg(P.left_hip, p.lThigh, 0.72);
  P.left_ankle = seg(P.left_knee, p.lShin, 0.68);
  P.right_knee = seg(P.right_hip, p.rThigh, 0.72);
  P.right_ankle = seg(P.right_knee, p.rShin, 0.68);
  for (const k in P) P[k].c = 1;
  return P;
}

// Draw a statue-like figure. pts are in torso units; (ox, oy) is where the hips go.
function drawFigure(pts, ox, oy, S, style) {
  const at = name => pts[name] && pts[name].c > CONFIG.minConfidence ? { x: ox + pts[name].x * S, y: oy + pts[name].y * S } : null;
  const ls = at('left_shoulder'), rs = at('right_shoulder'), lh = at('left_hip'), rh = at('right_hip');

  strokeCap(ROUND);
  strokeJoin(ROUND);
  // Torso first, then limbs on top of it (so an arm in front of the chest
  // stays visible), then the head. Each gets a dark outline, then its fill.
  if (ls && rs && lh && rh) {
    for (const pass of [0, 1]) {
      stroke(pass ? style.fill : style.line);
      strokeWeight(pass ? S * 0.16 : S * 0.16 + 5);
      fill(pass ? style.fill : style.line);
      quad(ls.x, ls.y, rs.x, rs.y, rh.x, rh.y, lh.x, lh.y);
    }
    if (style.shade) {
      noStroke();
      fill(style.shade);
      quad(lerp(ls.x, rs.x, 0.6), lerp(ls.y, rs.y, 0.6), rs.x, rs.y, rh.x, rh.y, lerp(lh.x, rh.x, 0.6), lerp(lh.y, rh.y, 0.6));
    }
  }
  for (const [a, b] of BONES) {
    const p = at(a), q = at(b);
    if (!p || !q) continue;
    const thick = a.includes('hip') || a.includes('knee') ? 0.2 : 0.16;
    stroke(style.line);
    strokeWeight(S * thick + 5);
    line(p.x, p.y, q.x, q.y);
    stroke(style.fill);
    strokeWeight(S * thick);
    line(p.x, p.y, q.x, q.y);
  }
  const nose = at('nose');
  if (nose) {
    stroke(style.line);
    strokeWeight(5);
    fill(style.fill);
    circle(nose.x, nose.y, S * 0.42);
  }
  noStroke();
}

const BACK_PROPS = ['swirl', 'rock'];

function drawProps(art, P, ox, oy, S, layer) {
  const at = n => ({ x: ox + P[n].x * S, y: oy + P[n].y * S });
  noStroke();
  for (const prop of art.props || []) {
    if (BACK_PROPS.includes(prop) !== (layer === 'back')) continue;
    if (prop === 'torch') {
      const w = at('left_wrist');
      fill(COL.marbleShade); rect(w.x - 6, w.y - 28, 12, 30, 3);
      fill(255, 170, 60, 220); ellipse(w.x, w.y - 40, 26, 36);
      fill(255, 230, 120); ellipse(w.x, w.y - 36, 12, 18);
    } else if (prop === 'tablet') {
      const w = at('right_wrist');
      fill(COL.marbleShade); rect(w.x - 30, w.y - 34, 26, 44, 3);
    } else if (prop === 'sling') {
      const w = at('left_wrist'), e = at('left_elbow');
      stroke('#8a8376'); strokeWeight(3); noFill();
      bezier(w.x, w.y, w.x + 30, w.y + 40, e.x + 10, e.y + 60, at('left_hip').x - 10, at('left_hip').y + 20);
      noStroke();
    } else if (prop === 'swirl') {
      // The Scream's swirling sky behind the figure.
      noFill();
      for (let i = 0; i < 4; i++) {
        stroke(i % 2 ? 'rgba(255,120,40,0.45)' : 'rgba(60,110,200,0.4)');
        strokeWeight(5);
        const y = oy - S * 2.6 + i * 18;
        bezier(ox - 110, y, ox - 40, y - 30, ox + 40, y + 30, ox + 110, y);
      }
      noStroke();
    } else if (prop === 'tutu') {
      const lh = at('left_hip'), rh = at('right_hip');
      fill(250, 245, 235, 220);
      triangle(lh.x - 34, lh.y + 26, rh.x + 34, rh.y + 26, (lh.x + rh.x) / 2, lh.y - 14);
    } else if (prop === 'disc') {
      const w = at('left_wrist');
      fill(COL.marbleShade); ellipse(w.x - 6, w.y, 34, 30);
    } else if (prop === 'rock') {
      const lk = at('left_knee'), rk = at('right_knee');
      const h = at('hipMid');
      fill('#7d7568'); rect(Math.min(lk.x, rk.x) + 10, h.y - 4, Math.abs(rk.x - lk.x) - 20, 40, 10);
    }
  }
}

// The player as a figure in the scene: a shadowy sneaker that turns to
// marble as your pose matches the artwork.
function drawPlayerFigure() {
  if (!body) {
    if (keyboardMode) {
      const art = ARTWORKS[Math.min(game.gallery, ARTWORKS.length - 1)];
      const m = keyIsDown(80) ? 1 : 0;
      const pts = referencePoints(art);
      const feet = Math.max(pts.left_ankle.y, pts.right_ankle.y);
      drawFigure(pts, PLAYER_X, FLOOR_Y - feet * 100, 100, figureStyle(m));
    }
    return;
  }
  const hip = body.hipMid || body.shoulderMid;
  if (!hip) return;
  const pts = {};
  for (const name in body) {
    const p = body[name];
    if (!p) continue;
    pts[name] = { x: (p.x - hip.x) / torso, y: (p.y - hip.y) / torso, c: p.c };
  }
  if (!body.hipMid) for (const k in pts) pts[k].y -= 1; // only shoulders visible: put them a torso above the hips
  const S = 100;
  // Stand on the floor when we can see your feet; otherwise float the hips at a fixed height.
  const ankles = ['left_ankle', 'right_ankle'].filter(n => ok(pts[n]));
  const feet = ankles.length ? Math.max(...ankles.map(n => pts[n].y)) : 1.4;
  const oy = FLOOR_Y - Math.max(feet, 0.8) * S;

  noStroke();
  fill(0, 0, 0, 90);
  ellipse(PLAYER_X, FLOOR_Y + 6, 170, 26);

  const red = screen === 'play' && (game.phase === 'grace' || game.phase === 'inspect');
  const m = red ? constrain(map(lastMatch.score, 0.3, CONFIG.passThreshold + 0.1, 0, 1), 0, 1) : 0;
  drawFigure(pts, PLAYER_X, oy, S, figureStyle(m));
}

function figureStyle(m) {
  return {
    fill: lerpColor(color(COL.shadow), color(COL.marble), m),
    shade: m > 0.5 ? COL.marbleShade : null,
    line: lerpColor(color(COL.outline), color('#8a8376'), m),
  };
}

function drawGuard(turn, alarm) {
  const x = GUARD_X, fy = FLOOR_Y;
  const bob = turn === 0 ? Math.sin(millis() / 300) * 3 : 0;

  // Flashlight beam sweeps over the ceiling from "away" (right) to "you" (left).
  const ang = lerp(-10, -177, turn);
  const hx = x - 10, hy = fy - 150 + bob;
  const a1 = radians(ang - 14), a2 = radians(ang + 14), L = 900;
  noStroke();
  const beam = alarm ? color(255, 60, 70, 70) : color(255, 240, 160, turn > 0.95 ? 70 : 40);
  fill(beam);
  triangle(hx, hy, hx + Math.cos(a1) * L, hy + Math.sin(a1) * L, hx + Math.cos(a2) * L, hy + Math.sin(a2) * L);

  // Legs and body.
  fill('#1b2236');
  rect(x - 26, fy - 110 + bob, 20, 110, 4);
  rect(x + 6, fy - 110 + bob, 20, 110, 4);
  fill('#2c3a63');
  rect(x - 38, fy - 230 + bob, 76, 130, 12);
  fill('#c9a24a');
  circle(x + (turn > 0.5 ? -18 : 18), fy - 205 + bob, 10); // badge (only visible from the front... roughly)
  // Head.
  fill('#d9b38c');
  circle(x, fy - 262 + bob, 52);
  if (turn > 0.5) {
    // Facing you: eyes.
    fill(30);
    circle(x - 10, fy - 264, 7);
    circle(x + 10, fy - 264, 7);
    stroke(30); strokeWeight(3);
    line(x - 9, fy - 248, x + 9, fy - 248);
    noStroke();
  } else {
    fill('#3b2a1e'); // back of the head: hair
    arc(x, fy - 262 + bob, 52, 52, PI * 0.9, PI * 2.1, CHORD);
  }
  // Cap.
  fill('#1b2236');
  rect(x - 30, fy - 296 + bob, 60, 16, 4);
  rect(x + (turn > 0.5 ? -42 : 0), fy - 284 + bob, 42, 6, 3);
  // Flashlight arm.
  stroke('#2c3a63'); strokeWeight(16);
  line(x - 20, fy - 200 + bob, hx, hy);
  noStroke();
  fill('#555'); circle(hx, hy, 18);

  if (game.phase === 'warn' && screen === 'play') {
    fill(COL.amber);
    textAlign(CENTER, CENTER);
    textSize(64);
    textStyle(BOLD);
    text('!', x, fy - 350);
    textStyle(NORMAL);
  }
}

// ----- HUD -------------------------------------------------------------
function drawPlayHud() {
  const art = ARTWORKS[game.gallery];

  // Museum map: one dot per gallery.
  textAlign(LEFT, TOP);
  fill(COL.text);
  textSize(18);
  text(`Gallery ${game.gallery + 1} of ${ARTWORKS.length}`, 24, 20);
  for (let i = 0; i < ARTWORKS.length; i++) {
    const r = game.results[i];
    fill(r ? COL[r.rating] : i === game.gallery ? COL.text : '#4a4266');
    circle(34 + i * 26, 58, i === game.gallery ? 16 : 12);
  }

  // Score and suspicion.
  textAlign(RIGHT, TOP);
  fill(COL.text);
  textSize(18);
  text(`Score ${game.score}`, VW - 24, 20);
  meter(VW - 284, 50, 260, 16, game.suspicion / 100, game.suspicion > 66 ? COL.red : COL.amber, 'Suspicion');

  // Big light indicator.
  let label, col, sub;
  if (game.pan > 0) { label = 'NEXT GALLERY'; col = COL.green; sub = `On to ${art.title}...`; }
  else if (game.phase === 'green') { label = 'GREEN LIGHT'; col = COL.green; sub = 'Walk in place to sneak forward'; }
  else if (game.phase === 'warn') { label = 'THE GUARD IS TURNING!'; col = COL.amber; sub = 'Get ready to freeze'; }
  else if (game.phase === 'grace') { label = `FREEZE AS ${art.title.toUpperCase()}!`; col = COL.red; sub = `${Math.ceil(CONFIG.graceTime - game.phaseTime)}... strike the pose on the pedestal`; }
  else { label = game.moving ? 'DON\'T MOVE!' : 'HOLD STILL...'; col = COL.red; sub = `The guard is looking... ${Math.ceil(CONFIG.inspectTime - game.phaseTime)}`; }
  pill(VW / 2, 40, label, col);
  textAlign(CENTER, TOP);
  textSize(16);
  fill(COL.dim);
  text(sub, VW / 2, 72);

  // Steps / distance.
  meter(24, VH - 52, 360, 18, game.steps / CONFIG.stepsPerGallery, COL.green,
    `Sneak closer: ${game.steps}/${CONFIG.stepsPerGallery} steps`);

  // Pose match readout during red light.
  if (game.phase === 'grace' || game.phase === 'inspect') {
    const pass = lastMatch.score >= CONFIG.passThreshold;
    ring(PLAYER_X + 150, 200, 46, lastMatch.score, pass ? COL.green : COL.amber);
    fill(COL.text);
    textAlign(CENTER, CENTER);
    textSize(20);
    text(`${Math.round(lastMatch.score * 100)}%`, PLAYER_X + 150, 200);
    textSize(13);
    fill(COL.dim);
    text('pose match', PLAYER_X + 150, 260);
    if (lastMatch.coverage < 0.6) {
      fill(COL.amber);
      text('Step back so I can see more of you', PLAYER_X, 130);
    }
    if (game.phase === 'grace') {
      fill(0, 0, 0, 170);
      rect(VW / 2 - 260, 98, 520, 56, 8);
      fill(COL.text);
      textSize(15);
      textAlign(CENTER, CENTER);
      text(art.cue, VW / 2 - 250, 100, 500, 52);
    }
  } else {
    fill(COL.dim);
    textAlign(CENTER, TOP);
    textSize(13);
    text('Hand to your ear: audio guide', PEDESTAL.x, FLOOR_Y + 30);
  }
  if (lastEar > 0) ring(PEDESTAL.x + 120, FLOOR_Y + 40, 16, lastEar, COL.gold);

  if (flash.t > 0) {
    fill(flash.col);
    textAlign(CENTER, CENTER);
    textSize(30);
    text(flash.text, VW / 2, 150);
  }

  if (!tracking()) overlayMessage(everSawBody ? 'Step back into view' : 'Waiting for the camera to find you...', 'The game is paused until you are in the picture.');
}

function drawFactCard() {
  const art = ARTWORKS[game.gallery];
  const r = game.results[game.gallery];
  fill(0, 0, 0, 150);
  rect(0, 0, VW, VH);
  const x = 110, y = 80, w = 790, h = 520;
  fill('#f6f0e3');
  rect(x, y, w, h, 14);
  fill('#2a2236');
  textAlign(LEFT, TOP);
  textSize(14);
  text('GALLERY CLEARED', x + 40, y + 34);
  textSize(34);
  textStyle(BOLD);
  text(art.title, x + 40, y + 56, w - 220);
  textStyle(NORMAL);
  textSize(17);
  fill('#5b5070');
  text(`${art.artist} · ${art.year} · ${art.place}`, x + 40, y + 140, w - 80);
  fill('#2a2236');
  textSize(18);
  let ty = y + 186;
  for (const f of art.facts) {
    text('•  ' + f, x + 40, ty, w - 80);
    ty += 52;
  }

  // Medal.
  fill(COL[r.rating]);
  circle(x + w - 90, y + 80, 92);
  fill('#2a2236');
  textAlign(CENTER, CENTER);
  textSize(14);
  textStyle(BOLD);
  text(r.rating.toUpperCase(), x + w - 90, y + 72);
  textStyle(NORMAL);
  textSize(12);
  text(`forgery ${Math.round(r.avg * 100)}%`, x + w - 90, y + 92);

  // Controls.
  textAlign(LEFT, CENTER);
  textSize(17);
  fill('#2a2236');
  const last = game.gallery === ARTWORKS.length - 1;
  text(`${last ? 'Escaping the museum' : 'Next statue'} in ${Math.max(0, Math.ceil(game.factTimer))}s  (or ${CONFIG.jacksToAdvance} jumping jacks):  ${jacks.count}/${CONFIG.jacksToAdvance}`, x + 40, y + h - 64);
  text('Hand to your ear to hear the audio guide', x + 40, y + h - 34);
  ring(x + w - 60, y + h - 34, 14, lastEar, COL.gold, '#d8cfbd');
  for (let i = 0; i < CONFIG.jacksToAdvance; i++) {
    fill(i < jacks.count ? COL.green : '#d8cfbd');
    circle(x + w - 160 + i * 30, y + h - 64, 18);
  }
}

function drawCaught() {
  const blink = Math.floor(millis() / 250) % 2 === 0;
  fill(255, 0, 30, blink ? 90 : 40);
  rect(0, 0, VW, VH);
  fill(COL.text);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(96);
  text('CAUGHT!', VW / 2, VH / 2 - 60);
  textStyle(NORMAL);
  textSize(28);
  text(caughtReason, VW / 2, VH / 2 + 20);
  textSize(18);
  fill(COL.dim);
  text(`Back to the start of the gallery in ${Math.ceil(caughtTimer)}...`, VW / 2, VH / 2 + 70);
}

// ----- Menus (Get Active style: hold a pose to select, jumping jacks to advance)
const HOWTO = [
  ['Green light', 'The guard is looking away. Walk (march) in place to sneak through the gallery. The faster you sneak, the sooner the guard turns.'],
  ['Red light', 'When the guard turns around, you have a moment to strike the pose of the artwork on the pedestal, then hold perfectly still. Fool the guard and you move on to the next statue.'],
  ['Suspicion', 'Moving fills the suspicion meter fast. A pose that is only a bit off fills it slowly. If it fills up, the alarm goes off and you restart the gallery.'],
  ['Learn as you go', 'Clear a gallery to earn a gold, silver or bronze forgery rating and read about the artwork. Put a hand to your ear any time to hear the audio guide.'],
];

function drawTitle() {
  drawRoom(millis() / 40);
  fill(0, 0, 0, 120);
  rect(0, 0, VW, VH);
  fill(COL.text);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(64);
  text('Statue Museum', VW / 2 - 160, 140);
  textStyle(NORMAL);
  textSize(26);
  fill(COL.gold);
  text('After Hours', VW / 2 - 160, 200);
  fill(COL.dim);
  textSize(18);
  text('Sneak past the night guard. When they turn around, become the art.', VW / 2 - 160, 246);

  optionCard(120, 300, 'Start the tour', 'Hold the TORCH pose:\none arm straight up', lastTorch, null);
  optionCard(500, 300, 'How to play', `Do ${CONFIG.jacksToAdvance} jumping jacks`, null, jacks.count);
  audioHint();
  if (!tracking()) {
    fill(COL.amber);
    textSize(16);
    textAlign(CENTER, CENTER);
    text(everSawBody ? 'Step back into view of the camera' : 'Waiting for the camera... allow webcam access and stand where you can be seen head to knees', VW / 2 - 160, 600);
  }
}

function drawHowto() {
  drawRoom(millis() / 40);
  fill(0, 0, 0, 140);
  rect(0, 0, VW, VH);
  const [title, body_] = HOWTO[howtoPage];
  fill(COL.dim);
  textAlign(LEFT, TOP);
  textSize(16);
  text(`HOW TO PLAY  ${howtoPage + 1}/${HOWTO.length}`, 100, 90);
  fill(COL.text);
  textStyle(BOLD);
  textSize(48);
  text(title, 100, 120);
  textStyle(NORMAL);
  textSize(24);
  text(body_, 100, 200, 760, 220);
  optionCard(100, 430, howtoPage === HOWTO.length - 1 ? 'Back to title' : 'Next', `Do ${CONFIG.jacksToAdvance} jumping jacks`, null, jacks.count);
  optionCard(480, 430, 'Start the tour', 'Hold the TORCH pose', lastTorch, null);
}

function drawEnd() {
  drawRoom(millis() / 40);
  fill(0, 0, 0, 140);
  rect(0, 0, VW, VH);
  fill(COL.text);
  textAlign(CENTER, TOP);
  textStyle(BOLD);
  textSize(54);
  text('You escaped the museum!', VW / 2 - 160, 70);
  textStyle(NORMAL);
  textSize(22);
  fill(COL.dim);
  text(`Score ${game.score}  ·  caught ${game.caughtCount} time${game.caughtCount === 1 ? '' : 's'}`, VW / 2 - 160, 140);
  textAlign(LEFT, CENTER);
  for (let i = 0; i < ARTWORKS.length; i++) {
    const r = game.results[i];
    const y = 210 + i * 46;
    fill(r ? COL[r.rating] : '#555');
    circle(200, y, 26);
    fill(COL.text);
    textSize(20);
    text(`${ARTWORKS[i].title}  —  ${r ? r.rating : '-'}`, 230, y);
  }
  optionCard(200, 500, 'Play again', `Hold the TORCH pose or do ${CONFIG.jacksToAdvance} jumping jacks`, lastTorch, jacks.count);
}

function optionCard(x, y, title, how, holdFrac, jackCount) {
  const w = 340, h = 150;
  fill(255, 255, 255, 20);
  stroke(255, 255, 255, 60);
  strokeWeight(2);
  rect(x, y, w, h, 14);
  noStroke();
  fill(COL.text);
  textAlign(LEFT, TOP);
  textStyle(BOLD);
  textSize(24);
  text(title, x + 22, y + 20);
  textStyle(NORMAL);
  textSize(16);
  fill(COL.dim);
  text(how, x + 22, y + 60, w - 120);
  if (holdFrac !== null) ring(x + w - 56, y + h / 2, 30, holdFrac, COL.gold);
  if (jackCount !== null && jackCount !== undefined) {
    for (let i = 0; i < CONFIG.jacksToAdvance; i++) {
      fill(i < jackCount ? COL.green : '#4a4266');
      circle(x + 30 + i * 28, y + h - 26, 18);
    }
  }
}

function audioHint() {
  if (audio.started) return;
  fill(COL.amber);
  textAlign(CENTER, CENTER);
  textSize(15);
  text('Click or press any key once to turn on sound', VW / 2 - 160, 680);
}

// ----- Small UI pieces -----------------------------------------------------
function pill(cx, cy, label, col) {
  textSize(26);
  textStyle(BOLD);
  const w = textWidth(label) + 48;
  fill(col);
  rect(cx - w / 2, cy - 22, w, 44, 22);
  fill('#120d1d');
  textAlign(CENTER, CENTER);
  text(label, cx, cy + 1);
  textStyle(NORMAL);
}

function meter(x, y, w, h, frac, col, label) {
  fill(255, 255, 255, 30);
  rect(x, y, w, h, h / 2);
  fill(col);
  rect(x, y, w * constrain(frac, 0, 1), h, h / 2);
  fill(COL.text);
  textAlign(LEFT, BOTTOM);
  textSize(14);
  text(label, x, y - 4);
}

function ring(x, y, r, frac, col, track = 'rgba(255,255,255,0.15)') {
  noFill();
  strokeWeight(r * 0.28);
  stroke(track);
  circle(x, y, r * 2);
  if (frac > 0.001) {
    stroke(col);
    arc(x, y, r * 2, r * 2, -HALF_PI, -HALF_PI + TWO_PI * constrain(frac, 0, 1));
  }
  noStroke();
}

function overlayMessage(title, sub) {
  fill(0, 0, 0, 160);
  rect(0, 0, VW, VH);
  fill(COL.text);
  textAlign(CENTER, CENTER);
  textSize(40);
  text(title, VW / 2, VH / 2 - 20);
  textSize(18);
  fill(COL.dim);
  text(sub, VW / 2, VH / 2 + 30);
}

// Webcam preview with skeleton, so players know they're being tracked.
function drawCamera() {
  const { x, y, w, h } = CAM;
  fill(0);
  rect(x - 4, y - 4, w + 8, h + 8, 8);
  if (video && video.width) image(video, x, y, w, h);
  if (body && tracking()) {
    const sx = w / (video.width || 640), sy = h / (video.height || 480);
    stroke(COL.green);
    strokeWeight(3);
    for (const [a, b] of BONES) {
      const p = kp(a), q = kp(b);
      if (p && q) line(x + p.x * sx, y + p.y * sy, x + q.x * sx, y + q.y * sy);
    }
    const ls = kp('left_shoulder'), rs = kp('right_shoulder'), lh = kp('left_hip'), rh = kp('right_hip');
    if (ls && rs) line(x + ls.x * sx, y + ls.y * sy, x + rs.x * sx, y + rs.y * sy);
    if (lh && rh) line(x + lh.x * sx, y + lh.y * sy, x + rh.x * sx, y + rh.y * sy);
    noStroke();
    fill(COL.gold);
    for (const name of ['nose', 'left_wrist', 'right_wrist', 'left_ankle', 'right_ankle']) {
      const p = kp(name);
      if (p) circle(x + p.x * sx, y + p.y * sy, 8);
    }
  }
  fill(tracking() ? COL.green : COL.red);
  circle(x + 14, y + 14, 10);
  fill(COL.text);
  textAlign(LEFT, CENTER);
  textSize(12);
  text(keyboardMode ? 'keyboard mode' : tracking() ? 'tracking' : 'no one in view', x + 24, y + 14);
}

function drawDebug() {
  const art = ARTWORKS[Math.min(game.gallery, ARTWORKS.length - 1)];
  const m = poseSimilarity(art);
  fill(0, 0, 0, 180);
  rect(10, 90, 330, 200, 8);
  fill('#9f9');
  textAlign(LEFT, TOP);
  textSize(13);
  textFont('monospace');
  const lines = [
    `screen ${screen}  phase ${game.phase}`,
    `motion ${currentMotion().toFixed(3)}  (moving > ${CONFIG.moveThreshold})`,
    `match ${art.id} ${m.score.toFixed(2)}  coverage ${m.coverage.toFixed(2)}`,
    `torso ${torso.toFixed(0)}px`,
    `torch ${torchPose()}  ear ${handToEar()}`,
    `jacks ${jacks.state} ${jacks.count}  steps ${game.steps}`,
    `suspicion ${game.suspicion.toFixed(0)}`,
    `fps ${frameRate().toFixed(0)}`,
  ];
  lines.forEach((l, i) => text(l, 20, 100 + i * 22));
  textFont('Georgia');
}

// =====================================================================
// Keyboard (fallbacks for testing and accessibility)
// =====================================================================
function keyPressed() {
  audio.start();
  const k = key.toLowerCase();
  if (k === 'd') debug = !debug;
  else if (k === 'k') { keyboardMode = !keyboardMode; showFlash(keyboardMode ? 'Keyboard mode on' : 'Keyboard mode off', COL.amber); }
  else if (k === 'm') audio.toggleMute();
  else if (k === 'g') audioGuide();
  else if (keyCode === ENTER) countJack();
  else if (k === 't' && (screen === 'title' || screen === 'howto' || screen === 'end')) {
    sfx.ding();
    if (screen === 'end') newGame();
    go('play');
  }
  else if (key === ' ' && keyboardMode) {
    walker.lastSide = walker.lastSide === 'L' ? 'R' : 'L';
    onStep();
  }
  if (key === ' ' || keyCode === ENTER) return false; // don't scroll the page
}

function mousePressed() { audio.start(); }

// =====================================================================
// Sound: a tiny Web Audio synth, so there are no sound files to load.
// =====================================================================
const audio = {
  ctx: null, master: null, music: null, started: false, muted: false,
  musicLevel: 0, beat: 0, note: 0,
  start() {
    if (this.started) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.music = this.ctx.createGain();
    this.music.gain.value = 0;
    this.music.connect(this.master);
    // A low, uneasy drone under the sneaking music.
    for (const f of [55, 55.7, 82.4]) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.value = 0.12;
      o.connect(g).connect(this.music);
      o.start();
    }
    this.started = true;
  },
  setMusic(level) { this.musicLevel = level; },
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
  },
  update(dt) {
    if (!this.started) return;
    const target = screen === 'play' ? this.musicLevel : 0.4;
    // Music cuts to silence quickly on red light, fades back in slowly.
    const speed = target < this.music.gain.value ? 0.15 : 0.6;
    this.music.gain.setTargetAtTime(target, this.ctx.currentTime, speed);
    // Tiptoeing pizzicato: a sneaky minor walking line.
    this.beat -= dt;
    if (this.beat <= 0 && target > 0.5) {
      this.beat = 0.36;
      const scale = [220, 261.6, 293.7, 311.1, 329.6, 392, 329.6, 293.7];
      this.tone(scale[this.note++ % scale.length], 0.12, { type: 'triangle', vol: 0.12, bus: this.music });
    }
  },
  tone(freq, dur, { type = 'sine', vol = 0.3, slideTo = null, delay = 0, bus = null } = {}) {
    if (!this.started) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus || this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  },
  noise(dur, vol, freq) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  },
};

const sfx = {
  step: () => audio.noise(0.09, 0.5, 500),
  chime: n => audio.tone(660 * Math.pow(1.26, Math.min(n, 4) - 1), 0.35, { vol: 0.25 }),
  ding: () => { audio.tone(1318, 0.5, { vol: 0.25 }); audio.tone(1760, 0.6, { vol: 0.2, delay: 0.1 }); },
  whoosh: () => audio.noise(0.4, 0.4, 1800),
  turn: () => audio.tone(180, CONFIG.warnTime, { type: 'sawtooth', vol: 0.12, slideTo: 520 }),
  freeze: () => { audio.tone(110, 0.5, { type: 'square', vol: 0.15 }); audio.tone(104, 0.5, { type: 'square', vol: 0.15 }); },
  relief: () => [392, 494, 587].forEach((f, i) => audio.tone(f, 0.3, { vol: 0.18, delay: i * 0.09 })),
  alarm: () => { for (let i = 0; i < 8; i++) audio.tone(i % 2 ? 660 : 880, 0.22, { type: 'sawtooth', vol: 0.18, delay: i * 0.22 }); },
};
