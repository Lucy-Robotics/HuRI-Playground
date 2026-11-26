export function shouldCutAnswer({ interrupts, writing, playing }) {
  return interrupts && (writing || playing);
}

export function sendsSilence({ interrupts, speaking }) {
  return !interrupts && speaking;
}

export function sendLocked({ interrupts, waiting, ended }) {
  return ended || (waiting && !interrupts);
}
