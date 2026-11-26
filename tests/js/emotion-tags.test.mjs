import test from "node:test";
import assert from "node:assert/strict";

import {
  INTERRUPTED_TAG,
  SENTENCE_TAG_MAX_CHARS,
  bubbleForSentence,
  capitalize,
  reactionTagText,
  replyTagText,
  sentenceText,
} from "../../huri_playground/static/emotion-tags.js";

const joy = (text, intensity = 0.62, extra = {}) => ({
  label: "joy",
  intensity,
  text,
  ...extra,
});

test("constants", () => {
  assert.equal(SENTENCE_TAG_MAX_CHARS, 60);
  assert.equal(INTERRUPTED_TAG, "Interrupted");
});

test("reply tag: label, percentage and the sentence", () => {
  assert.equal(replyTagText(joy("I am so happy for you")), 'Joy 62% · "I am so happy for you"');
});

test("reply tag intensities 0, 1 and 0.625", () => {
  assert.equal(replyTagText(joy("x", 0)), 'Joy 0% · "x"');
  assert.equal(replyTagText(joy("x", 1)), 'Joy 100% · "x"');
  assert.equal(replyTagText(joy("x", 0.625)), 'Joy 63% · "x"');
});

test("the sentence is trimmed", () => {
  assert.equal(replyTagText(joy("  hello  ")), 'Joy 62% · "hello"');
  assert.equal(sentenceText(joy("  hello  ")), "hello");
});

test("60 code points are kept, 61 are cut with an ellipsis", () => {
  const sixty = "a".repeat(60);
  assert.equal(replyTagText(joy(sixty)), `Joy 62% · "${sixty}"`);
  assert.equal(replyTagText(joy(sixty + "b")), `Joy 62% · "${sixty}..."`);
});

test("an emoji is counted and cut as one character", () => {
  const text = "😀".repeat(61);
  assert.equal(replyTagText(joy(text)), `Joy 62% · "${"😀".repeat(60)}..."`);
  assert.equal(replyTagText(joy("😀".repeat(60))), `Joy 62% · "${"😀".repeat(60)}"`);
});

test("empty text gives the label and percentage only", () => {
  assert.equal(replyTagText(joy("")), "Joy 62%");
  assert.equal(replyTagText(joy("   ")), "Joy 62%");
  assert.equal(replyTagText(joy(undefined)), "Joy 62%");
});

test("an end marker with no text gives no tag", () => {
  assert.equal(replyTagText(joy("", 0.5, { end: true })), null);
  assert.equal(replyTagText(joy("", 0.5, { end: true })), null);
});

test("an end marker that carries text still gives a tag", () => {
  assert.equal(replyTagText(joy("bye", 0.5, { end: true })), 'Joy 50% · "bye"');
});

test("reaction tag", () => {
  assert.equal(reactionTagText(joy("", 0.62)), "HuRI reacts: Joy 62%");
});

test("bubbleForSentence: the latest matching bubble wins", () => {
  const bubbles = [
    { said: "Hello there. How are you?", isInterrupted: false },
    { said: "Hello there. Fine.", isInterrupted: false },
  ];
  assert.equal(bubbleForSentence(bubbles, "Hello there."), 1);
  assert.equal(bubbleForSentence(bubbles, "How are you?"), 0);
});

test("bubbleForSentence: interrupted bubbles are skipped", () => {
  const bubbles = [
    { said: "Hello there.", isInterrupted: false },
    { said: "Hello there.", isInterrupted: true },
  ];
  assert.equal(bubbleForSentence(bubbles, "Hello there."), 0);
  assert.equal(bubbleForSentence([bubbles[1]], "Hello there."), -1);
});

test("bubbleForSentence: no match and no bubbles give -1", () => {
  assert.equal(bubbleForSentence([{ said: "Hi", isInterrupted: false }], "Bye"), -1);
  assert.equal(bubbleForSentence([], "Bye"), -1);
});

test("bubbleForSentence: the sentence is matched trimmed", () => {
  assert.equal(bubbleForSentence([{ said: "Hi there", isInterrupted: false }], "  Hi there "), 0);
});

test("capitalize", () => {
  assert.equal(capitalize("joy"), "Joy");
  assert.equal(capitalize(""), "");
});

test("a missing or non-numeric intensity gives the label without a percentage", () => {
  assert.equal(replyTagText({ label: "joy", text: "x" }), 'Joy · "x"');
  assert.equal(replyTagText({ label: "joy", intensity: "high", text: "" }), "Joy");
  assert.equal(reactionTagText({ label: "joy", intensity: NaN }), "HuRI reacts: Joy");
});

test("non-string text counts as empty", () => {
  for (const text of [null, 42, {}, ["a"]]) {
    assert.equal(replyTagText(joy(text)), "Joy 62%");
    assert.equal(sentenceText(joy(text)), "");
  }
  assert.equal(replyTagText(joy(null, 0.5, { end: true })), null);
});

test("bubbleForSentence treats non-string text as empty", () => {
  const bubbles = [{ said: "Hi", isInterrupted: false }, { said: "Yo", isInterrupted: true }];
  assert.equal(bubbleForSentence(bubbles, undefined), 0);
  assert.equal(bubbleForSentence(bubbles, 5), 0);
});
