import test from "node:test";
import assert from "node:assert/strict";

import { createSpeaker } from "../../huri_playground/static/speaker.js";
import { FakeAudioContext } from "./fake-audio-context.mjs";

const LEAD = 0.05;
const RATE = 1000;

function chunk(seconds) {
  return new Float32Array(seconds * RATE);
}

function setup(onChunkScheduled) {
  const ctx = new FakeAudioContext();
  const speaker = createSpeaker(() => ctx, onChunkScheduled);
  return { ctx, speaker };
}

function unlocked(onChunkScheduled) {
  const made = setup(onChunkScheduled);
  made.speaker.unlock();
  return made;
}

test("the public members are exactly the contract", () => {
  const { speaker } = setup();
  assert.deepEqual(Object.keys(speaker).sort(), [
    "admitsMedia",
    "contextTime",
    "ctx",
    "flush",
    "isPlaying",
    "level",
    "play",
    "speaking",
    "unlock",
  ]);
});

test("ctx is null before unlock and the injected context after", () => {
  const { ctx, speaker } = setup();
  assert.equal(speaker.ctx, null);
  speaker.unlock();
  assert.equal(speaker.ctx, ctx);
  assert.equal(ctx.resumed, 1);
  speaker.unlock();
  assert.equal(speaker.ctx, ctx);
  assert.equal(ctx.resumed, 2);
});

test("before unlock nothing plays and nothing speaks", () => {
  const { speaker } = setup();
  speaker.play(RATE, chunk(1), 0, false);
  assert.equal(speaker.isPlaying(), false);
  assert.equal(speaker.speaking(), false);
  assert.equal(speaker.level(), 0);
  speaker.flush();
});

test("chunks are scheduled back to back after a short lead", () => {
  const { ctx, speaker } = unlocked();
  ctx.currentTime = 10;
  speaker.play(RATE, chunk(1), 0, false);
  speaker.play(RATE, chunk(2), 1, false);
  assert.deepEqual(
    ctx.sources.map((s) => s.startedAt),
    [10 + LEAD, 10 + LEAD + 1],
  );
  assert.equal(speaker.isPlaying(), true);
  assert.equal(speaker.speaking(), true);
});

test("a source that ends is forgotten", () => {
  const { ctx, speaker } = unlocked();
  speaker.play(RATE, chunk(1), 0, false);
  ctx.sources[0].onended();
  assert.equal(speaker.isPlaying(), false);
});

test("onChunkScheduled gets the delay until the chunk is heard", () => {
  const delays = [];
  const { ctx, speaker } = unlocked((delay) => delays.push(delay));
  ctx.currentTime = 4;
  speaker.play(RATE, chunk(1), 0, false);
  ctx.currentTime = 4.5;
  speaker.play(RATE, chunk(1), 1, false);
  assert.equal(delays.length, 2);
  assert.ok(Math.abs(delays[0] - LEAD) < 1e-9);
  assert.ok(Math.abs(delays[1] - (4 + LEAD + 1 - 4.5)) < 1e-9);
});

test("speaker works without an onChunkScheduled callback", () => {
  const { speaker } = unlocked();
  speaker.play(RATE, chunk(1), 0, false);
  assert.equal(speaker.isPlaying(), true);
});

test("level reads the analyser's loudness", () => {
  const { speaker } = unlocked();
  assert.ok(Math.abs(speaker.level() - 0.1) < 1e-6);
});

test("contextTime maps utterance time onto the context clock", () => {
  const { ctx, speaker } = unlocked();
  ctx.currentTime = 1;
  speaker.play(RATE, chunk(1), 0, false);
  speaker.play(RATE, chunk(1), 1, true);
  assert.equal(speaker.contextTime(0.5), 1 + LEAD + 0.5);
  assert.equal(speaker.contextTime(1.25), 1 + LEAD + 1.25);
});

test("a new utterance forgets the anchors of the last one", () => {
  const { speaker } = unlocked();
  speaker.play(RATE, chunk(1), 0, true);
  assert.notEqual(speaker.contextTime(0.5), null);
  speaker.play(RATE, chunk(1), 0, false);
  assert.equal(speaker.contextTime(-1), null);
});

test("flush stops every source and empties at once", () => {
  const { ctx, speaker } = unlocked();
  speaker.play(RATE, chunk(1), 0, false);
  speaker.play(RATE, chunk(1), 1, false);
  speaker.flush();
  assert.deepEqual(
    ctx.sources.map((s) => s.stopped),
    [true, true],
  );
  assert.equal(speaker.isPlaying(), false);
  assert.equal(speaker.speaking(), false);
});

test("a stopped source's late onended does nothing", () => {
  const { ctx, speaker } = unlocked();
  speaker.play(RATE, chunk(1), 0, false);
  speaker.flush();
  assert.equal(ctx.sources[0].onended, null);
});

test("after flush the next play starts at currentTime plus the lead", () => {
  const { ctx, speaker } = unlocked();
  ctx.currentTime = 1;
  speaker.play(RATE, chunk(5), 0, false);
  ctx.currentTime = 2;
  speaker.flush();
  speaker.play(RATE, chunk(1), 0, false);
  assert.equal(ctx.sources[1].startedAt, 2 + LEAD);
});

test("flush clears the anchors", () => {
  const { speaker } = unlocked();
  speaker.play(RATE, chunk(1), 0, false);
  speaker.flush();
  assert.equal(speaker.contextTime(0.5), null);
});

test("after a cut, audio with pts above 0 is dropped", () => {
  const { ctx, speaker } = unlocked();
  speaker.play(RATE, chunk(1), 0, false);
  speaker.flush();
  speaker.play(RATE, chunk(1), 0.5, false);
  speaker.play(RATE, chunk(1), 1.5, true);
  assert.equal(ctx.sources.length, 1);
  assert.equal(speaker.isPlaying(), false);
});

test("after a cut, audio with pts 0 plays again with the rest of its utterance", () => {
  const { ctx, speaker } = unlocked();
  speaker.flush();
  speaker.play(RATE, chunk(1), 0, false);
  speaker.play(RATE, chunk(1), 1, false);
  assert.equal(ctx.sources.length, 2);
});

test("admitsMedia is true before any cut", () => {
  const { speaker } = unlocked();
  assert.equal(speaker.admitsMedia(), true);
});

test("admitsMedia is false after flush and true after the next pts 0 chunk", () => {
  const { speaker } = unlocked();
  speaker.play(RATE, chunk(1), 0, false);
  speaker.flush();
  assert.equal(speaker.admitsMedia(), false);
  speaker.play(RATE, chunk(1), 0.5, false);
  assert.equal(speaker.admitsMedia(), false);
  speaker.play(RATE, chunk(1), 0, false);
  assert.equal(speaker.admitsMedia(), true);
});

test("after a cut, a face with pts 0.13 is admitted once the next utterance's pts-0 audio has played", () => {
  const { speaker } = unlocked();
  const faceAdmitted = () => speaker.admitsMedia();
  speaker.play(RATE, chunk(1), 0, false);
  speaker.flush();
  assert.equal(faceAdmitted(), false);
  speaker.play(RATE, chunk(1), 0, false);
  assert.equal(faceAdmitted(), true);
});

test("an empty pts-0 chunk still reopens the gate", () => {
  const { ctx, speaker } = unlocked();
  speaker.flush();
  speaker.play(RATE, new Float32Array(0), 0, false);
  assert.equal(speaker.admitsMedia(), true);
  assert.equal(ctx.sources.length, 0);
});
