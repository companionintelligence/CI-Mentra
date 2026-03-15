/**
 * Converts raw PCM Int16Array audio data to a WAV file buffer.
 * This is needed for STT endpoints that require WAV file input.
 *
 * MentraOS delivers audio as PCM Int16Array @ typically 16 kHz, mono.
 */

export interface WavConversionOptions {
  /** Sample rate in Hz (default: 16000) */
  sampleRate?: number;
  /** Number of channels (default: 1 = mono) */
  numChannels?: number;
  /** Bits per sample (default: 16) */
  bitsPerSample?: number;
}

/**
 * Converts a PCM Int16Array (or Buffer of int16 samples) to WAV format.
 */
export function pcmToWav(pcmData: Int16Array | Buffer, options: WavConversionOptions = {}): Buffer {
  const sampleRate = options.sampleRate ?? 16000;
  const numChannels = options.numChannels ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;

  // Convert Int16Array or Buffer to raw bytes
  const pcmBytes = Buffer.isBuffer(pcmData)
    ? pcmData
    : Buffer.from(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);

  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBytes.length;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buf = Buffer.alloc(totalSize);
  let offset = 0;

  // RIFF chunk descriptor
  buf.write('RIFF', offset); offset += 4;
  buf.writeUInt32LE(totalSize - 8, offset); offset += 4;
  buf.write('WAVE', offset); offset += 4;

  // fmt sub-chunk
  buf.write('fmt ', offset); offset += 4;
  buf.writeUInt32LE(16, offset); offset += 4;           // PCM format size
  buf.writeUInt16LE(1, offset); offset += 2;            // PCM = 1
  buf.writeUInt16LE(numChannels, offset); offset += 2;
  buf.writeUInt32LE(sampleRate, offset); offset += 4;
  buf.writeUInt32LE(byteRate, offset); offset += 4;
  buf.writeUInt16LE(blockAlign, offset); offset += 2;
  buf.writeUInt16LE(bitsPerSample, offset); offset += 2;

  // data sub-chunk
  buf.write('data', offset); offset += 4;
  buf.writeUInt32LE(dataSize, offset); offset += 4;

  // PCM samples
  pcmBytes.copy(buf, offset);

  return buf;
}

/**
 * Concatenates multiple PCM audio frames into a single buffer.
 */
export function concatPcmFrames(frames: Buffer[]): Buffer {
  return Buffer.concat(frames);
}
