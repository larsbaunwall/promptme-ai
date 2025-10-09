/**
 * Audio Processor Worklet
 *
 * This worklet receives audio data from the main thread and forwards it as chunks.
 * It runs in a separate thread to avoid blocking the main UI.
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0]
    if (input.length > 0) {
      const channelData = input[0]
      if (channelData) {
        // Post a copy of the data to the main thread
        this.port.postMessage(channelData.slice(0))
      }
    }
    return true
  }
}

registerProcessor('audio-processor', AudioProcessor)
