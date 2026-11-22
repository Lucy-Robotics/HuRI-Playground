import { UtteranceGate } from "./utterance-gate.js";

const PLAY_LEAD_SECONDS = 0.05;
const ECHO_TAIL_SECONDS = 0.3;
const ANALYSER_FFT_SIZE = 1024;

// Plays HuRI's `audio.out` chunks back to back, in the order they arrive.
// avatar.js reads level() for Mouse-Man's talking cues, and contextTime() to
// play `motion` frames in step with the voice.
export function createSpeaker(createContext, onChunkScheduled = () => {}) {
  const gate = new UtteranceGate();
  const sources = new Set();
  let ctx = null;
  let analyser = null;
  let samples = null;
  let next = 0; // AudioContext time at which the next chunk starts
  // [pts, AudioContext time] of each chunk of the current utterance. Kept
  // after the end marker: the last gesture chunk arrives after it.
  let anchors = [];
  let fresh = true; // the next chunk opens a new utterance

  function unlock() {
    if (!ctx) {
      ctx = createContext();
      analyser = ctx.createAnalyser();
      analyser.fftSize = ANALYSER_FFT_SIZE;
      analyser.connect(ctx.destination);
      samples = new Float32Array(analyser.fftSize);
    }
    ctx.resume();
  }

  // Loudness (RMS) of what is playing right now; about 0.1 for speech.
  function level() {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    return Math.sqrt(sum / samples.length);
  }

  function schedule(sampleRate, chunk, pts) {
    const buffer = ctx.createBuffer(1, chunk.length, sampleRate);
    buffer.copyToChannel(chunk, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    next = Math.max(next, ctx.currentTime + PLAY_LEAD_SECONDS);
    source.start(next);
    sources.add(source);
    source.onended = () => sources.delete(source);

    if (fresh) anchors = [];
    fresh = false;
    anchors.push([pts, next]);
    onChunkScheduled(next - ctx.currentTime);
    next += buffer.duration;
  }

  function play(sampleRate, chunk, pts, end) {
    if (!gate.admits(pts)) return;
    if (ctx && chunk.length > 0) schedule(sampleRate, chunk, pts);
    if (end) fresh = true;
  }

  function flush() {
    for (const source of sources) {
      source.onended = null;
      source.stop();
    }
    sources.clear();
    next = 0;
    anchors = [];
    fresh = true;
    gate.cut();
  }

  function isPlaying() {
    return sources.size > 0;
  }

  // True while HuRI's voice is playing, plus a short tail for the room's echo.
  function speaking() {
    return Boolean(ctx) && next > 0 && next + ECHO_TAIL_SECONDS > ctx.currentTime;
  }

  // AudioContext time at which utterance time `pts` is (or was) heard.
  function contextTime(pts) {
    let anchor = null;
    for (const a of anchors) if (a[0] <= pts) anchor = a;
    return anchor && anchor[1] + (pts - anchor[0]);
  }

  function admitsMedia() {
    return gate.isOpen;
  }

  return {
    get ctx() {
      return ctx;
    },
    unlock,
    level,
    play,
    flush,
    isPlaying,
    speaking,
    contextTime,
    admitsMedia,
  };
}
