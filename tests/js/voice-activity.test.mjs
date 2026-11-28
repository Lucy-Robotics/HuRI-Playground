import test from "node:test";
import assert from "node:assert/strict";

import { hearsSpeech } from "../../huri_playground/static/voice-activity.js";

test("a frame of samples means HuRI hears speech", () => {
  assert.equal(hearsSpeech({ data: [0.01, -0.02] }, true), true);
});

test("the end marker means the visitor stopped", () => {
  assert.equal(hearsSpeech({ data: null }, true), false);
});

test("a frame arriving with the microphone off does not light it", () => {
  assert.equal(hearsSpeech({ data: [0.01] }, false), false);
});
