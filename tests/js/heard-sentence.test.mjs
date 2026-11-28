import test from "node:test";
import assert from "node:assert/strict";

import { sentenceAsMessage } from "../../huri_playground/static/heard-sentence.js";

const transcriptOnly = ["huri.transcript"];
const withQuestions = ["huri.transcript", "huri.question", "huri.token"];

test("the final sentence becomes your message when no question comes back", () => {
  assert.equal(
    sentenceAsMessage({ text: " What is a robot? ", end: true }, transcriptOnly),
    "What is a robot?",
  );
});

test("a question builder sends the message instead", () => {
  assert.equal(sentenceAsMessage({ text: "What is a robot?", end: true }, withQuestions), null);
});

test("a window heard while you speak is not a message", () => {
  assert.equal(sentenceAsMessage({ text: "What is", end: false }, transcriptOnly), null);
});

test("an empty final pass is not a message", () => {
  assert.equal(sentenceAsMessage({ text: "", end: true }, transcriptOnly), null);
  assert.equal(sentenceAsMessage({ text: "   ", end: true }, transcriptOnly), null);
  assert.equal(sentenceAsMessage({ text: null, end: true }, transcriptOnly), null);
});
