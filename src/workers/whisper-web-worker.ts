/* eslint-disable @typescript-eslint/no-explicit-any */

import { pipeline, env, type PipelineType } from '@xenova/transformers'

env.allowLocalModels = false
env.allowRemoteModels = true
env.useBrowserCache = true
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/'

interface WorkerConfig {
  model: string
  multilingual: boolean
  quantized: boolean
  subtask: 'transcribe' | 'translate'
  language: string | null
}

interface WorkerRequest {
  id: number
  audio: Float32Array
  config: WorkerConfig
}

interface PipelineInstance {
  processor: any
  model: any
  tokenizer: any
  dispose: () => void
}

class PipelineFactory {
  static task: PipelineType
  static model: string | null = null
  static quantized: boolean | null = null
  static instance: Promise<PipelineInstance> | null = null

  static async getInstance(progressCallback: ((data: any) => void) | null = null): Promise<any> {
    if (this.instance === null) {
      if (!this.model) {
        throw new Error('Whisper-web model not configured')
      }
      this.instance = pipeline(this.task, this.model, {
        quantized: this.quantized ?? true,
        progress_callback(data: any) {
          progressCallback?.(data)
        },
        revision: this.model.includes('/whisper-medium') ? 'no_attentions' : 'main',
      }) as Promise<PipelineInstance>
    }

    return this.instance
  }
}

class AutomaticSpeechRecognitionPipelineFactory extends PipelineFactory {
  static task: PipelineType = 'automatic-speech-recognition'
  static model: string | null = null
  static quantized: boolean | null = null
  static instance: Promise<PipelineInstance> | null = null
}

let modelReady = false

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data

  try {
    const transcript = await transcribe(
      message.id,
      message.audio,
      message.config
    )

    if (transcript === null) {
      return
    }

    self.postMessage({
      id: message.id,
      status: 'complete',
      task: 'automatic-speech-recognition',
      data: transcript,
    })
  } catch (error) {
    self.postMessage({
      id: message.id,
      status: 'error',
      data: error instanceof Error ? error : new Error(String(error)),
    })
  }
})

async function transcribe(id: number, audio: Float32Array, config: WorkerConfig) {
  const isDistilWhisper = config.model.startsWith('distil-whisper/')

  let modelName = config.model
  if (!isDistilWhisper && !config.multilingual) {
    modelName += '.en'
  }

  const factory = AutomaticSpeechRecognitionPipelineFactory
  if (factory.model !== modelName || factory.quantized !== config.quantized) {
    factory.model = modelName
    factory.quantized = config.quantized

    if (factory.instance !== null) {
      const current = await factory.getInstance()
      current.dispose?.()
      factory.instance = null
    }
  }

  const transcriber = await factory.getInstance((data: any) => {
    self.postMessage({
      id,
      status: data.status ?? 'progress',
      ...data,
    })
  })

  if (!modelReady) {
    modelReady = true
    self.postMessage({
      id,
      status: 'ready',
    })
  }

  const timePrecision =
    transcriber.processor.feature_extractor.config.chunk_length /
    transcriber.model.config.max_source_positions

  const chunksToProcess = [
    {
      tokens: [] as number[],
      finalised: false,
    },
  ]

  function chunkCallback(chunk: any) {
    const last = chunksToProcess[chunksToProcess.length - 1]
    Object.assign(last, chunk)
    last.finalised = true

    if (!chunk.is_last) {
      chunksToProcess.push({
        tokens: [],
        finalised: false,
      })
    }
  }

  function callbackFunction(item: any) {
    const last = chunksToProcess[chunksToProcess.length - 1]
    last.tokens = [...item[0].output_token_ids]

    const data = transcriber.tokenizer._decode_asr(chunksToProcess, {
      time_precision: timePrecision,
      return_timestamps: true,
      force_full_sequences: false,
    })

    self.postMessage({
      id,
      status: 'update',
      task: 'automatic-speech-recognition',
      data,
    })
  }

  const output = await transcriber(audio, {
    top_k: 0,
    do_sample: false,
    chunk_length_s: isDistilWhisper ? 20 : 30,
    stride_length_s: isDistilWhisper ? 3 : 5,
    language: config.language,
    task: config.subtask,
    return_timestamps: true,
    force_full_sequences: false,
    callback_function: callbackFunction,
    chunk_callback: chunkCallback,
  }).catch((error: any) => {
    self.postMessage({
      id,
      status: 'error',
      task: 'automatic-speech-recognition',
      data: error instanceof Error ? error : new Error(String(error)),
    })
    return null
  })

  return output
}
