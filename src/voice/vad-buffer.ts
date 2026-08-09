import { EventEmitter } from 'events';
import { pcmToWav, WavConversionOptions } from './pcm-to-wav.ts';
import pino from 'pino';

const logger = pino({ name: 'vad-buffer' });

export interface VadBufferOptions {
  /** Maximum utterance duration in ms before forcing a segment (default: 10000) */
  maxDurationMs?: number;
  /** Sample rate of the incoming audio (default: 16000) */
  sampleRate?: number;
  /** Number of channels (default: 1) */
  numChannels?: number;
}

export interface UtteranceSegment {
  /** WAV-encoded audio buffer ready for STT */
  wavBuffer: Buffer;
  /** Duration in milliseconds */
  durationMs: number;
  /** Start timestamp */
  startedAt: number;
}

/**
 * Buffers audio chunks during VAD=true and emits WAV segments on VAD=false.
 *
 * Usage:
 *   const buf = new VadBuffer();
 *   buf.on('utterance', (seg) => sendToSTT(seg.wavBuffer));
 *   session.events.onVad(({ status }) => buf.onVad(status === 'true' || status === true));
 *   session.events.onAudioChunk(({ arrayBuffer, sampleRate }) => {
 *     buf.addChunk(Buffer.from(arrayBuffer), sampleRate);
 *   });
 */
export class VadBuffer extends EventEmitter {
  private frames: Buffer[] = [];
  private speaking = false;
  private startedAt = 0;
  private maxDurationMs: number;
  private sampleRate: number;
  private numChannels: number;
  private safetyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: VadBufferOptions = {}) {
    super();
    this.maxDurationMs = options.maxDurationMs ?? 10000;
    this.sampleRate = options.sampleRate ?? 16000;
    this.numChannels = options.numChannels ?? 1;
  }

  /**
   * Update sample rate (e.g. from AudioChunk.sampleRate field).
   */
  setSampleRate(sampleRate: number): void {
    this.sampleRate = sampleRate;
  }

  /**
   * Called when a VAD event is received.
   * @param isSpeaking - true when speech starts, false when it ends
   */
  onVad(isSpeaking: boolean): void {
    if (isSpeaking && !this.speaking) {
      this.speaking = true;
      this.startedAt = Date.now();
      this.frames = [];
      logger.debug('VAD: speech started');
      this.startSafetyTimer();
    } else if (!isSpeaking && this.speaking) {
      this.speaking = false;
      logger.debug('VAD: speech ended');
      this.clearSafetyTimer();
      this.flushSegment();
    }
  }

  /**
   * Called with each raw audio chunk from MentraOS.
   * @param chunk - Raw PCM bytes (Int16, little-endian)
   * @param sampleRate - Optional sample rate from the chunk event
   */
  addChunk(chunk: Buffer, sampleRate?: number): void {
    if (sampleRate && sampleRate !== this.sampleRate) {
      this.sampleRate = sampleRate;
    }
    if (this.speaking) {
      this.frames.push(chunk);

      const durationMs = this.calculateDurationMs();
      if (durationMs >= this.maxDurationMs) {
        logger.warn({ durationMs }, 'VAD: max duration reached, forcing segment flush');
        this.clearSafetyTimer();
        this.flushSegment();
        // Stay in speaking mode — restart fresh buffer
        this.speaking = true;
        this.startedAt = Date.now();
        this.frames = [];
        this.startSafetyTimer();
      }
    }
  }

  /**
   * Flush any buffered audio as a segment (called on VAD end or timeout).
   */
  private flushSegment(): void {
    if (this.frames.length === 0) return;

    const pcmBuffer = Buffer.concat(this.frames);
    const wavOptions: WavConversionOptions = {
      sampleRate: this.sampleRate,
      numChannels: this.numChannels,
    };
    const wavBuffer = pcmToWav(pcmBuffer, wavOptions);
    const durationMs = Date.now() - this.startedAt;

    const segment: UtteranceSegment = {
      wavBuffer,
      durationMs,
      startedAt: this.startedAt,
    };

    this.frames = [];
    logger.debug({ durationMs, bytes: wavBuffer.length }, 'VAD: emitting utterance segment');
    this.emit('utterance', segment);
  }

  private calculateDurationMs(): number {
    const totalBytes = this.frames.reduce((s, f) => s + f.length, 0);
    const bytesPerSample = 2; // Int16
    const samplesPerChannel = totalBytes / bytesPerSample / this.numChannels;
    return (samplesPerChannel / this.sampleRate) * 1000;
  }

  private startSafetyTimer(): void {
    this.safetyTimer = setTimeout(() => {
      if (this.speaking) {
        logger.warn('VAD: safety timeout triggered, forcing segment flush');
        this.speaking = false;
        this.clearSafetyTimer();
        this.flushSegment();
      }
    }, this.maxDurationMs + 2000);
  }

  private clearSafetyTimer(): void {
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.clearSafetyTimer();
    this.removeAllListeners();
    this.frames = [];
    this.speaking = false;
  }
}
