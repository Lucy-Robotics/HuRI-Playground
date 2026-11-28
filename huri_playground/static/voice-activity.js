// huri.voice carries {data: [samples]} while the visitor speaks, {data: null} at the end.
// With the microphone off nothing is heard: frames still in flight must not light it.
export function hearsSpeech(voice, micOn) {
  return micOn && voice.data != null;
}
