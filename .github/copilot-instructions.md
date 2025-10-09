# PromptMe AI Copilot Instructions

## Developer Expertise Requirements
**You are an expert Vue.js 3 developer with Composition API mastery and an expert TypeScript developer.** I expect the utmost quality, following Vue 3 best practices, proper TypeScript typing, and sophisticated architectural patterns.

## Project Overview
This is an AI-powered teleprompter built with Vue 3 + TypeScript that uses browser-based speech recognition to automatically and visually track speaker position and adjust scroll speed. All AI processing runs client-side using Xenova's whisper-web model.

## Architecture & Key Patterns

### Core Tech Stack
- **Frontend**: Vue 3 Composition API + TypeScript + Vite
- **AI Engine**: Xenova transformers (`@xenova/transformers`) - whisper-web only
- **Audio**: Web Audio API for capture, WASM/WebGPU for processing
- **No Server**: 100% client-side after initial model download

### Directory Structure Philosophy
```
src/
├── composables/        # Vue 3 composables (reactive business logic)
│   ├── useTeleprompter.ts    # Core teleprompter controls
│   └── ai/                   # AI-specific composables
├── services/           # Pure TypeScript services (no Vue)
│   ├── alignment/      # Text-to-speech alignment
│   ├── audio/          # Audio capture/processing
│   ├── pacing/         # Speed adjustment logic
│   └── speech/         # Whisper-web pipeline
├── components/         # Vue SFCs
└── types/ai/          # TypeScript interfaces for AI services
```

### Key Architectural Decisions

1. **Composables vs Services**: 
   - Composables (`use*`) contain Vue-reactive state and UI logic
   - Services are pure TypeScript classes for core algorithms
   - Example: `useSpeechTracking` (composable) orchestrates `SpeechActivityPipeline` (service)

2. **AI Pipeline Pattern**:
   ```typescript
   AudioCapture → SpeechActivityPipeline → AlignmentEngine → PacingController
   ```
   Each stage is a separate service with clear interfaces defined in `src/types/ai/`

3. **Worker Architecture**: 
   - Whisper model runs in `src/workers/whisper-web-worker.ts`
   - Main thread communicates via postMessage for speech detection + transcription

## Development Patterns

### Component Communication
```vue
<!-- Parent passes AI state down, children emit events up -->
<AIControls :is-active="aiEnabled" @toggle="toggleAI" />
<SpeechIndicator :current-position="currentWordIndex" :confidence="aiConfidence" />
```

### Text Processing Convention
- Use `[square brackets]` for emphasis markup → `<span class="emphasis">text</span>`
- Text normalization in `src/utils/textNormalization.ts` for alignment
- Always tokenize with `tokenizeText()` before alignment

### State Management Pattern
```typescript
// Composables manage reactive state
const { isPlaying, speed, fontSize } = useTeleprompter()
const { aiEnabled, currentWordIndex, confidence } = useSpeechTracking()

// Services handle pure logic
const alignmentEngine = new AlignmentEngine(config)
const result = alignmentEngine.addWord(word, timestamp)
```

### Error Handling Convention
- AI services emit error events: `{ type: 'error', error: Error }`
- Components display errors via reactive state
- Always handle WebAudio/WebGPU permission failures gracefully

## Development Commands

```bash
npm run dev          # Vite dev server with HMR
npm run build        # TypeScript check + build
npm run preview      # Preview production build
npm run type-check   # TypeScript validation only
```

## Key Integration Points

### AI Service Integration
1. **Audio Capture**: `useAudioCapture` → `AudioCapture` service
2. **Speech Pipeline**: `useSpeechEngine` → `SpeechActivityPipeline` + `WhisperWebService`
3. **Text Alignment**: `useAlignment` → `AlignmentEngine`
4. **Auto-pacing**: `usePacing` → `PacingController`

### Browser Compatibility
- Check `src/utils/browserCapabilities.ts` for WebGPU/WebAudio feature detection
- Fallback to WASM when WebGPU unavailable
- Handle microphone permissions in `AudioCapture.initialize()`

## Important Constraints

- **Single Model**: Only whisper-web is supported - no alternate ASR models
- **Client-side Only**: No server communication after model download
- **Privacy First**: All audio processing happens locally
- **Real-time**: Target <100ms latency for speech activity detection

## Common Tasks

### Adding New AI Features
1. Define interfaces in `src/types/ai/`
2. Create service class in appropriate `src/services/` subdirectory
3. Add composable wrapper in `src/composables/ai/`
4. Wire into `useSpeechTracking` orchestrator
5. Export from `src/composables/ai/index.ts`

### Text Processing Changes
- Modify `src/utils/textNormalization.ts` for alignment logic
- Update `AlignmentEngine` confidence scoring
- Test with various accent/pronunciation patterns

### Performance Optimization
- Audio buffer sizes in `AudioCapture` class
- Whisper model quantization in worker
- Alignment window sizes in `AlignmentEngine`

## Xenova Whisper-Web Model Management

### Critical Architecture Patterns
**Model Factory Pattern**: Uses singleton `PipelineFactory` to ensure only one whisper model instance exists:
```typescript
// Worker implements factory pattern from xenova/whisper-web
class AutomaticSpeechRecognitionPipelineFactory extends PipelineFactory {
  static task = "automatic-speech-recognition";
  static model = null;
  static quantized = null;
  static instance = null;
}
```

### Model Loading & Lifecycle
1. **Progressive Loading**: Models download with progress callbacks showing file-by-file loading
2. **Lazy Initialization**: Model loads only when first transcription starts
3. **Smart Invalidation**: Model reloads only when model name or quantization changes
4. **Memory Management**: Previous model instance disposed before loading new one

### Model Configuration Patterns
```typescript
// Available models with size information (quantized vs full)
const models = {
  'Xenova/whisper-tiny': [41, 152],      // [quantized MB, full MB]
  'Xenova/whisper-base': [77, 291],
  'Xenova/whisper-small': [249],         // Only full size available
  'Xenova/whisper-medium': [776],
  'distil-whisper/distil-medium.en': [402],  // English-only distilled
  'distil-whisper/distil-large-v2': [767]
};

// Model name transformation for non-multilingual
let modelName = model;
if (!isDistilWhisper && !multilingual) {
  modelName += ".en"  // Append .en for English-only models
}
```

### Whisper-Web Transcription Pipeline
```typescript
// Key transcription parameters based on xenova/whisper-web
const transcriptionConfig = {
  // Greedy decoding (deterministic)
  top_k: 0,
  do_sample: false,
  
  // Sliding window chunking
  chunk_length_s: isDistilWhisper ? 20 : 30,
  stride_length_s: isDistilWhisper ? 3 : 5,
  
  // Language and task
  language: language,
  task: subtask, // "transcribe" or "translate"
  
  // Streaming output
  return_timestamps: true,
  force_full_sequences: false,
  
  // Real-time callbacks
  callback_function: callback_function,  // After each token
  chunk_callback: chunk_callback         // After each audio chunk
};
```

### Audio Processing Requirements
- **Sample Rate**: Must be 16kHz (`Constants.SAMPLING_RATE = 16000`)
- **Channel Mixing**: Stereo → mono with `SCALING_FACTOR = Math.sqrt(2)`
- **Format**: Float32Array of audio samples
- **WebM Duration Fix**: Apply `webmFixDuration()` for MediaRecorder blobs

### Worker Communication Protocol
```typescript
// Main → Worker
webWorker.postMessage({
  audio: Float32Array,
  model: string,
  multilingual: boolean,
  quantized: boolean,
  subtask: 'transcribe' | 'translate',
  language: string | null
});

// Worker → Main (progress updates)
{ status: "initiate", file: string, name: string }      // Model file starts
{ status: "progress", file: string, progress: number }  // Loading progress
{ status: "ready" }                                     // Model loaded
{ status: "update", data: [text, chunks] }              // Partial results
{ status: "complete", data: { text, chunks } }          // Final result
{ status: "error", data: Error }                        // Error handling
```

### Browser Compatibility Considerations
- **WebGPU**: Preferred for performance, fallback to WASM
- **Firefox**: Requires `dom.workers.modules.enabled = true` in about:config
- **Safari M1/M2**: Known compatibility issues, recommend Chrome/Firefox/Edge
- **Mobile**: Auto-enable quantization, use smaller models