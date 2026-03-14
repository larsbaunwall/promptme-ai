/**
 * Teleprompter Speech Worker — v6
 *
 * Pipeline:
 *   1. AudioWorklet captures raw PCM @ 16kHz in 512-sample chunks
 *   2. Silero VAD gates speech (avoids wasting inference on silence)
 *   3. Moonshine Base ONNX transcribes speech segments
 *   4. Posts { type: 'transcript', text, isFinal } to main thread
 *
 * V6 Worker Optimizations:
 *   - MIN_SILENCE_MS reduced: 300ms (was 400ms) → flushes 100ms sooner
 *   - EAGER_PARTIAL_MS: emit partial transcript after 1.2s of speech
 *     even before end-of-utterance. Main thread can start matching immediately.
 *   - VAD fast path: zero-energy frames skip inference entirely
 *   - Inference chain: VAD runs in-chain, but transcription is serialized
 *     so concurrent calls don't stack
 */

import {
  AutoModel,
  Tensor,
  pipeline,
  env,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

// ── Config ──────────────────────────────────────────────────────────────────
const SAMPLE_RATE = 16000;

const SPEECH_THRESHOLD    = 0.30;
const EXIT_THRESHOLD      = 0.08;   // v6: lower exit → end speech segment faster
const MIN_SILENCE_MS      = 300;    // v6: was 400ms — 100ms savings per utterance
const MIN_SILENCE_SAMPLES = MIN_SILENCE_MS * (SAMPLE_RATE / 1000);
const MIN_SPEECH_SAMPLES  = 200 * (SAMPLE_RATE / 1000);  // v6: was 250ms
const SPEECH_PAD_SAMPLES  = 64 * (SAMPLE_RATE / 1000);   // v6: was 80ms
const MAX_BUFFER_DURATION = 30;
const NEW_BUFFER_SIZE     = 512;
const MAX_NUM_PREV_BUFFERS = Math.ceil(SPEECH_PAD_SAMPLES / NEW_BUFFER_SIZE);

// v6: Eager partial flush — after this many seconds of continuous speech,
// emit a partial transcript WITHOUT waiting for silence.
// This lets the main thread start matching 1-2 seconds early.
const EAGER_PARTIAL_MS    = 500;    // ms of continuous speech before partial emit (halved from 1000 to cut lag)
const EAGER_PARTIAL_SAMPLES = EAGER_PARTIAL_MS * (SAMPLE_RATE / 1000);
// Max partial emits per utterance (avoid spamming)
const MAX_PARTIAL_EMITS   = 8;

// ── Device detection ──────────────────────────────────────────────────────
async function supportsWebGPU() {
  if (!('gpu' in navigator)) return false;
  try { const a = await navigator.gpu.requestAdapter(); return a !== null; }
  catch { return false; }
}

const device = (await supportsWebGPU()) ? 'webgpu' : 'wasm';
self.postMessage({ type: 'info', message: `Device: ${device}` });
self.postMessage({ type: 'status', status: 'loading', message: 'Loading speech models…' });

// ── Load models ──────────────────────────────────────────────────────────
let silero_vad;
try {
  silero_vad = await AutoModel.from_pretrained('onnx-community/silero-vad', {
    config: { model_type: 'custom' }, dtype: 'fp32',
  });
} catch (err) {
  self.postMessage({ type: 'error', message: `Failed to load VAD: ${err.message}` });
  throw err;
}

const DTYPE_CONFIGS = {
  webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
  wasm:   { encoder_model: 'fp32', decoder_model_merged: 'q8' },
};

// ── TODO: Moonshine Streaming upgrade path ────────────────────────────────
// Moonshine v2 Streaming models exist (UsefulSensors/moonshine-streaming-tiny/small/medium)
// and offer dramatically better performance for live speech:
//
//   Model                    WER     p50 latency   params
//   moonshine-base (current) 10.07%  ~300–600ms    58M
//   moonshine-streaming-tiny 12.00%   34ms          34M
//   moonshine-streaming-small 7.84%   73ms         123M
//   moonshine-streaming-medium 6.65%  107ms        245M  ← better than Whisper Large v3
//
// The streaming architecture caches encoder hidden states incrementally as
// audio arrives, skipping redundant re-computation per chunk — giving sub-200ms
// response latency instead of the full-utterance batch latency we have today.
//
// BLOCKER: As of research (2025-07), NO Transformers.js-compatible ONNX export
// exists under onnx-community for any streaming variant. The only ONNX export
// available is a community conversion (Mazino0/moonshine-streaming-medium-onnx)
// which uses a 3-model raw ORT session design (encoder, decoder_init,
// decoder_with_past with 56 KV-cache tensors) that cannot be loaded via the
// Transformers.js pipeline() API.
//
// Substitution path (when onnx-community publishes a streaming ONNX):
//   1. Replace model ID below with e.g. 'onnx-community/moonshine-streaming-small-ONNX'
//   2. Update DTYPE_CONFIGS with the new model's quantisation options
//   3. Refactor flushAndTranscribe() to feed audio in overlapping chunks (e.g.
//      80ms stride) to the encoder incrementally, maintaining KV cache state,
//      instead of batching the full utterance. This removes the VAD buffer-
//      and-flush pattern in favour of a continuous streaming loop.
//   4. Update maybeEmitPartial() to emit after each encoder stride rather than
//      after EAGER_PARTIAL_SAMPLES of buffered audio.
//
// Watch: https://huggingface.co/onnx-community?search=moonshine-streaming
// ────────────────────────────────────────────────────────────────────────────

let transcriber;
try {
  transcriber = await pipeline(
    'automatic-speech-recognition',
    'onnx-community/moonshine-tiny-ONNX',
    {
      device, dtype: DTYPE_CONFIGS[device],
      progress_callback: (progress) => {
        if (progress.status === 'progress' && progress.total) {
          self.postMessage({ type: 'progress', percent: Math.round((progress.loaded / progress.total) * 100), file: progress.file });
        } else if (progress.status === 'done') {
          self.postMessage({ type: 'progress', percent: 100, file: progress.file });
        }
      },
    },
  );
} catch (err) {
  self.postMessage({ type: 'error', message: `Failed to load Moonshine: ${err.message}` });
  throw err;
}

// Warm up — compile shaders with a silent buffer
await transcriber(new Float32Array(SAMPLE_RATE));
self.postMessage({ type: 'status', status: 'ready', message: 'Ready' });

// ── Inference serialization ──────────────────────────────────────────────
let inferenceChain = Promise.resolve();

// ── Global audio buffer ──────────────────────────────────────────────────
const BUFFER = new Float32Array(MAX_BUFFER_DURATION * SAMPLE_RATE);
let bufferPointer = 0;

// ── VAD state ────────────────────────────────────────────────────────────
const sr      = new Tensor('int64', [SAMPLE_RATE], []);
let vadState  = new Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
let isRecording       = false;
let postSpeechSamples = 0;
let prevBuffers       = [];
let _prevBufLen       = 0;      // running sum of prevBuffers[*].length — avoids .reduce()
let partialEmitCount  = 0;      // # of partial emits for current utterance
let partialEmitLast   = 0;      // bufferPointer at last partial emit

/**
 * v6 VAD fast path: skip ONNX inference on zero/near-zero energy frames.
 * Energy below threshold → definitely not speech → skip silero call.
 */
const _INV_CHUNK_LEN = 1 / NEW_BUFFER_SIZE;  // precomputed reciprocal for frameEnergy

function frameEnergy(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return sum * _INV_CHUNK_LEN;  // multiply by reciprocal — avoids per-call division
}

const ENERGY_SILENCE_THRESHOLD = 1e-6; // below this → silent frame

async function vad(buffer) {
  // Fast path: silent frame
  if (!isRecording && frameEnergy(buffer) < ENERGY_SILENCE_THRESHOLD) {
    if (prevBuffers.length >= MAX_NUM_PREV_BUFFERS) _prevBufLen -= prevBuffers.shift().length;
    prevBuffers.push(buffer);
    _prevBufLen += buffer.length;
    return false;
  }

  const input = new Tensor('float32', buffer, [1, buffer.length]);
  const { stateN, output } = await (inferenceChain = inferenceChain.then(() =>
    silero_vad({ input, sr, state: vadState }),
  ));
  vadState = stateN;
  const isSpeech = output.data[0];
  return isSpeech > SPEECH_THRESHOLD || (isRecording && isSpeech >= EXIT_THRESHOLD);
}

/**
 * Final transcription of a complete utterance.
 */
async function transcribeFinal(buffer) {
  self.postMessage({ type: 'status', status: 'transcribing', message: 'Transcribing…' });
  const { text } = await (inferenceChain = inferenceChain.then(() => transcriber(buffer)));
  const cleaned = text.trim();
  if (cleaned) self.postMessage({ type: 'transcript', text: cleaned, isFinal: true });
  self.postMessage({ type: 'status', status: 'recording', message: 'Listening…' });
}

/**
 * v6 EAGER PARTIAL EMIT
 *
 * When we've accumulated EAGER_PARTIAL_SAMPLES of speech without a silence,
 * emit a partial transcript. This lets the main thread start matching NOW
 * rather than waiting for the speaker to pause.
 *
 * Partial transcripts are marked isFinal=false so the matcher uses them
 * with lower confidence and doesn't update the accumulation buffer.
 */
function maybeEmitPartial() {
  if (partialEmitCount >= MAX_PARTIAL_EMITS) return;
  const newSamples = bufferPointer - partialEmitLast;
  if (newSamples < EAGER_PARTIAL_SAMPLES) return;

  partialEmitLast = bufferPointer;
  partialEmitCount++;

  // Grab the buffer so far (shallow copy for async safety)
  const prevLen   = _prevBufLen;
  const segment   = new Float32Array(prevLen + bufferPointer);
  let off = 0;
  for (const b of prevBuffers) { segment.set(b, off); off += b.length; }
  segment.set(BUFFER.subarray(0, bufferPointer), off);

  // Fire partial transcription without blocking the main audio capture path
  inferenceChain = inferenceChain.then(async () => {
    try {
      const { text } = await transcriber(segment);
      const cleaned = text.trim();
      if (cleaned) {
        self.postMessage({ type: 'transcript', text: cleaned, isFinal: false });
      }
    } catch {
      // Partial transcription errors are non-fatal
    }
  });
}

function reset(offset = 0) {
  // Zero only the speech-pad region past offset — avoids clearing the full 1.92 MB buffer.
  // Prevents stale audio appearing in the next transcription's overread padding region.
  BUFFER.fill(0, offset, Math.min(offset + SPEECH_PAD_SAMPLES + NEW_BUFFER_SIZE, BUFFER.length));
  bufferPointer     = offset;
  isRecording       = false;
  postSpeechSamples = 0;
  partialEmitCount  = 0;
  partialEmitLast   = 0;
}

function flushAndTranscribe(overflow) {
  const prevLen = _prevBufLen;
  const segment = new Float32Array(prevLen + bufferPointer + SPEECH_PAD_SAMPLES);
  let off = 0;
  for (const b of prevBuffers) { segment.set(b, off); off += b.length; }
  segment.set(BUFFER.slice(0, bufferPointer + SPEECH_PAD_SAMPLES), off);

  transcribeFinal(segment);
  prevBuffers = [];
  _prevBufLen = 0;
  if (overflow) BUFFER.set(overflow, 0);
  reset(overflow?.length ?? 0);
}

// ── Main message handler ──────────────────────────────────────────────────
self.onmessage = async (event) => {
  const { buffer } = event.data;
  if (!buffer) return;

  const wasRecording = isRecording;
  const isSpeech     = await vad(buffer);

  // Not recording + not speech → handled inside vad() for energy fast path,
  // or store in ring buffer here for normal path
  if (!wasRecording && !isSpeech) {
    if (prevBuffers.length >= MAX_NUM_PREV_BUFFERS) _prevBufLen -= prevBuffers.shift().length;
    prevBuffers.push(buffer);
    _prevBufLen += buffer.length;
    return;
  }

  // Buffer accumulation
  const remaining = BUFFER.length - bufferPointer;
  if (buffer.length >= remaining) {
    BUFFER.set(buffer.subarray(0, remaining), bufferPointer);
    bufferPointer += remaining;
    flushAndTranscribe(buffer.subarray(remaining));
    return;
  } else {
    BUFFER.set(buffer, bufferPointer);
    bufferPointer += buffer.length;
  }

  if (isSpeech) {
    if (!isRecording) self.postMessage({ type: 'status', status: 'recording', message: 'Listening…' });
    isRecording = true;
    postSpeechSamples = 0;

    // v6: eager partial emit during long continuous speech
    maybeEmitPartial();
    return;
  }

  postSpeechSamples += buffer.length;
  if (postSpeechSamples < MIN_SILENCE_SAMPLES) return;
  if (bufferPointer < MIN_SPEECH_SAMPLES) { reset(); return; }

  flushAndTranscribe();
};
