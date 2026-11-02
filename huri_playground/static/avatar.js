// HuRI's avatar on the welcome and conversation screens: a man from the
// Microsoft Rocketbox library, or Mouse-Man, the character from
// HuRI_website_demo (see AVATARS).
//
// Two ways he moves, picked per session by what HuRI can run:
//   * gestures: HuRI's `mov` module (EMAGE) streams SMPL-X motion, retargeted
//     onto the Mixamo rig in step with the voice (see HuRI_website_demo's
//     Character.jsx, which this follows);
//   * idle: between and without gestures, alive like a person standing
//     still (breathing, glances, weight shifts, listening), see idleLife().
//
// The models are kept out of git; without one the page stays text only. A
// model with ARKit-style shapes (jawOpen, eyeBlinkLeft/Right) gets a talking
// mouth and blinks: the man has them, Mouse-Man (Mixamo "Ch14") has no jaw
// bone and no blend shapes, so his mouth cannot open.
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

// The avatars come from huri_playground/avatars.yaml (GET /api/config), in
// the order they are tried: the first whose model is there is shown, unless
// the page's ?avatar=<name> asks for another. See that file for what each
// setting does; these are the defaults of the ones it leaves out.
const AVATAR_DEFAULTS = {
  rig: "mixamo",
  a_pose: false,
  textures: null,
  height: 1.75,
  camera: { idle: "head", gestures: "waist" },
  motion: { idle: 1, gestures: 1, pelvis: 0.3, upright: 0, gaze: 0, arms: 0, torso_guard: false },
  mouth: { jawOpen: 0.8, mouthFunnel: 0.2 },
  lips: 1,
  visemes: 1,
};

// Voice loudness (RMS) -> talking cues (0..1).
const MOUTH_GAIN = 7;
const MOUTH_FLOOR = 0.01; // below this it is silence or breath
const MOUTH_SMOOTH_S = 0.05;
// The idle head follows the voice's loudness this slowly: following each
// syllable shakes it.
const TALK_SMOOTH_S = 0.35;

// Bones ease toward their target pose: hides seams between gesture chunks
// (EMAGE windows are separate inferences) and the switch to and from idle.
const GESTURE_SMOOTH_S = 0.06;
const IDLE_SMOOTH_S = 0.3;
// Gestures are sampled this far ahead so, once eased, they land on time.
const GESTURE_LEAD_S = GESTURE_SMOOTH_S;
// Past the last gesture frame by this much, he goes back to idling; longer
// while HuRI is still speaking: the next gestures are on their way, and
// dropping to idle in between, then back, reads as twitching.
const GESTURE_HOLD_S = 0.3;
const SPEAKING_HOLD_S = 2.0;
// Out of idle, bones ease in this slowly for ENTER_S: a gesture starting
// mid-swing glides there instead of snapping.
const ENTER_SMOOTH_S = 0.2;
const ENTER_S = 0.5;
// Gesture frames that arrive after their moment in the voice are played this
// late rather than skipped (a jump to mid-gesture), up to MAX_LAG_S.
const LATE_MARGIN_S = 0.05;
const MAX_LAG_S = 3.0;
// Once gestures come in time again, the delay melts away by playing them up
// to this much faster.
const CATCH_UP = 0.25;

// EMAGE moves the whole body: it shifts its weight, turns its hips, and walks
// about the way its speakers did. The hips keep avatars.yaml's motion.pelvis
// of its turn, and of its weight shifts (the root's movement against its
// average over HIPS_SHIFT_S) at most HIPS_MAX_M, not its walk. The legs are
// not EMAGE's: they are solved so the feet stay where they stand (legIK).
const LEGS = new Set([
  "left_hip", "right_hip", "left_knee", "right_knee",
  "left_ankle", "right_ankle", "left_foot", "right_foot",
]);
const HIPS_SHIFT_S = 2;
const HIPS_MAX_M = 0.05;
const HIPS_SMOOTH_S = 0.15;
// The legs reach this share of their length: knees a little soft, never
// locked straight.
const LEG_REACH = 0.995;
// Human gestures in front of the belly go through Mouse-Man's, much rounder:
// an arm whose hand or forearm would enter the torso swings out of it.
const TORSO_SLICES = 12;
const MAX_PUSH_RAD = 1.2;
const PUSH_IN_RAD_S = 6; // how fast the swing out builds up
const PUSH_OUT_RAD_S = 1.5; // and lets go
const AXIS_SMOOTH_S = 0.15; // how fast the swing's direction may turn
// EMAGE has quick flicks (a forearm turning 40 degrees in a frame); a bone
// turns at most this fast, so they stay quick but continuous. A beat of the
// hand is about as fast: slower, it loses its accent.
const MAX_BONE_RAD_S = 10;
// EMAGE nods the head on nearly every syllable, small and quick: on a cartoon
// head that reads as shaking. Neck and head ease in slower.
const SLOW_JOINTS = new Set(["neck", "head"]);
const HEAD_SMOOTH_S = 0.12;

// EMAGE's speakers lean forward and look down: its pelvis tilts back and the
// spine more than makes up for it, and with the pelvis kept still (above) the
// chest leans and the head drops some 30 degrees. While he gestures, the
// sustained part of the chest's lean and of the head's turn away from the
// visitor (averaged over this long) is taken out, by avatars.yaml's
// motion.upright and motion.gaze; quick moves (nods, turns, beats) stay. Its
// arms stay some 40 degrees out from the body for whole sentences: so much of
// their sustained pose goes back to hanging (motion.arms).
const POSTURE_SMOOTH_S = 1.0;

// The eyes (a model with eye bones): they hold the visitor's eyes, the head
// moving around them, with small saccades every EYE_SACCADE_S; when the head
// turns further from the visitor than EYE_CONTACT_RAD (a glance aside,
// thinking), they go with it. Saccades take EYE_MOVE_S, turns at most
// EYE_MAX_RAD from where the head points.
const EYE_SACCADE_S = [0.4, 2.0];
const EYE_SACCADE_RAD = 0.035;
const EYE_CONTACT_RAD = 0.2;
const EYE_MOVE_S = 0.04;
const EYE_MAX_RAD = 0.4;

// SMPL-X joint order: poses[:, i*3 : i*3+3] is joint i, axis-angle.
const SMPLX_JOINTS = [
  "pelvis", "left_hip", "right_hip", "spine1", "left_knee", "right_knee",
  "spine2", "left_ankle", "right_ankle", "spine3", "left_foot", "right_foot",
  "neck", "left_collar", "right_collar", "head", "left_shoulder",
  "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
  "jaw", "left_eye", "right_eye",
  "left_index1", "left_index2", "left_index3",
  "left_middle1", "left_middle2", "left_middle3",
  "left_pinky1", "left_pinky2", "left_pinky3",
  "left_ring1", "left_ring2", "left_ring3",
  "left_thumb1", "left_thumb2", "left_thumb3",
  "right_index1", "right_index2", "right_index3",
  "right_middle1", "right_middle2", "right_middle3",
  "right_pinky1", "right_pinky2", "right_pinky3",
  "right_ring1", "right_ring2", "right_ring3",
  "right_thumb1", "right_thumb2", "right_thumb3",
];
const POSE_DIM = 165;
const EXPR_DIM = 100;

// Lip sync (huri-module-lips-sync's `lips.face`): ARKit's 52 blend shapes,
// in the wire's (alphabetical) order. The eyes keep their own life (blinks);
// the mouth, jaw, cheeks, nose and brows follow the frames.
const ARKIT = [
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft",
  "browOuterUpRight", "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
  "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight",
  "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight",
  "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
  "eyeWideLeft", "eyeWideRight", "jawForward", "jawLeft", "jawOpen", "jawRight",
  "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft",
  "mouthFrownRight", "mouthFunnel", "mouthLeft", "mouthLowerDownLeft",
  "mouthLowerDownRight", "mouthPressLeft", "mouthPressRight", "mouthPucker",
  "mouthRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower",
  "mouthShrugUpper", "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft",
  "mouthStretchRight", "mouthUpperUpLeft", "mouthUpperUpRight", "noseSneerLeft",
  "noseSneerRight", "tongueOut",
];
const LIPS = ARKIT.map((name, i) => [name, i]).filter(([name]) => !name.startsWith("eye"));
const VISEMES = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"];
// Weights ease toward the frame's this fast (a frame is 33 ms), and back to a
// neutral face when the frames stop.
const LIPS_SMOOTH_S = 0.03;
// Past its last frame by this much, a chunk no longer shows.
const LIPS_HOLD_S = 0.1;

// [SMPL-X joint, its parent, Mixamo bone], parents first.
const BODY = [
  ["pelvis", null, "Hips"],
  ["left_hip", "pelvis", "LeftUpLeg"],
  ["right_hip", "pelvis", "RightUpLeg"],
  ["spine1", "pelvis", "Spine"],
  ["left_knee", "left_hip", "LeftLeg"],
  ["right_knee", "right_hip", "RightLeg"],
  ["spine2", "spine1", "Spine1"],
  ["left_ankle", "left_knee", "LeftFoot"],
  ["right_ankle", "right_knee", "RightFoot"],
  ["spine3", "spine2", "Spine2"],
  ["left_foot", "left_ankle", "LeftToeBase"],
  ["right_foot", "right_ankle", "RightToeBase"],
  ["neck", "spine3", "Neck"],
  ["left_collar", "spine3", "LeftShoulder"],
  ["right_collar", "spine3", "RightShoulder"],
  ["head", "neck", "Head"],
  ["left_shoulder", "left_collar", "LeftArm"],
  ["right_shoulder", "right_collar", "RightArm"],
  ["left_elbow", "left_shoulder", "LeftForeArm"],
  ["right_elbow", "right_shoulder", "RightForeArm"],
  ["left_wrist", "left_elbow", "LeftHand"],
  ["right_wrist", "right_elbow", "RightHand"],
];
for (const side of ["left", "right"]) {
  const Side = side === "left" ? "Left" : "Right";
  for (const [finger, Finger] of [
    ["thumb", "Thumb"], ["index", "Index"], ["middle", "Middle"],
    ["ring", "Ring"], ["pinky", "Pinky"],
  ]) {
    for (let k = 1; k <= 3; k++) {
      const parent = k === 1 ? `${side}_wrist` : `${side}_${finger}${k - 1}`;
      BODY.push([`${side}_${finger}${k}`, parent, `${Side}Hand${Finger}${k}`]);
    }
  }
}
const JOINT_INDEX = Object.fromEntries(SMPLX_JOINTS.map((name, i) => [name, i]));

const container = document.getElementById("avatar");

// The avatar to show: ?avatar=<name> if its model is there, else the first
// whose model is; null without any.
async function pickAvatar() {
  let avatars = [];
  try {
    avatars = (await (await fetch("/api/config")).json()).avatars || [];
  } catch {
    return null;
  }
  const asked = new URLSearchParams(location.search).get("avatar");
  const order = [...avatars].sort((a, b) => (b.name === asked) - (a.name === asked));
  for (const entry of order) {
    const probe = await fetch(entry.model, { method: "HEAD" });
    if (probe.ok) {
      return {
        ...AVATAR_DEFAULTS,
        ...entry,
        camera: { ...AVATAR_DEFAULTS.camera, ...entry.camera },
        motion: { ...AVATAR_DEFAULTS.motion, ...entry.motion },
      };
    }
  }
  return null;
}

async function main() {
  const avatar = await pickAvatar();
  if (!avatar) return;

  container.hidden = false;
  container.dataset.state = "loading";
  document.body.classList.add("has-avatar");

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1, 2, 3);
  scene.add(key);

  const manager = new THREE.LoadingManager();
  if (avatar.textures) convertedTextures(manager, avatar.textures);
  const model = await new FBXLoader(manager).loadAsync(avatar.model);
  if (avatar.rig === "biped") bipedToMixamo(model);
  if (avatar.textures) fixCutouts(model);
  scene.add(model);

  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);
  const height = box.max.y - box.min.y;
  model.updateMatrixWorld(true);

  // Rest (T-pose) world orientations, before anything is moved: gesture
  // retargeting is relative to them.
  if (avatar.a_pose) toTPose(model);
  const rig = retargetRig(model, avatar.motion.pelvis);
  // Measured in the T-pose: huri-module-think fits its thinking poses to it.
  window.huriAvatarBody = { avatar: avatar.name, body: measureBody(model, avatar.height) };

  const out = armsOut(window.huriAvatarBody.body);
  lowerArm(model, "mixamorigLeftArm", "mixamorigLeftForeArm", 1, out);
  lowerArm(model, "mixamorigRightArm", "mixamorigRightForeArm", -1, out);
  // The arms' world orientation hanging at rest, for postureKeeper.
  const hang = Object.fromEntries(
    ["left_shoulder", "right_shoulder"].map((joint) => {
      const entry = rig.bones.find((b) => b.joint === joint);
      return [joint, entry && entry.bone.getWorldQuaternion(new THREE.Quaternion())];
    }),
  );
  // The idle pose: rest with the arms down.
  const idle = new Map(rig.bones.map(({ bone }) => [bone, bone.quaternion.clone()]));
  const torso = torsoGuard(model);
  torso.enabled = Boolean(avatar.motion.torso_guard);
  const posture = postureKeeper(rig, avatar.motion, hang);
  const legs = legIK(model, height / avatar.height, avatar.motion.pelvis);
  const eyes = eyeLife(model);
  if (new URLSearchParams(location.search).has("debug")) {
    window.huriAvatar = { model, torso, gestures: null };
  }

  const camera = new THREE.PerspectiveCamera(25, 1, height * 0.01, height * 20);
  const shots = cameraShots(model, height);
  const shotIdle = shots[avatar.camera.idle] || shots.head;
  const shotGestures = shots[avatar.camera.gestures] || shots.waist;
  let wide = 0; // 0 = the idle shot, 1 = the gestures one
  let wideTarget = 0;

  const face = faceControls(model);
  // Without a mouth to open, the head squashes a little on loud syllables.
  const head = face.has("jawOpen") ? null : model.getObjectByName("mixamorigHead");
  const life = idleLife(model, idle, avatar.motion.idle);

  const gestures = new GestureTrack(avatar.motion.gestures);
  const lips = new FaceTrack();
  // With `lips` in the pipeline the mouth follows its frames, else the
  // voice's loudness.
  let lipSync = false;
  if (window.huriAvatar) Object.assign(window.huriAvatar, { gestures, lips });
  window.addEventListener("huri-session", (e) => {
    gestures.clear();
    lips.clear();
    wideTarget = e.detail.outbound.includes("huri.motion") ? 1 : 0;
    lipSync = e.detail.outbound.includes("lips.face");
  });
  window.addEventListener("huri-motion", (e) => {
    const speaker = window.huriSpeaker;
    if (speaker) gestures.add(e.detail, speaker);
  });
  window.addEventListener("huri-face", (e) => {
    lipSync = true;
    lips.add(e.detail);
  });

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  const clock = new THREE.Clock();
  let mouth = 0;
  let talking = 0; // the voice's loudness, smoothed over a few syllables
  let nextBlink = 2;
  let gesturing = 0; // seconds since gestures took over from idle

  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    const t = clock.elapsedTime;
    if (container.offsetParent === null) return; // screen without Mouse-Man

    const speaker = window.huriSpeaker;
    const level = speaker ? speaker.level() : 0;
    const open = Math.min(1, Math.max(0, (level - MOUTH_FLOOR) * MOUTH_GAIN));
    mouth += (open - mouth) * (1 - Math.exp(-dt / MOUTH_SMOOTH_S));
    talking += (open - talking) * (1 - Math.exp(-dt / TALK_SMOOTH_S));
    if (lipSync) {
      // The frame heard now: the audio clock, less the output's latency.
      const heard = speaker && speaker.ctx
        ? speaker.ctx.currentTime - (speaker.ctx.outputLatency || 0) + LIPS_SMOOTH_S
        : null;
      const frame = heard === null ? null : lips.sample(heard, speaker);
      lips.playing = Boolean(frame); // for ?debug
      lips.apply(face, frame, dt, avatar.lips, avatar.visemes);
      // Frames late for the voice (a busy CPU): the mouth follows its
      // loudness meanwhile, rather than staying shut while he speaks.
      if (!frame) for (const [shape, weight] of Object.entries(avatar.mouth)) face.set(shape, mouth * weight);
    } else {
      for (const [shape, weight] of Object.entries(avatar.mouth)) face.set(shape, mouth * weight);
    }

    let blink = 0;
    if (t > nextBlink) {
      const phase = (t - nextBlink) / 0.15;
      blink = phase < 1 ? Math.sin(phase * Math.PI) : 0;
      if (phase >= 1) nextBlink = t + 2 + Math.random() * 3;
    }
    face.set("eyeBlinkLeft", blink);
    face.set("eyeBlinkRight", blink);

    const now = speaker && speaker.ctx ? speaker.ctx.currentTime : null;
    const pose =
      now === null ? null : gestures.sample(now + GESTURE_LEAD_S, speaker.speaking());
    if (pose) {
      if (gesturing === 0) torso.forget(); // idle's swing is not the gesture's
      const smooth = gesturing < ENTER_S ? ENTER_SMOOTH_S : GESTURE_SMOOTH_S;
      gesturing += dt;
      torso.release(); // the gesture eases on from its own pose, not the swung one
      posture.release();
      rig.apply(pose, 1 - Math.exp(-dt / smooth), MAX_BONE_RAD_S * dt, 1 - Math.exp(-dt / HEAD_SMOOTH_S));
      torso.keepArmsOut(dt);
      if (gestures.thinkingNow) posture.forget();
      else posture.keep(dt);
      legs.shift(gestures.thinkingNow ? null : gestures.outTrans, dt);
    } else {
      if (gesturing > 0) torso.forget(); // idling eases on from the pose on screen
      posture.forget(); // idling eases on from the corrected pose
      gesturing = 0;
      const listener = window.huriListener;
      life.update(dt, Math.min(1, talking * 1.5), listener ? listener.heardAt() : null);
      torso.release();
      life.apply(1 - Math.exp(-dt / IDLE_SMOOTH_S));
      torso.keepArmsOut(dt);
      legs.shift(null, dt);
    }
    legs.solve();
    if (head) head.scale.set(1 + mouth * 0.025, 1 - mouth * 0.035, 1 + mouth * 0.025);

    wide += (wideTarget - wide) * (1 - Math.exp(-dt / 0.5));
    const y = THREE.MathUtils.lerp(shotIdle.y, shotGestures.y, wide);
    // Far enough for the height, and for the width in a narrow box.
    const halfWidth = THREE.MathUtils.lerp(shotIdle.half, shotGestures.half, wide);
    const z = Math.max(
      THREE.MathUtils.lerp(shotIdle.distance, shotGestures.distance, wide),
      halfWidth / (Math.tan(THREE.MathUtils.degToRad(25 / 2)) * camera.aspect),
    );
    camera.position.set(0, y, z);
    camera.lookAt(0, y, 0);
    eyes.update(dt, camera.position);

    renderer.render(scene, camera);
  });
  container.dataset.state = "ready";
}

// Lip sync frames (`lips.face`): ARKit weights on the voice's timeline. A
// chunk is placed on the AudioContext clock from its pts once the voice it
// belongs to is scheduled, and played in step with it.
class FaceTrack {
  constructor() {
    this.weights = new Float32Array(ARKIT.length); // on screen, eased
    this.target = new Float32Array(ARKIT.length);
    this.visemeWeights = new Float32Array(VISEMES.length);
    this.visemeTarget = new Float32Array(VISEMES.length);
    this.visemesNow = false;
    this.clear();
  }

  clear() {
    this.chunks = []; // {pts, fps, n, floats, times: each frame's AudioContext time}
  }

  // payload: [f64 BE pts][u32 BE fps][u32 BE n][float32 LE n x 52]
  add(payload) {
    const view = new DataView(payload);
    const pts = view.getFloat64(0);
    const fps = view.getUint32(8) || 30;
    const n = view.getUint32(12);
    const floats = new Float32Array(payload.slice(16));
    if (floats.length < n * ARKIT.length) return;
    const visemes = floats.length >= n * (ARKIT.length + VISEMES.length);
    this.chunks.push({ pts, fps, n, floats, visemes, times: undefined, added: performance.now() });
  }

  // The weights at AudioContext time `time`, or null without a frame then.
  sample(time, speaker) {
    // Each frame is placed once, when its voice is scheduled (frames come
    // after it: `lips` computes them from it), on the voice's own timeline:
    // where the voice has a gap (a sentence that came late), so do they.
    const now = performance.now();
    this.chunks = this.chunks.filter((c) => {
      if (c.times === undefined && speaker.contextTime(c.pts) !== null) {
        c.times = Float64Array.from({ length: c.n }, (_, i) => speaker.contextTime(c.pts + i / c.fps));
      }
      if (c.times === undefined) return now - c.added < 5000; // its voice is not there yet
      return time < c.times[c.n - 1] + LIPS_HOLD_S + 1;
    });
    for (const c of this.chunks) {
      const { times, n, fps } = c;
      if (times === undefined || time < times[0] || time > times[n - 1] + LIPS_HOLD_S) continue;
      let i = 0; // the last frame at or before `time`
      let hi = n - 1;
      while (i < hi) {
        const mid = (i + hi + 1) >> 1;
        if (times[mid] <= time) i = mid;
        else hi = mid - 1;
      }
      const j = Math.min(n - 1, i + 1);
      const step = times[j] - times[i];
      // Across a gap in the voice, the frame before it holds a moment.
      if (step > 2 / fps && time > times[i] + LIPS_HOLD_S) continue;
      const a = step > 0 && step <= 2 / fps ? Math.min(1, (time - times[i]) / step) : 0;
      for (let k = 0; k < ARKIT.length; k++) {
        const x = c.floats[i * ARKIT.length + k];
        this.target[k] = x + (c.floats[j * ARKIT.length + k] - x) * a;
      }
      this.visemesNow = c.visemes;
      if (c.visemes) {
        const base = n * ARKIT.length;
        for (let k = 0; k < VISEMES.length; k++) {
          const x = c.floats[base + i * VISEMES.length + k];
          this.visemeTarget[k] = x + (c.floats[base + j * VISEMES.length + k] - x) * a;
        }
      }
      return this.target;
    }
    return null;
  }

  // Ease the face toward `frame` (null: neutral), its weights scaled by
  // `gains`: a number, or {default, <shape>: gain} (avatars.yaml's lips).
  apply(face, frame, dt, gains = 1, visemeGain = 1) {
    const k = 1 - Math.exp(-dt / LIPS_SMOOTH_S);
    const all = typeof gains === "number" ? gains : gains.default ?? 1;
    const visemes = Boolean(frame) && this.visemesNow && face.has("viseme_PP");
    for (const [name, i] of LIPS) {
      const gain = typeof gains === "number" ? all : gains[name] ?? all;
      const goal = frame && !visemes ? Math.min(1, frame[i] * gain) : 0;
      this.weights[i] += (goal - this.weights[i]) * k;
      face.set(name, this.weights[i]);
    }
    VISEMES.forEach((name, i) => {
      const goal = visemes ? Math.min(1, this.visemeTarget[i] * visemeGain) : 0;
      this.visemeWeights[i] += (goal - this.visemeWeights[i]) * k;
      face.set(`viseme_${name}`, this.visemeWeights[i]);
    });
  }
}

// Gesture frames received from HuRI, on the AudioContext clock, in two
// tracks that never mix (alternating between two poses every frame shakes).
//
// Speech gestures (`mov`, EMAGE on HuRI's voice) come with a face (expression
// coefficients) and are timed by the voice. Thinking motion
// (huri-module-think's `think`, between a question and its answer) has no
// face: it starts at pts 0 and runs on the clock from its arrival, its eased
// return to rest included. While it runs it has the body: `mov` also
// gestures on the thinking phrases ("hmm..."), and those gestures wait.
class GestureTrack {
  // gain: scales speech gestures away from standing at rest (avatars.yaml's
  // motion.gestures); thinking motion is played as it comes.
  constructor(gain = 1) {
    this.gain = gain;
    this.out = new Float32Array(SMPLX_JOINTS.length * 4);
    this.outTrans = new THREE.Vector3(); // the root's position, metres
    this.clear();
  }

  clear() {
    this.speech = []; // {time, quats: Float32Array(55 * 4)}, by time
    this.thinking = [];
    this.thinkBase = null; // AudioContext time of the thinking motion's pts 0
    this.lag = 0; // how late this utterance's gestures play behind the voice
    this.utterance = null; // when that utterance's voice started
  }

  // Gestures computed after their moment in the voice play late, from where
  // he is, rather than jumping into the middle of a move. The next chunks
  // continue from that delay, and play a little faster to make it up.
  // Returns the delay at the chunk's start and at its end, or null for a
  // chunk too late to show (he holds his pose meanwhile).
  lagFor(pts, seconds, speaker) {
    const start = speaker.contextTime(0);
    if (start !== this.utterance) {
      this.utterance = start;
      this.lag = 0;
    }
    const at = speaker.contextTime(pts);
    if (at === null) return [this.lag, this.lag];
    const needed = Math.max(0, speaker.ctx.currentTime + LATE_MARGIN_S - at);
    if (needed > MAX_LAG_S) return null;
    const first = Math.max(this.lag, needed);
    this.lag = Math.max(needed, first - CATCH_UP * seconds);
    return [first, this.lag];
  }

  // payload: [f64 BE pts][u32 BE fps][u32 BE n][poses n*165][expr n*100][trans n*3]
  add(payload, speaker) {
    const view = new DataView(payload);
    const pts = view.getFloat64(0);
    const fps = view.getUint32(8) || 30;
    const n = view.getUint32(12);
    const floats = new Float32Array(payload.slice(16));
    if (!speaker.ctx || floats.length < n * (POSE_DIM + EXPR_DIM + 3)) return;

    const face = floats.subarray(n * POSE_DIM, n * (POSE_DIM + EXPR_DIM));
    const thinking = face.every((x) => x === 0);
    if (thinking && (pts === 0 || this.thinkBase === null)) {
      this.thinkBase = speaker.ctx.currentTime + 0.05 - pts; // a new episode
    }
    const lags = thinking ? [0, 0] : this.lagFor(pts, n / fps, speaker);
    if (lags === null) return;
    const [lag0, lag1] = lags;
    const frames = thinking ? this.thinking : this.speech;

    const axis = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const at = thinking
        ? this.thinkBase + pts + i / fps
        : speaker.contextTime(pts + i / fps);
      if (at === null) continue; // no voice to sync to
      const time = at + lag0 + ((lag1 - lag0) * i) / Math.max(1, n - 1);
      const quats = new Float32Array(SMPLX_JOINTS.length * 4);
      for (let j = 0; j < SMPLX_JOINTS.length; j++) {
        const o = i * POSE_DIM + j * 3;
        axis.set(floats[o], floats[o + 1], floats[o + 2]);
        const angle = axis.length();
        if (angle > 1e-8) q.setFromAxisAngle(axis.divideScalar(angle), angle);
        else q.identity();
        const rest = GAIN_REST[j];
        if (!thinking && rest && this.gain !== 1) q.copy(rest.clone().slerp(q, this.gain));
        q.toArray(quats, j * 4);
      }
      const o = n * (POSE_DIM + EXPR_DIM) + i * 3;
      frames.push({ time, quats, trans: [floats[o], floats[o + 1], floats[o + 2]] });
    }
    frames.sort((a, b) => a.time - b.time);
  }

  // Interpolated joint quaternions at `time`, or null when not gesturing.
  // Sets `thinkingNow`: whether the pose is thinking motion.
  sample(time, speaking) {
    const thinking = this.sampleOf(this.thinking, time, GESTURE_HOLD_S);
    this.thinkingNow = Boolean(thinking);
    return thinking || this.sampleOf(this.speech, time, speaking ? SPEAKING_HOLD_S : GESTURE_HOLD_S);
  }

  sampleOf(frames, time, hold) {
    while (frames.length > 2 && frames[1].time < time - hold - 1) frames.shift();
    if (!frames.length) return null;
    const last = frames[frames.length - 1];
    if (time < frames[0].time || time > last.time + hold) return null;

    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid].time <= time) lo = mid;
      else hi = mid - 1;
    }
    const a = frames[lo];
    const b = frames[Math.min(lo + 1, frames.length - 1)];
    const alpha =
      b.time > a.time ? Math.min(1, Math.max(0, (time - a.time) / (b.time - a.time))) : 0;
    for (let k = 0; k < this.out.length; k += 4) {
      THREE.Quaternion.slerpFlat(this.out, k, a.quats, k, b.quats, k, alpha);
    }
    this.outTrans.fromArray(a.trans).lerp(new THREE.Vector3().fromArray(b.trans), alpha);
    return this.out;
  }
}

// The joints a gesture gain scales, and the pose it scales them from:
// standing at rest, the arms down (SMPL-X's T-pose is not a rest a person
// gestures from). The neck and head are left as they come (see
// POSTURE_SMOOTH_S), the legs are solved (legIK).
const GAIN_REST = SMPLX_JOINTS.map((name) => {
  if (/^(spine\d|(left|right)_(collar|elbow|wrist))$/.test(name)) return new THREE.Quaternion();
  if (name === "left_shoulder" || name === "right_shoulder") {
    const side = name === "left_shoulder" ? 1 : -1;
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -side * THREE.MathUtils.degToRad(80));
  }
  return null;
});

// SMPL-X rotations onto the Mixamo rig. SMPL-X's rest pose is identity, so a
// joint's chained (global) SMPL-X rotation is its world-space delta from rest;
// applied on top of the bone's rest world orientation it gives the bone's
// target world orientation, from which the local one follows.
function retargetRig(model, pelvisGain = 0.5) {
  const bones = [];
  const byJoint = {};
  for (const [joint, parent, mixamo] of BODY) {
    const bone = model.getObjectByName(`mixamorig${mixamo}`);
    if (!bone) continue;
    const entry = {
      joint,
      parent,
      bone,
      index: JOINT_INDEX[joint] * 4,
      rest: bone.getWorldQuaternion(new THREE.Quaternion()),
    };
    bones.push(entry);
    byJoint[joint] = entry;
  }
  const hips = byJoint.pelvis && byJoint.pelvis.bone;
  const rootParent = new THREE.Quaternion();
  if (hips && hips.parent) hips.parent.getWorldQuaternion(rootParent);
  const rootParentInv = rootParent.clone().invert();

  const smplxGlobal = {};
  const desired = {};
  for (const name of SMPLX_JOINTS) {
    smplxGlobal[name] = new THREE.Quaternion();
    desired[name] = new THREE.Quaternion();
  }
  const local = new THREE.Quaternion();
  const parentInv = new THREE.Quaternion();
  const target = new THREE.Quaternion();

  return {
    bones,
    apply(quats, ease, maxStep = Infinity, slowEase = ease) {
      // BODY is parents-first, and a joint without a bone in this rig leaves
      // its children unanimated rather than wrongly chained.
      for (const { joint, parent, bone, index, rest } of bones) {
        if (LEGS.has(joint)) continue; // legIK places them
        if (parent !== null && !byJoint[parent]) continue;
        local.fromArray(quats, index);
        if (parent === null) smplxGlobal[joint].copy(local.slerp(IDENTITY, 1 - pelvisGain));
        else smplxGlobal[joint].copy(smplxGlobal[parent]).multiply(local);
        desired[joint].copy(smplxGlobal[joint]).multiply(rest);

        if (parent === null) parentInv.copy(rootParentInv);
        else parentInv.copy(desired[parent]).invert();
        target.copy(parentInv).multiply(desired[joint]);
        const k = SLOW_JOINTS.has(joint) ? Math.min(ease, slowEase) : ease;
        const step = Math.min(bone.quaternion.angleTo(target) * k, maxStep);
        bone.quaternion.rotateTowards(target, step);
      }
    },
  };
}

const IDENTITY = new THREE.Quaternion();

// The eyes' life (see EYE_SACCADE_S); nothing without eye bones.
function eyeLife(model) {
  const head = model.getObjectByName("mixamorigHead");
  const found = [];
  model.traverse((b) => {
    if (b.isBone && /^(Bip01_[LR]Eye|mixamorig(Left|Right)Eye)$/.test(b.name)) found.push(b);
  });
  if (!head || !found.length) return { update() {} };
  model.updateMatrixWorld(true);
  // At load the model faces +z and so do its eyes and head.
  const eyes = found.map((b) => ({ bone: b, rest: b.getWorldQuaternion(new THREE.Quaternion()) }));
  const headRestInv = head.getWorldQuaternion(new THREE.Quaternion()).invert();
  const FORWARD = new THREE.Vector3(0, 0, 1);
  const gaze = new THREE.Vector3(0, 0, 1); // where the eyes look now (world)
  const target = new THREE.Vector3();
  const facing = new THREE.Vector3();
  const jitter = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const parentInv = new THREE.Quaternion();
  let next = 0;
  return {
    update(dt, cameraAt) {
      head.getWorldQuaternion(q).multiply(headRestInv);
      facing.copy(FORWARD).applyQuaternion(q);
      const center = eyes[0].bone.getWorldPosition(new THREE.Vector3());
      target.copy(cameraAt).sub(center).normalize();
      if ((next -= dt) <= 0) {
        jitter.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, 0).multiplyScalar(2 * EYE_SACCADE_RAD);
        next = EYE_SACCADE_S[0] + Math.random() * (EYE_SACCADE_S[1] - EYE_SACCADE_S[0]);
      }
      // The visitor's eyes, or where the head points when it looks away.
      if (facing.angleTo(target) > EYE_CONTACT_RAD) target.copy(facing);
      target.add(jitter).normalize();
      const angle = facing.angleTo(target);
      if (angle > EYE_MAX_RAD) target.lerp(facing, 1 - EYE_MAX_RAD / angle).normalize();
      gaze.lerp(target, 1 - Math.exp(-dt / EYE_MOVE_S)).normalize();
      q.setFromUnitVectors(FORWARD, gaze);
      for (const { bone, rest } of eyes) {
        bone.parent.getWorldQuaternion(parentInv).invert();
        bone.quaternion.copy(parentInv.multiply(q.clone().multiply(rest)));
      }
    },
  };
}

// The hips move with EMAGE's weight shifts (see HIPS_SHIFT_S), and the legs
// are solved, two bones each, so the feet stay where they stand at rest, flat
// on the ground, the knees bending forward. The hips come down when a leg
// would not reach. `unitsPerM`: model units per metre; `gain`: the share of
// the weight shifts kept.
function legIK(model, unitsPerM, gain = 0.5) {
  const bone = (name) => model.getObjectByName(`mixamorig${name}`);
  const hips = bone("Hips");
  model.updateMatrixWorld(true);
  const world = (b) => b.getWorldPosition(new THREE.Vector3());
  const sides = ["Left", "Right"]
    .map((Side) => ({ up: bone(`${Side}UpLeg`), knee: bone(`${Side}Leg`), foot: bone(`${Side}Foot`) }))
    .filter(({ up, knee, foot }) => up && knee && foot)
    .map((leg) => {
      const [h, k, a] = [world(leg.up), world(leg.knee), world(leg.foot)];
      return {
        ...leg,
        a: h.distanceTo(k),
        b: k.distanceTo(a),
        ankle: a, // where the foot stays
        dirUp: k.clone().sub(h).normalize(),
        dirKnee: a.clone().sub(k).normalize(),
        restUp: leg.up.getWorldQuaternion(new THREE.Quaternion()),
        restKnee: leg.knee.getWorldQuaternion(new THREE.Quaternion()),
        restFoot: leg.foot.getWorldQuaternion(new THREE.Quaternion()),
      };
    });
  if (!hips || sides.length < 2) return { shift() {}, solve() {} };
  const hipsRest = hips.position.clone();
  const hipsRestQInv = hips.getWorldQuaternion(new THREE.Quaternion()).invert();
  const average = new THREE.Vector3(); // EMAGE's root, averaged
  let tracking = false;
  const offset = new THREE.Vector3(); // the hips' shift, world units
  const goal = new THREE.Vector3();
  const v = new THREE.Vector3();
  const h = new THREE.Vector3();
  const knee = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const parentInv = new THREE.Quaternion();

  // Move the hips by `world` (a world-space vector), from where they are.
  function moveHips(worldDelta) {
    const parent = hips.parent;
    const from = parent.worldToLocal(world(hips));
    const to = parent.worldToLocal(world(hips).add(worldDelta));
    hips.position.add(to.sub(from));
    hips.updateMatrixWorld(true);
  }
  function setWorld(b, worldQ) {
    b.parent.getWorldQuaternion(parentInv).invert();
    b.quaternion.copy(parentInv.multiply(worldQ));
    b.updateMatrixWorld(true);
  }

  return {
    // EMAGE's root position (metres), or null when not gesturing.
    shift(trans, dt) {
      if (trans) {
        if (!tracking) average.copy(trans);
        tracking = true;
        average.lerp(trans, 1 - Math.exp(-dt / HIPS_SHIFT_S));
        goal.copy(trans).sub(average).multiplyScalar(gain).clampLength(0, HIPS_MAX_M).multiplyScalar(unitsPerM);
      } else {
        tracking = false;
        goal.set(0, 0, 0);
      }
      offset.lerp(goal, 1 - Math.exp(-dt / HIPS_SMOOTH_S));
    },
    solve() {
      hips.position.copy(hipsRest);
      model.updateMatrixWorld(true);
      moveHips(offset);
      // Down as far as the leg that reaches least needs.
      let drop = 0;
      for (const leg of sides) {
        h.copy(world(leg.up)).sub(leg.ankle);
        const reach = (leg.a + leg.b) * LEG_REACH;
        const flat = Math.hypot(h.x, h.z);
        const height = Math.sqrt(Math.max(0, reach * reach - flat * flat));
        drop = Math.max(drop, h.y - height);
      }
      if (drop > 0) moveHips(v.set(0, -drop, 0));
      // The knees bend the way the hips face.
      hips.getWorldQuaternion(q).multiply(hipsRestQInv);
      forward.set(0, 0, 1).applyQuaternion(q).setY(0).normalize();
      for (const leg of sides) {
        h.copy(world(leg.up));
        v.copy(leg.ankle).sub(h);
        const d = Math.min(v.length(), (leg.a + leg.b) * 0.9999);
        v.normalize();
        const cos = Math.min(1, (leg.a * leg.a + d * d - leg.b * leg.b) / (2 * leg.a * d));
        const side = forward.clone().addScaledVector(v, -forward.dot(v)).normalize();
        knee.copy(h).addScaledVector(v, leg.a * cos).addScaledVector(side, leg.a * Math.sqrt(1 - cos * cos));
        q.setFromUnitVectors(leg.dirUp, knee.clone().sub(h).normalize()).multiply(leg.restUp);
        setWorld(leg.up, q);
        q.setFromUnitVectors(leg.dirKnee, leg.ankle.clone().sub(world(leg.knee)).normalize()).multiply(leg.restKnee);
        setWorld(leg.knee, q);
        setWorld(leg.foot, leg.restFoot);
      }
    },
  };
}

// Takes a share of the sustained turn of the chest (motion.upright), of the
// head (motion.gaze) and of the upper arms (motion.arms) away from their rest
// orientation: upright, facing the visitor, hanging (`hang`) (see
// POSTURE_SMOOTH_S). The chest is turned back at the base of the spine, the
// others at themselves; all as world rotations.
function postureKeeper(rig, motion, hang) {
  const entry = (joint) => rig.bones.find((b) => b.joint === joint);
  const parts = [
    [entry("spine3"), entry("spine1"), motion.upright ?? 0, null],
    [entry("head"), entry("head"), motion.gaze ?? 0, null],
    ...["left_shoulder", "right_shoulder"].map((joint) => [entry(joint), entry(joint), motion.arms ?? 0, hang[joint]]),
  ]
    .filter(([measured, turned, gain]) => measured && turned && gain > 0)
    .map(([measured, turned, gain, rest]) => ({
      measured, turned, gain,
      restInv: (rest || measured.rest).clone().invert(),
      mean: null, // the sustained turn, a world rotation
      base: null, // the turned bone's rotation before the correction
    }));
  const turn = new THREE.Quaternion();
  const world = new THREE.Quaternion();
  const parent = new THREE.Quaternion();
  return {
    // Back to the uncorrected pose: gestures ease on from it, not from ours.
    release() {
      for (const part of parts) if (part.base) part.turned.bone.quaternion.copy(part.base);
    },
    forget() {
      for (const part of parts) {
        part.mean = null;
        part.base = null;
      }
    },
    keep(dt) {
      for (const part of parts) {
        const { measured, turned } = part;
        part.base = (part.base || new THREE.Quaternion()).copy(turned.bone.quaternion);
        measured.bone.updateWorldMatrix(true, false);
        measured.bone.getWorldQuaternion(turn).multiply(part.restInv);
        if (part.mean === null) part.mean = turn.clone();
        else part.mean.slerp(turn, 1 - Math.exp(-dt / POSTURE_SMOOTH_S));
        // Undo `gain` of it, in the world, on the bone that turns it back.
        turn.copy(IDENTITY).slerp(part.mean.clone().invert(), part.gain);
        turned.bone.getWorldQuaternion(world).premultiply(turn);
        turned.bone.parent.getWorldQuaternion(parent).invert();
        turned.bone.quaternion.copy(parent.multiply(world));
        turned.bone.updateWorldMatrix(false, true);
      }
    },
  };
}

// Mouse-Man's torso, in his Spine1 bone's frame, as horizontal elliptic
// slices stacked from his hips to his chest, fitted to the vertices the hips
// and spine carry: it narrows at the armpits, where the arms hang close.
// keepArmsOut() swings an upper arm about the shoulder so that the elbow,
// forearm and hand stay outside; the swing builds up fast and lets go slowly,
// so it never jerks.
function torsoGuard(model) {
  const bone = (name) => model.getObjectByName(`mixamorig${name}`);
  const spine = bone("Spine1");
  const carriers = new Set(["Hips", "Spine", "Spine1", "Spine2"].map((n) => `mixamorig${n}`));
  model.updateMatrixWorld(true);
  const toSpine = spine.matrixWorld.clone().invert();
  const v = new THREE.Vector3();
  const points = [];
  model.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const { skinIndex, skinWeight, position } = mesh.geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      let k = 0; // the bone carrying this vertex most
      for (let j = 1; j < 4; j++) if (skinWeight.getComponent(i, j) > skinWeight.getComponent(i, k)) k = j;
      const carrier = mesh.skeleton.bones[skinIndex.getComponent(i, k)];
      if (!carrier || !carriers.has(carrier.name)) continue;
      points.push(mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).applyMatrix4(toSpine).clone());
    }
  });
  const ys = points.map((p) => p.y);
  const yLo = Math.min(...ys);
  const step = (Math.max(...ys) - yLo) / TORSO_SLICES || 1;
  const slices = Array.from({ length: TORSO_SLICES }, () => ({ x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }));
  for (const p of points) {
    const c = slices[Math.min(TORSO_SLICES - 1, Math.floor((p.y - yLo) / step))];
    c.x0 = Math.min(c.x0, p.x);
    c.x1 = Math.max(c.x1, p.x);
    c.z0 = Math.min(c.z0, p.z);
    c.z1 = Math.max(c.z1, p.z);
  }
  // Centre and radii of each slice; an empty one borrows its neighbour's.
  const shape = slices.map((c) =>
    c.x0 === Infinity ? null : [(c.x0 + c.x1) / 2, (c.x1 - c.x0) / 2, (c.z0 + c.z1) / 2, (c.z1 - c.z0) / 2],
  );
  for (let i = 1; i < shape.length; i++) shape[i] = shape[i] || shape[i - 1];
  for (let i = shape.length - 2; i >= 0; i--) shape[i] = shape[i] || shape[i + 1];
  const stats = { frames: 0, pushed: 0, maxPush: 0 };

  // The torso's cross-section at height y, interpolated between slices.
  const cut = [0, 0, 0, 0];
  function section(y) {
    const f = Math.min(TORSO_SLICES - 1, Math.max(0, (y - yLo) / step - 0.5));
    const i = Math.floor(f);
    const j = Math.min(TORSO_SLICES - 1, i + 1);
    for (let k = 0; k < 4; k++) cut[k] = shape[i][k] + (shape[j][k] - shape[i][k]) * (f - i);
    return cut;
  }
  // < 1 inside the torso (spine frame); 1 on its skin.
  function level(p) {
    if (p.y < yLo || p.y > yLo + step * TORSO_SLICES) return Infinity;
    const [cx, rx, cz, rz] = section(p.y);
    return ((p.x - cx) / rx) ** 2 + ((p.z - cz) / rz) ** 2;
  }

  const arms = ["Left", "Right"].map((side) => ({
    arm: bone(`${side}Arm`),
    joints: [bone(`${side}ForeArm`), bone(`${side}Hand`)],
    push: 0, // the swing applied, radians
    axis: new THREE.Vector3(),
    base: null, // the arm's rotation before the swing
  }));
  const shoulder = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const world = new THREE.Quaternion();
  const parent = new THREE.Quaternion();
  const spineQ = new THREE.Quaternion();
  const toWorld = new THREE.Matrix4();
  let tested = [];

  function clear(axis, angle) {
    turn.setFromAxisAngle(axis, angle);
    return tested.every((p) => level(v.copy(p).sub(shoulder).applyQuaternion(turn).add(shoulder)) >= 1);
  }

  return {
    stats,
    arms,
    enabled: true,
    level,
    release() {
      for (const side of arms) if (side.base) side.arm.quaternion.copy(side.base);
    },
    forget() {
      for (const side of arms) {
        side.base = null;
        side.push = 0;
        side.axis.set(0, 0, 0);
      }
    },
    keepArmsOut(dt) {
      if (!this.enabled || !spine) return;
      model.updateMatrixWorld(true);
      toSpine.copy(spine.matrixWorld).invert();
      toWorld.copy(spine.matrixWorld);
      spine.getWorldQuaternion(spineQ);
      stats.frames += 1;
      for (const side of arms) {
        const { arm, joints } = side;
        if (!arm || joints.some((j) => !j)) continue;
        // Elbow, mid-forearm and wrist, in the spine's frame.
        arm.getWorldPosition(shoulder).applyMatrix4(toSpine);
        const [elbow, hand] = joints.map((j) => j.getWorldPosition(new THREE.Vector3()).applyMatrix4(toSpine));
        tested = [elbow, elbow.clone().lerp(hand, 0.5), hand];

        // Out, horizontally, from the torso's axis at the hand's height.
        const [cx, rx, cz, rz] = section(hand.y);
        normal.set((hand.x - cx) / rx ** 2, 0, (hand.z - cz) / rz ** 2);
        // Turned gradually: deep in the belly the outward direction can flip
        // from one frame to the next, and the arm with it.
        const axis = v.copy(hand).sub(shoulder).cross(normal);
        if (axis.lengthSq() > 1e-12) {
          axis.normalize();
          if (side.axis.lengthSq() === 0) side.axis.copy(axis);
          else side.axis.lerp(axis, 1 - Math.exp(-dt / AXIS_SMOOTH_S)).normalize();
        }

        let needed = 0;
        if (!clear(side.axis, 0)) {
          let lo = 0;
          let hi = MAX_PUSH_RAD;
          for (let i = 0; i < 10; i++) {
            const mid = (lo + hi) / 2;
            if (clear(side.axis, mid)) hi = mid;
            else lo = mid;
          }
          needed = hi;
        }
        side.needed = needed;
        side.push = needed > side.push
          ? Math.min(needed, side.push + PUSH_IN_RAD_S * dt)
          : Math.max(needed, side.push - PUSH_OUT_RAD_S * dt);
        if (side.push <= 0) {
          side.base = null;
          continue;
        }

        // The swing, from the spine's frame to the world.
        side.base = (side.base || new THREE.Quaternion()).copy(arm.quaternion);
        turn.setFromAxisAngle(normal.copy(side.axis).applyQuaternion(spineQ), side.push);
        arm.getWorldQuaternion(world).premultiply(turn);
        arm.parent.getWorldQuaternion(parent).invert();
        arm.quaternion.copy(parent.multiply(world));
        arm.updateMatrixWorld(true);
        stats.pushed += 1;
        stats.maxPush = Math.max(stats.maxPush, side.push);
      }
    },
  };
}

// Camera heights and distances, framing from the top of the head down to the
// shoulders (head), the chest, the waist, the knees or the feet (full).
// Framed from the bones: a cartoon head is far bigger than human proportions.
function cameraShots(model, height) {
  const y = (name, fallback) => {
    const bone = model.getObjectByName(name);
    return bone ? bone.getWorldPosition(new THREE.Vector3()).y : fallback;
  };
  const top = y("mixamorigHeadTop_End", height);
  const neck = y("mixamorigNeck", height * 0.8);
  const hips = y("mixamorigHips", height * 0.45);
  const knees = y("mixamorigLeftLeg", height * 0.25);
  const fit = (visible) => visible / 2 / Math.tan(THREE.MathUtils.degToRad(25 / 2));
  // How far out his hands go when he gestures: shoulder plus most of the arm.
  const at = (name) => {
    const bone = model.getObjectByName(name);
    return bone && bone.getWorldPosition(new THREE.Vector3());
  };
  const shoulder = at("mixamorigLeftArm");
  const wrist = at("mixamorigLeftHand");
  const reach = shoulder && wrist
    ? Math.abs(shoulder.x) + shoulder.distanceTo(wrist) * 0.85
    : height * 0.35;
  // Room above for leaning and below for the hands; the head shot is tighter.
  // `half`: the half width that must be in view, whatever the box's shape.
  const shot = (bottom, room) => {
    const visible = (top - bottom) * (1 + room);
    return {
      y: (top + bottom) / 2 + (top - bottom) * room * 0.05,
      distance: fit(visible),
      half: reach * (1 + room / 2),
    };
  };
  return {
    head: {
      y: (neck + top) / 2 - (top - neck) * 0.08,
      distance: fit((top - neck) * 1.75),
      half: shoulder ? Math.abs(shoulder.x) * 1.4 : height * 0.15,
    },
    chest: shot(neck - (neck - hips) * 0.45, 0.3),
    waist: shot(hips, 0.45),
    knees: shot(knees, 0.15),
    full: shot(Math.min(0, top - height), 0.08),
  };
}

// Mouse-Man between gestures: alive the way a person standing still is, not
// a loop. Every behaviour draws its next goal at random, at a random time,
// and gets there on a critically damped spring (no snaps, no fixed rhythm):
//   * breathing, a breath at a time, chest and shoulders rising;
//   * gaze: mostly at you, now and then a glance aside;
//   * posture: the weight shifts, the torso leans and turns a little;
//   * arms: hang loose, swing and bend a little, fingers relaxed;
//   * listening (you talk): leans in, tilts the head, nods when you pause;
//   * talking (HuRI speaks without gestures): leans in, the head follows the
//     voice.
// Offsets are rotations about world axes (x: lean forward / nod, y: turn to
// his left, z: tilt to his left), in each bone's parent frame at rest, scaled
// by `gain` (avatars.yaml's motion.idle).
const IDLE_DT_MAX = 0.05; // a hidden tab's long frame must not kick the springs
const LISTEN_S = 0.6; // the visitor still talks if heard this recently
const PAUSE_NOD_S = 0.35; // a pause this long gets a nod (sometimes)

function idleLife(model, idle, gain = 1) {
  const rng = (lo, hi) => lo + Math.random() * (hi - lo);
  const pick = (p) => Math.random() < p;
  const spring = (w) => ({ x: 0, v: 0, goal: 0, w });
  const step = (s, dt) => {
    s.v += (s.w * s.w * (s.goal - s.x) - 2 * s.w * s.v) * dt;
    s.x += s.v * dt;
    return s.x;
  };

  model.updateMatrixWorld(true);
  const joints = new Map(); // bone -> {rest, frame, frameInv}
  const bone = (name) => {
    const b = model.getObjectByName(`mixamorig${name}`);
    if (!b || !idle.has(b)) return null;
    if (!joints.has(b)) {
      const frame = b.parent.getWorldQuaternion(new THREE.Quaternion());
      joints.set(b, { rest: idle.get(b), frame, frameInv: frame.clone().invert() });
    }
    return b;
  };
  const B = {
    spine: bone("Spine"), spine1: bone("Spine1"), spine2: bone("Spine2"),
    neck: bone("Neck"), head: bone("Head"),
  };
  const sides = [["Left", 1], ["Right", -1]].map(([Side, s]) => ({
    s,
    collar: bone(`${Side}Shoulder`),
    arm: bone(`${Side}Arm`),
    forearm: bone(`${Side}ForeArm`),
    hand: bone(`${Side}Hand`),
    fingers: ["Index", "Middle", "Ring", "Pinky"].flatMap((f) =>
      [1, 2, 3].map((k) => [bone(`${Side}Hand${f}${k}`), k]),
    ),
    swing: spring(3), out: spring(3), bend: spring(3.5), wrist: spring(4),
    next: rng(1, 4),
  }));

  const gaze = { yaw: spring(9), pitch: spring(9), roll: spring(5), next: 1 };
  const neckLag = { yaw: spring(5), pitch: spring(5) };
  const posture = { lean: spring(1.6), turn: spring(1.6), tilt: spring(1.6), next: 3 };
  const listenLean = spring(2.5);
  const nod = spring(14);
  let nodLeft = 0; // seconds of the nod being played
  let breath = Math.random();
  let breathRate = rng(0.2, 0.28);
  let wasListening = false;
  let lastHeard = null;
  let pauseNodded = true;

  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const offset = new THREE.Quaternion();
  const goal = new THREE.Quaternion();
  const targets = new Map();
  function pose(b, x, y, z) {
    if (!b) return;
    const { rest, frame, frameInv } = joints.get(b);
    offset.setFromEuler(euler.set(x * gain, y * gain, z * gain));
    goal.copy(frameInv).multiply(offset).multiply(frame).multiply(rest);
    targets.set(b, (targets.get(b) || new THREE.Quaternion()).copy(goal));
  }

  return {
    // Advance by dt; `talk` is HuRI's voice (0..1), `heardAt` when the
    // visitor last spoke (performance.now() ms, or null).
    update(dt, talk, heardAt) {
      dt = Math.min(dt, IDLE_DT_MAX);
      const listening = heardAt !== null && performance.now() - heardAt < LISTEN_S * 1000;
      const attentive = listening || talk > 0.05;

      // Gaze: hold, then look somewhere else; at you while someone talks.
      if ((gaze.next -= dt) <= 0) {
        const aside = !attentive && pick(0.3);
        gaze.yaw.goal = aside ? rng(0.12, 0.3) * (pick(0.5) ? 1 : -1) : rng(-0.07, 0.07);
        gaze.pitch.goal = aside ? rng(-0.08, 0.1) : rng(-0.04, 0.05);
        gaze.roll.goal = rng(-0.04, 0.04);
        // Talking, the head moves more often.
        gaze.next = aside ? rng(0.7, 1.6) : talk > 0.05 ? rng(0.8, 2) : rng(1.5, 4.5);
      }
      if (listening && !wasListening) {
        gaze.yaw.goal = rng(-0.04, 0.04);
        gaze.roll.goal = rng(0.05, 0.1) * (pick(0.5) ? 1 : -1); // a curious tilt
        gaze.next = rng(2, 4);
      }
      // A nod, often, when the visitor pauses; now and then while they talk.
      if (heardAt !== lastHeard) {
        lastHeard = heardAt; // still talking: the next pause is a new one
        pauseNodded = false;
      }
      const quiet = heardAt === null ? Infinity : (performance.now() - heardAt) / 1000;
      if (!pauseNodded && quiet > PAUSE_NOD_S && quiet < 2 * LISTEN_S) {
        pauseNodded = true;
        if (pick(0.7) && nodLeft <= 0) nodLeft = rng(0.45, 0.7);
      }
      if (listening && nodLeft <= 0 && pick(dt / 3)) nodLeft = rng(0.35, 0.5);
      wasListening = listening;
      if (nodLeft > 0) nodLeft -= dt;
      nod.goal = nodLeft > 0 ? 0.09 : 0;

      // Posture: shift the weight every few seconds.
      if ((posture.next -= dt) <= 0) {
        posture.lean.goal = rng(-0.02, 0.03);
        posture.turn.goal = rng(-0.07, 0.07);
        posture.tilt.goal = rng(-0.035, 0.035);
        posture.next = rng(3.5, 8);
      }
      listenLean.goal = attentive ? 0.045 : 0;

      // Breathing: a breath at a time, each a little different.
      breath += breathRate * dt;
      if (breath >= 1) {
        breath -= 1;
        breathRate = rng(0.2, 0.3);
      }
      const inhale = 0.5 - 0.5 * Math.cos(breath * 2 * Math.PI);

      const lean = step(posture.lean, dt) + step(listenLean, dt);
      const turn = step(posture.turn, dt);
      const tilt = step(posture.tilt, dt);
      const yaw = step(gaze.yaw, dt);
      const pitch = step(gaze.pitch, dt) + step(nod, dt) + talk * 0.05;
      const roll = step(gaze.roll, dt);
      neckLag.yaw.goal = yaw;
      neckLag.pitch.goal = pitch;
      const neckYaw = step(neckLag.yaw, dt);
      const neckPitch = step(neckLag.pitch, dt);

      pose(B.spine, lean * 0.4, turn * 0.3, tilt * 0.5);
      pose(B.spine1, lean * 0.3, turn * 0.3, tilt * 0.3);
      pose(B.spine2, lean * 0.3 - inhale * 0.03, turn * 0.4, tilt * 0.2);
      // The head turns first, the neck follows; together they undo the
      // torso's turn and tilt, so he keeps looking where he means to.
      pose(B.neck, neckPitch * 0.4, neckYaw * 0.4 - turn * 0.5, -tilt * 0.5);
      pose(B.head, pitch * 0.6 - lean * 0.5 + inhale * 0.012, yaw * 0.6 - turn * 0.5, roll - tilt * 0.5);

      for (const side of sides) {
        if ((side.next -= dt) <= 0) {
          side.swing.goal = rng(-0.1, 0.05);
          side.out.goal = rng(0, 0.08);
          side.bend.goal = pick(0.3) ? rng(0.3, 0.55) : rng(0.05, 0.25);
          side.wrist.goal = rng(-0.15, 0.15);
          side.next = rng(3, 8);
        }
        const { s } = side;
        const swing = step(side.swing, dt) - lean * 0.8; // arms hang plumb
        pose(side.collar, 0, 0, s * inhale * 0.035);
        pose(side.arm, swing, 0, s * step(side.out, dt));
        pose(side.forearm, -step(side.bend, dt), 0, 0);
        pose(side.hand, step(side.wrist, dt) * 0.3, 0, -s * step(side.wrist, dt) * 0.5);
        for (const [finger, k] of side.fingers) pose(finger, 0, 0, -s * [0, 0.3, 0.4, 0.3][k]);
      }
    },
    // Ease every idle bone toward its pose (the rest one if not posed).
    apply(ease) {
      for (const [b, rest] of idle) b.quaternion.slerp(targets.get(b) || rest, ease);
    },
  };
}

// Turn `bone` (the least) so that `child` lies in direction `dir` from it.
function pointBone(bone, child, dir) {
  bone.updateWorldMatrix(true, true);
  const from = child
    .getWorldPosition(new THREE.Vector3())
    .sub(bone.getWorldPosition(new THREE.Vector3()))
    .normalize();
  const swing = new THREE.Quaternion().setFromUnitVectors(from, dir.clone().normalize());
  const world = swing.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parent.multiply(world));
  bone.updateWorldMatrix(false, true);
}

// Mixamo rigs come in a T-pose: swing an upper arm down along the body, `out`
// to the side (per unit down).
function lowerArm(model, armName, forearmName, side, out) {
  const arm = model.getObjectByName(armName);
  const forearm = model.getObjectByName(forearmName);
  if (arm && forearm) pointBone(arm, forearm, new THREE.Vector3(side * out, -1, 0.08));
}

// How far out a straight arm hangs so that, from the elbow down, it clears
// the belly and the hips by a forearm's thickness: close to the body of a
// person, away from a cartoon's round belly. From the measured body (see
// measureBody); 0.22 without one.
function armsOut(body) {
  const { shoulder, upper_arm: upper, forearm, waist, chest, hip } = body || {};
  if (!shoulder || !upper || !forearm || !waist || !chest || !hip) return 0.22;
  const lerp = (y, y0, y1, v0, v1) => v0 + (v1 - v0) * Math.min(1, Math.max(0, (y - y0) / (y1 - y0 || 1)));
  // The trunk's half width at height y, as huri-module-think's Body.front().
  const half = (y) => (y < waist[0] ? lerp(y, hip[0], waist[0], hip[1], waist[2]) : lerp(y, waist[0], chest[0], waist[2], chest[2]));
  const [x, top] = [shoulder[0], shoulder[1]];
  let out = 0.03;
  for (let y = top - upper; y > top - upper - forearm; y -= 0.01) {
    out = Math.max(out, (half(y) + 0.16 * upper - x) / (top - y));
  }
  return Math.min(out, 0.4);
}

// SMPL-X's rest pose, which gestures are relative to, is a T-pose: arms
// straight out to the sides, palms down. A model resting in an A-pose
// (Rocketbox's: arms 45 degrees down, elbows a little bent) is put in it:
// upper arm, forearm and hand each point along the arm to the next bone.
// Turned the least, the palms that faced the thighs face down.
function toTPose(model) {
  for (const [Side, side] of [["Left", 1], ["Right", -1]]) {
    const chain = ["Arm", "ForeArm", "Hand", "HandMiddle1"].map((name) =>
      model.getObjectByName(`mixamorig${Side}${name}`),
    );
    const out = new THREE.Vector3(side, 0, 0);
    for (let i = 0; i + 1 < chain.length; i++) {
      if (chain[i] && chain[i + 1]) pointBone(chain[i], chain[i + 1], out);
    }
  }
}

// The body huri-module-think solves its thinking poses on (its Body): metres
// (the model scaled to `heightM`), from the pelvis, in SMPL-X's axes (x: his
// left, y: up, z: forward, as the model stands), in the T-pose. Joints from
// the bones; the chin, chest, belly and hips from the skin, carried by the
// head and the trunk bones. The chin is the point jawOpen moves most, or
// without it the lowest point of the front of the face.
const TRUNK_BONES = new Set(["Hips", "Spine", "Spine1", "Spine2"].map((n) => `mixamorig${n}`));

function measureBody(model, heightM) {
  model.updateMatrixWorld(true);
  const at = (name) => {
    const bone = model.getObjectByName(`mixamorig${name}`);
    return bone && bone.getWorldPosition(new THREE.Vector3());
  };
  const pelvis = at("Hips");
  const neck = at("Neck");
  const wrist = at("LeftHand");
  if (!pelvis || !neck || !wrist || !at("LeftArm") || !at("LeftForeArm")) return null;

  const trunk = [];
  const hand = [];
  const head = [];
  let chin = null;
  let chinMove = 0;
  let lo = Infinity;
  let hi = -Infinity;
  const v = new THREE.Vector3();
  const move = new THREE.Vector3();
  model.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const { skinIndex, skinWeight, position } = mesh.geometry.attributes;
    const jawAt = Object.entries(mesh.morphTargetDictionary || {}).find(([name]) => faceShapeName(name) === "jawOpen");
    const jaw = jawAt ? mesh.geometry.morphAttributes.position[jawAt[1]] : null;
    for (let i = 0; i < position.count; i++) {
      let k = 0; // the bone carrying this vertex most
      for (let j = 1; j < 4; j++) if (skinWeight.getComponent(i, j) > skinWeight.getComponent(i, k)) k = j;
      const carrier = mesh.skeleton.bones[skinIndex.getComponent(i, k)];
      v.fromBufferAttribute(position, i);
      mesh.applyBoneTransform(i, v);
      v.applyMatrix4(mesh.matrixWorld);
      lo = Math.min(lo, v.y);
      hi = Math.max(hi, v.y);
      if (!carrier) continue;
      if (TRUNK_BONES.has(carrier.name)) trunk.push(v.clone());
      else if (carrier.name.startsWith("mixamorigLeftHand")) hand.push(v.clone());
      else if (carrier.name === "mixamorigHead" || carrier.name.startsWith("Bip01_")) head.push(v.clone());
      if (jaw) {
        move.fromBufferAttribute(jaw, i);
        if (!mesh.geometry.morphTargetsRelative) move.sub(new THREE.Vector3().fromBufferAttribute(position, i));
        if (move.length() > chinMove) {
          chinMove = move.length();
          chin = v.clone();
        }
      }
    }
  });
  const scale = heightM / (hi - lo);
  const rel = (p) => p.clone().sub(pelvis).multiplyScalar(scale);
  const quantile = (xs, f) => {
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] : 0;
  };
  const skin = trunk.map(rel);
  const span = rel(neck).y;
  const band = (y) => skin.filter((p) => Math.abs(p.y - y) < 0.025);
  // Height, front (the middle third's), half width of the trunk at a
  // fraction of the way from the pelvis to the neck.
  const cut = (f) => {
    const y = f * span;
    const slice = band(y);
    const half = quantile(slice.map((p) => Math.abs(p.x)), 0.97);
    const middle = slice.filter((p) => Math.abs(p.x) < half / 3);
    return [y, quantile((middle.length ? middle : slice).map((p) => p.z), 0.98), half];
  };
  if (!chin && head.length) {
    // The front of the face: the lowest of the head's most forward points.
    const face = head.map(rel);
    const zFront = quantile(face.map((p) => p.z), 0.97);
    const zBack = quantile(face.map((p) => p.z), 0.03);
    const front = face.filter((p) => p.z > zFront - (zFront - zBack) * 0.25 && Math.abs(p.x) < 0.03);
    chin = front.length ? front.reduce((a, b) => (b.y < a.y ? b : a)) : null;
    if (chin) chin = chin.clone().divideScalar(scale).add(pelvis);
  }
  const shoulder = rel(at("LeftArm"));
  const hipY = 0.12 * span;
  const round = (x) => Math.round(x * 1000) / 1000;
  const body = {
    shoulder: [shoulder.x, shoulder.y, shoulder.z].map(round),
    upper_arm: round(at("LeftArm").distanceTo(at("LeftForeArm")) * scale),
    forearm: round(at("LeftForeArm").distanceTo(wrist) * scale),
    hand: round(Math.max(0, ...hand.map((p) => p.distanceTo(wrist))) * scale),
    chest: cut(0.62).map(round),
    waist: cut(0.28).map(round),
    hip: [hipY, quantile(band(hipY).map((p) => Math.abs(p.x)), 0.97)].map(round),
  };
  if (chin) body.chin = [rel(chin).y, rel(chin).z].map(round);
  // What could not be measured is left to the module's defaults.
  for (const [name, value] of Object.entries(body)) {
    const ok = [].concat(value).every((x) => Number.isFinite(x) && Math.abs(x) <= 3);
    if (!ok || (typeof value === "number" && value <= 0)) delete body[name];
  }
  return body;
}

// 3ds Max Biped bone names (Rocketbox: "Bip01 L UpperArm", "Bip01_L_UpperArm"
// once loaded) to the Mixamo ones the rest of this file uses. Biped's left
// and right are the character's, like Mixamo's; Finger0 is the thumb.
const BIPED_TRUNK = {
  Pelvis: "Hips", Spine: "Spine", Spine1: "Spine1", Spine2: "Spine2", Neck: "Neck", Head: "Head",
};
const BIPED_LIMBS = {
  Clavicle: "Shoulder", UpperArm: "Arm", Forearm: "ForeArm", Hand: "Hand",
  Thigh: "UpLeg", Calf: "Leg", Foot: "Foot", Toe0: "ToeBase",
};
const BIPED_FINGERS = ["Thumb", "Index", "Middle", "Ring", "Pinky"];

function bipedToMixamo(model) {
  const rename = (from, to) => {
    const bone = model.getObjectByName(`Bip01_${from}`);
    if (bone) bone.name = `mixamorig${to}`;
  };
  for (const [biped, mixamo] of Object.entries(BIPED_TRUNK)) rename(biped, mixamo);
  for (const [S, Side] of [["L", "Left"], ["R", "Right"]]) {
    for (const [biped, mixamo] of Object.entries(BIPED_LIMBS)) rename(`${S}_${biped}`, `${Side}${mixamo}`);
    BIPED_FINGERS.forEach((finger, i) => {
      ["", "1", "2"].forEach((segment, k) => rename(`${S}_Finger${i}${segment}`, `${Side}Hand${finger}${k + 1}`));
    });
  }
  // Biped hangs the thighs from the spine: every lean of the trunk would
  // swing the legs and slide the feet. They hang from the pelvis, as in
  // Mixamo's rig and SMPL-X (attach keeps where they are, and the skinning).
  const hips = model.getObjectByName("mixamorigHips");
  for (const Side of ["Left", "Right"]) {
    const thigh = model.getObjectByName(`mixamorig${Side}UpLeg`);
    if (hips && thigh && thigh.parent !== hips) hips.attach(thigh);
  }
}

// Rocketbox FBXs name their textures by absolute Windows paths to TGAs, which
// the browser cannot load: each is loaded from `dir` instead, by file name,
// as the WebP scripts/fetch_avatar.sh converted it to. The FBX loader still
// assigns them (colour, normal, specular, cut-out) from the model.
function convertedTextures(manager, dir) {
  const loader = new THREE.TextureLoader(manager);
  manager.addHandler(/\.tga$/i, {
    setPath() {
      return this;
    },
    load(file) {
      const name = file.split(/[\\/]/).pop().replace(/\.tga$/i, ".webp");
      return loader.load(dir + name);
    },
  });
}

// Hair cards and eyelashes are cut out by their colour texture's alpha; the
// FBX also gives that texture as an alpha map, which three.js reads from the
// green channel (dark hair would vanish). Drawn after the skin, without
// hiding what is behind their transparent parts.
function fixCutouts(model) {
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    for (const material of [].concat(obj.material)) {
      if (!material.alphaMap) continue;
      material.alphaMap = null;
      material.transparent = true;
      material.alphaTest = 0.05;
      material.depthWrite = false;
      material.needsUpdate = true;
    }
  });
}

// Blend shapes can be spread over several meshes (head, teeth, eyelashes):
// set(name, weight) updates every mesh that has that shape. Names are the
// ARKit ones (jawOpen) and Oculus visemes (viseme_aa); Rocketbox's
// "blendShape1.AK_25_JawOpen" and "blendShape1.AA_VI_10_aa" answer to them.
function faceShapeName(name) {
  const bare = name.replace(/^.*\./, "");
  const arkit = bare.match(/^AK_\d+_(.+)$/);
  if (arkit) return arkit[1][0].toLowerCase() + arkit[1].slice(1);
  const viseme = bare.match(/^AA_VI_\d+_(.+)$/);
  if (viseme) return `viseme_${viseme[1]}`;
  return bare;
}

function faceControls(model) {
  const targets = []; // [mesh, {name: morph index}]
  model.traverse((obj) => {
    if (!obj.isMesh || !obj.morphTargetDictionary) return;
    const shapes = {};
    for (const [name, i] of Object.entries(obj.morphTargetDictionary)) {
      shapes[name] = i;
      shapes[faceShapeName(name)] ??= i;
      shapes[faceShapeName(name).toLowerCase()] ??= i;
    }
    targets.push([obj, shapes]);
  });
  return {
    has(name) {
      return targets.some(([, shapes]) => (shapes[name] ?? shapes[name.toLowerCase()]) !== undefined);
    },
    set(name, weight) {
      for (const [mesh, shapes] of targets) {
        const i = shapes[name] ?? shapes[name.toLowerCase()];
        if (i !== undefined) mesh.morphTargetInfluences[i] = weight;
      }
    },
  };
}

main().catch((err) => {
  console.error("[avatar] could not load the avatar:", err);
  container.hidden = true;
  document.body.classList.remove("has-avatar");
});
