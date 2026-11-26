import test from "node:test";
import assert from "node:assert/strict";

import { UtteranceGate } from "../../huri_playground/static/utterance-gate.js";

test("a gate that was never cut admits everything", () => {
  const gate = new UtteranceGate();
  for (const pts of [0, 0.5, 3]) assert.equal(gate.admits(pts), true);
  assert.equal(gate.isOpen, true);
});

test("after a cut, chunks with pts above 0 are dropped", () => {
  const gate = new UtteranceGate();
  gate.cut();
  assert.equal(gate.isOpen, false);
  assert.equal(gate.admits(0.13), false);
  assert.equal(gate.admits(2), false);
  assert.equal(gate.isOpen, false);
});

test("after a cut, pts 0 reopens the gate", () => {
  const gate = new UtteranceGate();
  gate.cut();
  assert.equal(gate.admits(0), true);
  assert.equal(gate.isOpen, true);
  assert.equal(gate.admits(0.5), true);
});

test("gates are independent", () => {
  const cutGate = new UtteranceGate();
  const otherGate = new UtteranceGate();
  cutGate.cut();
  assert.equal(cutGate.admits(1), false);
  assert.equal(otherGate.admits(1), true);
});

test("documented limit: an old answer's first chunk sent after the cut is admitted as new", () => {
  const gate = new UtteranceGate();
  gate.cut();
  assert.equal(gate.admits(0), true);
  assert.equal(gate.admits(0.4), true);
});
