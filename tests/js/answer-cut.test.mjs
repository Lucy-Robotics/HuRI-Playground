import test from "node:test";
import assert from "node:assert/strict";

import { sendsSilence, shouldCutAnswer } from "../../huri_playground/static/answer-cut.js";

const booleans = [false, true];

test("shouldCutAnswer: the whole truth table", () => {
  for (const interrupts of booleans) {
    for (const writing of booleans) {
      for (const playing of booleans) {
        const expected = interrupts && (writing || playing);
        assert.equal(
          shouldCutAnswer({ interrupts, writing, playing }),
          expected,
          JSON.stringify({ interrupts, writing, playing }),
        );
      }
    }
  }
});

test("sendsSilence: the whole truth table", () => {
  for (const interrupts of booleans) {
    for (const speaking of booleans) {
      assert.equal(
        sendsSilence({ interrupts, speaking }),
        !interrupts && speaking,
        JSON.stringify({ interrupts, speaking }),
      );
    }
  }
});
