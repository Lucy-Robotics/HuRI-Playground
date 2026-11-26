export const VISITOR_ID_KEY = "huri-playground-visitor";
export const VISITOR_ID_BYTES = 16;
const VISITOR_ID_PATTERN = /^[0-9a-f]{32}$/;

export function newVisitorId(randomBytes) {
  const bytes = randomBytes(VISITOR_ID_BYTES);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  if (!VISITOR_ID_PATTERN.test(id)) throw new Error("random bytes of the wrong size");
  return id;
}

function storedIdOf(storage) {
  const stored = storage.getItem(VISITOR_ID_KEY);
  return typeof stored === "string" && VISITOR_ID_PATTERN.test(stored) ? stored : null;
}

export function peekVisitorId(storage) {
  try {
    return storedIdOf(storage) === null ? "none" : "remembered";
  } catch {
    return "unavailable";
  }
}

export function readVisitorId(storage, randomBytes) {
  let stored;
  try {
    stored = storedIdOf(storage);
  } catch {
    return null;
  }
  if (stored !== null) return stored;
  const id = newVisitorId(randomBytes);
  try {
    storage.setItem(VISITOR_ID_KEY, id);
    return id;
  } catch {
    return null;
  }
}

export function forgetVisitorId(storage) {
  try {
    storage.removeItem(VISITOR_ID_KEY);
    return true;
  } catch {
    return false;
  }
}

export function startVisitorField(shouldRemember, storage, randomBytes) {
  if (!shouldRemember) return {};
  const visitor = readVisitorId(storage, randomBytes);
  return visitor ? { visitor } : {};
}
