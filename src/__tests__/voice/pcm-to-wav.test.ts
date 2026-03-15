import { pcmToWav, concatPcmFrames } from '../../voice/pcm-to-wav';

describe('pcmToWav', () => {
  it('should produce a valid WAV header', () => {
    const pcm = new Int16Array(1600); // 100ms of silence at 16kHz
    const wav = pcmToWav(pcm);

    expect(wav.slice(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.slice(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.slice(12, 16).toString('ascii')).toBe('fmt ');
    expect(wav.slice(36, 40).toString('ascii')).toBe('data');
  });

  it('should encode correct sample rate in header', () => {
    const pcm = new Int16Array(3200);
    const wav = pcmToWav(pcm, { sampleRate: 44100 });
    const sampleRate = wav.readUInt32LE(24);
    expect(sampleRate).toBe(44100);
  });

  it('should encode 16000 Hz by default', () => {
    const pcm = new Int16Array(1600);
    const wav = pcmToWav(pcm);
    const sampleRate = wav.readUInt32LE(24);
    expect(sampleRate).toBe(16000);
  });

  it('should set correct data chunk size', () => {
    const pcm = new Int16Array(1600);
    const wav = pcmToWav(pcm);
    const dataSize = wav.readUInt32LE(40);
    expect(dataSize).toBe(pcm.byteLength);
  });

  it('should accept a Buffer as input', () => {
    const buf = Buffer.alloc(3200, 0);
    const wav = pcmToWav(buf);
    expect(wav.slice(0, 4).toString('ascii')).toBe('RIFF');
  });

  it('should return correct total size', () => {
    const pcm = new Int16Array(100);
    const wav = pcmToWav(pcm);
    // WAV header is 44 bytes + PCM data
    expect(wav.length).toBe(44 + pcm.byteLength);
  });
});

describe('concatPcmFrames', () => {
  it('should concatenate multiple frames', () => {
    const f1 = Buffer.from([1, 2, 3]);
    const f2 = Buffer.from([4, 5, 6]);
    const result = concatPcmFrames([f1, f2]);
    expect(result).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
  });

  it('should handle empty array', () => {
    const result = concatPcmFrames([]);
    expect(result.length).toBe(0);
  });
});
