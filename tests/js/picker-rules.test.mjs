import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  checkSelection,
  feedersOf,
  firstUnfedInput,
  isFed,
  needsText,
  producedTopics,
  chosenRows,
  withRow,
  withoutRow,
} from "../../huri_playground/static/picker-rules.js";

function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
}

const catalog = fixture("public_catalog.json");
const { cases } = fixture("picker_cases.json");
const { modules: rows, inbound, rendered } = catalog;
const names = (list) => list.map((row) => row.name);

for (const { name, chosen, valid, unfed_row, unfed_topic, feeders } of cases) {
  test(`case: ${name}`, () => {
    const set = new Set(chosen);
    const unfed = firstUnfedInput(rows, set, inbound);
    assert.equal(unfed ? unfed.row.name : null, unfed_row);
    assert.equal(unfed ? unfed.topic : null, unfed_topic);
    assert.equal(checkSelection(rows, set, inbound, rendered).problem === undefined, valid);
    if (feeders !== null) assert.deepEqual(names(feedersOf(unfed_topic, rows)), feeders);
  });
}

test("the catalogue's own selection is valid", () => {
  const result = checkSelection(rows, new Set(catalog.selected), inbound, rendered);
  assert.equal(result.problem, undefined);
});

test("producedTopics collects the outputs of chosen rows", () => {
  const chosen = chosenRows(rows, new Set(["rag", "tts"]));
  assert.deepEqual([...producedTopics(chosen)].sort(), ["huri.audio.out", "huri.token"]);
});

test("a row never feeds itself", () => {
  const thinking = rows.find((r) => r.name === "thinking");
  assert.equal(isFed(thinking, [thinking], inbound), false);
  assert.deepEqual(names(feedersOf("huri.audio.out", rows)), ["tts"]);
});

test("needsText names the feeders, or says none exists", () => {
  assert.equal(needsText("huri.audio.out", rows), "Voice");
  assert.equal(needsText("huri.nothing", rows), '"huri.nothing", which no module here produces');
});

test("messages: Lip sync needs Voice, Thinking needs Voice", () => {
  const lips = checkSelection(rows, new Set(["rag", "lips"]), inbound, rendered);
  assert.equal(lips.problem, "Lip sync needs Voice.");
  const thinking = checkSelection(rows, new Set(["rag", "thinking"]), inbound, rendered);
  assert.equal(thinking.problem, "Thinking needs Voice.");
  assert.equal(
    checkSelection(rows, new Set(), inbound, rendered).problem,
    "Pick at least one module.",
  );
});

test("withRow ticks the only feeder, all the way down, in a new Set", () => {
  const start = new Set();
  const next = withRow(rows, start, inbound, "lips");
  assert.deepEqual([...next].sort(), ["lips", "rag", "tts"]);
  assert.equal(start.size, 0);
  assert.notEqual(next, start);
});

test("withRow leaves an already ticked row alone and ignores unknown rows", () => {
  const start = new Set(["rag"]);
  assert.deepEqual([...withRow(rows, start, inbound, "rag")], ["rag"]);
  assert.deepEqual([...withRow(rows, start, inbound, "nope")], ["rag"]);
});

test("withoutRow unticks what only it was feeding, in a new Set", () => {
  const start = new Set(["rag", "tts", "lips", "thinking"]);
  const next = withoutRow(rows, start, inbound, "tts");
  assert.deepEqual([...next], ["rag"]);
  assert.equal(start.size, 4);
});

test("voice detection alone is listed with the voice activity it shows", () => {
  const result = checkSelection(rows, new Set(["vad"]), inbound, rendered);
  assert.deepEqual(result.sends, ["huri.audio.in"]);
  assert.deepEqual(result.gets, ["huri.voice"]);
  assert.deepEqual(result.silent, []);
});

test("withoutRow keeps rows that are still fed", () => {
  const start = new Set(["rag", "tts", "lips", "mov"]);
  assert.deepEqual([...withoutRow(rows, start, inbound, "lips")].sort(), ["mov", "rag", "tts"]);
});

test("what you send is listed with what HuRI shows back", () => {
  const result = checkSelection(rows, new Set(["vad", "stt", "tag"]), inbound, rendered);
  assert.deepEqual(result.sends, ["huri.audio.in"]);
  assert.deepEqual(result.gets, ["huri.voice", "huri.transcript"]);
  assert.deepEqual(result.silent, []);
});

function ticking(...order) {
  return [...order.reduce((set, name) => withRow(rows, set, inbound, name), new Set())].sort();
}

test("withRow links speech to what answers: Speech to text then Voice ticks both builders", () => {
  assert.deepEqual(ticking("stt", "tts"), ["qag", "rag", "stt", "tag", "tts", "vad"]);
});

test("withRow links speech to what answers in either order", () => {
  assert.deepEqual(ticking("tts", "stt"), ticking("stt", "tts"));
});

test("withRow links speech and emotion to HuRI's emotion", () => {
  assert.deepEqual(ticking("stt", "emo", "eag", "huri_emotion"), [
    "eag",
    "emo",
    "huri_emotion",
    "qag",
    "rag",
    "stt",
    "tag",
    "vad",
  ]);
});

test("withRow adds only the missing builder", () => {
  assert.deepEqual(ticking("stt", "emo", "eag", "qag", "rag"), [
    "eag",
    "emo",
    "qag",
    "rag",
    "stt",
    "tag",
    "vad",
  ]);
});

test("withRow ticks no builder when nothing answers", () => {
  assert.deepEqual(ticking("stt"), ["stt", "vad"]);
  assert.deepEqual(ticking("stt", "emo", "eag"), ["eag", "emo", "stt", "vad"]);
});

test("withRow does not tick back a builder for an unrelated row", () => {
  const start = new Set(["vad", "stt", "tag", "rag", "tts"]);
  assert.deepEqual([...withRow(rows, start, inbound, "lips")].sort(), [
    "lips",
    "rag",
    "stt",
    "tag",
    "tts",
    "vad",
  ]);
});
