export class UtteranceGate {
  #open = true;

  get isOpen() {
    return this.#open;
  }

  cut() {
    this.#open = false;
  }

  admits(pts) {
    if (pts === 0) this.#open = true;
    return this.#open;
  }
}
