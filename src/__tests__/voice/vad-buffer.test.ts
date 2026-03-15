import { VadBuffer } from '../../voice/vad-buffer';

function makePcmChunk(samples: number, value = 0): Buffer {
  const buf = Buffer.alloc(samples * 2, 0);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(value, i * 2);
  }
  return buf;
}

describe('VadBuffer', () => {
  let vadBuffer: VadBuffer;

  beforeEach(() => {
    vadBuffer = new VadBuffer({ sampleRate: 16000, maxDurationMs: 5000 });
  });

  afterEach(() => {
    vadBuffer.destroy();
  });

  it('should emit utterance when VAD transitions from true to false', (done) => {
    vadBuffer.on('utterance', (seg) => {
      expect(seg.wavBuffer.length).toBeGreaterThan(44);
      expect(seg.durationMs).toBeGreaterThanOrEqual(0);
      done();
    });

    vadBuffer.onVad(true);
    vadBuffer.addChunk(makePcmChunk(1600)); // 100ms of audio
    vadBuffer.onVad(false);
  });

  it('should not emit utterance if no audio was added', () => {
    const listener = jest.fn();
    vadBuffer.on('utterance', listener);

    vadBuffer.onVad(true);
    vadBuffer.onVad(false);

    expect(listener).not.toHaveBeenCalled();
  });

  it('should produce WAV with correct RIFF header', (done) => {
    vadBuffer.on('utterance', (seg) => {
      expect(seg.wavBuffer.slice(0, 4).toString('ascii')).toBe('RIFF');
      expect(seg.wavBuffer.slice(8, 12).toString('ascii')).toBe('WAVE');
      done();
    });

    vadBuffer.onVad(true);
    vadBuffer.addChunk(makePcmChunk(3200));
    vadBuffer.onVad(false);
  });

  it('should update sample rate from audio chunk', (done) => {
    vadBuffer.on('utterance', (seg) => {
      const sampleRate = seg.wavBuffer.readUInt32LE(24);
      expect(sampleRate).toBe(44100);
      done();
    });

    vadBuffer.onVad(true);
    vadBuffer.addChunk(makePcmChunk(4410), 44100);
    vadBuffer.onVad(false);
  });

  it('should handle multiple utterances', (done) => {
    let count = 0;
    vadBuffer.on('utterance', () => {
      count++;
      if (count === 2) done();
    });

    vadBuffer.onVad(true);
    vadBuffer.addChunk(makePcmChunk(1600));
    vadBuffer.onVad(false);

    setTimeout(() => {
      vadBuffer.onVad(true);
      vadBuffer.addChunk(makePcmChunk(1600));
      vadBuffer.onVad(false);
    }, 50);
  });

  it('should not buffer chunks when not speaking', () => {
    const listener = jest.fn();
    vadBuffer.on('utterance', listener);

    // Add chunks without starting speech
    vadBuffer.addChunk(makePcmChunk(1600));
    vadBuffer.addChunk(makePcmChunk(1600));

    expect(listener).not.toHaveBeenCalled();
  });
});
