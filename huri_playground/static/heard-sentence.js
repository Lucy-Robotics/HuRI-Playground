export function sentenceAsMessage(transcript, outbound) {
  if (!transcript.end || outbound.includes("huri.question")) return null;
  const text = (transcript.text || "").trim();
  return text || null;
}
