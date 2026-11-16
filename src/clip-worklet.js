// Passes raw microphone samples to the page while a test clip is being recorded.
class ClipTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) this.port.postMessage(channel.slice());
    return true;
  }
}
registerProcessor('clip-tap', ClipTap);
