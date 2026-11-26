import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  VISITOR_ID_BYTES,
  VISITOR_ID_KEY,
  forgetVisitorId,
  newVisitorId,
  peekVisitorId,
  readVisitorId,
  startVisitorField,
} from "../../huri_playground/static/visitor-id.js";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/visitor_ids.json", import.meta.url), "utf8"),
);
const pattern = new RegExp(fixture.pattern);

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    writes: [],
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem(key, value) {
      this.writes.push(key);
      data.set(key, value);
    },
    removeItem: (key) => data.delete(key),
  };
}

function countingBytes() {
  let call = 0;
  return (length) => {
    call += 1;
    return Uint8Array.from({ length }, (_, i) => (call * 37 + i * 11) % 256);
  };
}

const brokenStorage = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
  removeItem() {
    throw new Error("blocked");
  },
};

test("a new id has the fixture's shape and the agreed byte count", () => {
  assert.equal(VISITOR_ID_BYTES, 16);
  assert.match(newVisitorId(countingBytes()), pattern);
});

test("a first visit stores and returns a new id", () => {
  const storage = memoryStorage();
  const id = readVisitorId(storage, countingBytes());
  assert.match(id, pattern);
  assert.equal(storage.data.get(VISITOR_ID_KEY), id);
});

test("a valid stored id is kept", () => {
  for (const valid of fixture.valid) {
    const storage = memoryStorage({ [VISITOR_ID_KEY]: valid });
    assert.equal(readVisitorId(storage, countingBytes()), valid);
  }
});

test("an invalid stored id is replaced by a valid one", () => {
  for (const { value, why } of fixture.invalid) {
    const storage = memoryStorage({ [VISITOR_ID_KEY]: value });
    const id = readVisitorId(storage, countingBytes());
    assert.match(id, pattern, why);
    assert.equal(storage.data.get(VISITOR_ID_KEY), id, why);
  }
});

test("storage that throws gives null", () => {
  assert.equal(readVisitorId(brokenStorage, countingBytes()), null);
});

test("random bytes of the wrong size are refused", () => {
  assert.throws(() => newVisitorId(() => new Uint8Array(3)));
});

test("read throws on random bytes of the wrong size, even with working storage", () => {
  assert.throws(() => readVisitorId(memoryStorage(), () => new Uint8Array(3)));
});

test("15 random bytes throw from newVisitorId and read", () => {
  const fifteen = () => new Uint8Array(15);
  assert.throws(() => newVisitorId(fifteen));
  assert.throws(() => readVisitorId(memoryStorage(), fifteen));
});

test("peek on empty storage says none and writes nothing", () => {
  const storage = memoryStorage();
  assert.equal(peekVisitorId(storage), "none");
  assert.deepEqual(storage.writes, []);
  assert.equal(storage.data.size, 0);
});

test("peek with a stored valid id says remembered and writes nothing", () => {
  for (const valid of fixture.valid) {
    const storage = memoryStorage({ [VISITOR_ID_KEY]: valid });
    assert.equal(peekVisitorId(storage), "remembered");
    assert.deepEqual(storage.writes, []);
  }
});

test("peek with an invalid stored value says none and leaves it alone", () => {
  for (const { value, why } of fixture.invalid) {
    const storage = memoryStorage({ [VISITOR_ID_KEY]: value });
    assert.equal(peekVisitorId(storage), "none", why);
    assert.deepEqual(storage.writes, [], why);
  }
});

test("peek says unavailable when storage throws or is missing", () => {
  assert.equal(peekVisitorId(brokenStorage), "unavailable");
  assert.equal(peekVisitorId(null), "unavailable");
});

test("forget leaves no key behind and returns true", () => {
  const storage = memoryStorage({ [VISITOR_ID_KEY]: fixture.valid[0] });
  assert.equal(forgetVisitorId(storage), true);
  assert.equal(storage.data.has(VISITOR_ID_KEY), false);
  assert.deepEqual(storage.writes, []);
});

test("forget returns false when storage throws", () => {
  assert.equal(forgetVisitorId(brokenStorage), false);
  assert.equal(forgetVisitorId(null), false);
});

test("the next read after forget creates a new id", () => {
  const randomBytes = countingBytes();
  const storage = memoryStorage();
  const first = readVisitorId(storage, randomBytes);
  forgetVisitorId(storage);
  const second = readVisitorId(storage, randomBytes);
  assert.match(second, pattern);
  assert.notEqual(second, first);
});

function untouchableStorage(calls) {
  const record = (name) => () => {
    calls.push(name);
    throw new Error(`${name} must not be called`);
  };
  return { getItem: record("getItem"), setItem: record("setItem"), removeItem: record("removeItem") };
}

test("unticked remember touches neither storage nor random bytes and sends no visitor", () => {
  const calls = [];
  const randomBytes = () => {
    calls.push("randomBytes");
    throw new Error("randomBytes must not be called");
  };
  assert.deepEqual(startVisitorField(false, untouchableStorage(calls), randomBytes), {});
  assert.deepEqual(calls, []);
});

test("ticked remember on empty storage stores and sends a new id", () => {
  const storage = memoryStorage();
  const field = startVisitorField(true, storage, countingBytes());
  assert.match(field.visitor, pattern);
  assert.deepEqual(Object.keys(field), ["visitor"]);
  assert.equal(storage.data.get(VISITOR_ID_KEY), field.visitor);
});

test("ticked remember with a stored id sends it and writes nothing", () => {
  const stored = fixture.valid[0];
  const storage = memoryStorage({ [VISITOR_ID_KEY]: stored });
  assert.deepEqual(startVisitorField(true, storage, countingBytes()), { visitor: stored });
  assert.deepEqual(storage.writes, []);
});

test("ticked remember with storage that throws sends no visitor", () => {
  assert.deepEqual(startVisitorField(true, brokenStorage, countingBytes()), {});
});

test("ticked remember with a full storage quota sends no visitor", () => {
  const storage = {
    getItem: () => null,
    setItem() {
      throw new DOMException("quota", "QuotaExceededError");
    },
    removeItem() {},
  };
  assert.deepEqual(startVisitorField(true, storage, countingBytes()), {});
});
