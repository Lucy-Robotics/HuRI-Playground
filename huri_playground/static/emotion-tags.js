export const SENTENCE_TAG_MAX_CHARS = 60;
export const INTERRUPTED_TAG = "Interrupted";

export function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function labelAndPercent({ label, intensity }) {
  const name = capitalize(String(label ?? ""));
  return Number.isFinite(intensity) ? `${name} ${Math.round(intensity * 100)}%` : name;
}

export function sentenceText({ text }) {
  return typeof text === "string" ? text.trim() : "";
}

function shortened(sentence) {
  const characters = Array.from(sentence);
  if (characters.length <= SENTENCE_TAG_MAX_CHARS) return sentence;
  return `${characters.slice(0, SENTENCE_TAG_MAX_CHARS).join("")}...`;
}

export function replyTagText(expression) {
  const sentence = sentenceText(expression);
  if (!sentence) return expression.end ? null : labelAndPercent(expression);
  return `${labelAndPercent(expression)} · "${shortened(sentence)}"`;
}

export function reactionTagText(expression) {
  return `HuRI reacts: ${labelAndPercent(expression)}`;
}

export function bubbleForSentence(bubbles, text) {
  const sentence = typeof text === "string" ? text.trim() : "";
  for (let i = bubbles.length - 1; i >= 0; i--) {
    if (!bubbles[i].isInterrupted && bubbles[i].said.includes(sentence)) return i;
  }
  return -1;
}
