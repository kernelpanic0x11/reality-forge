// Minimal WAV (16-bit PCM, mono) writer and reader. Pure: used by the app to
// save a test clip, and by the tests and scripts to read one back.

export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const text = (offset, string) => { for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clipped * 32767), true);
  }
  return buffer;
}

// Returns { samples: Float32Array (first channel), sampleRate }.
export function decodeWav(buffer) {
  const view = new DataView(buffer);
  const tag = offset => String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw Error('Not a WAV file');
  let format = null, offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = tag(offset), size = view.getUint32(offset + 4, true), body = offset + 8;
    if (id === 'fmt ') {
      format = { type: view.getUint16(body, true), channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!format || format.type !== 1 || format.bits !== 16) throw Error('Only 16-bit PCM WAV is supported');
      const count = Math.floor(Math.min(size, view.byteLength - body) / 2 / format.channels);
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i++) samples[i] = view.getInt16(body + i * 2 * format.channels, true) / 32768;
      return { samples, sampleRate: format.sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw Error('WAV file has no audio data');
}
