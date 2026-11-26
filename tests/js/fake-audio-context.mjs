export class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.resumed = 0;
    this.sources = [];
    this.destination = { name: "destination" };
  }

  resume() {
    this.resumed += 1;
  }

  createAnalyser() {
    return {
      fftSize: 0,
      connected: null,
      connect(node) {
        this.connected = node;
      },
      getFloatTimeDomainData(target) {
        target.fill(0.1);
      },
    };
  }

  createBuffer(channels, length, sampleRate) {
    return {
      channels,
      length,
      duration: length / sampleRate,
      copyToChannel() {},
    };
  }

  createBufferSource() {
    const source = {
      buffer: null,
      startedAt: null,
      stopped: false,
      onended: null,
      connect() {},
      start(when) {
        this.startedAt = when;
      },
      stop() {
        this.stopped = true;
      },
    };
    this.sources.push(source);
    return source;
  }
}
