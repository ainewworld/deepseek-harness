/**
 * Voice-input recorder: one getUserMedia session captured to 16 kHz 16-bit
 * mono PCM WAV and base64-encoded for the asr domain. ScriptProcessorNode is
 * deprecated but deliberately chosen: an AudioWorklet needs a separate module
 * URL the client-plugin bundler would have to emit, and the capture (one
 * channel, one setting, minutes at most) sits far inside its guarantees.
 */

/** Cap on one recording: the asr byte ceiling is far above this; user safety is the point. */
const MAX_RECORDING_MS = 120_000

/** Live recording handle; exactly one exists per mic session. */
export interface VoiceRecording {
  /** Stop capture, tear down the stream, and produce the WAV payload. */
  stop(): Promise<{ ok: true; mediaType: 'audio/wav'; data: string } | { ok: false; reason: 'empty' | 'error'; message?: string }>
  /** Hard-teardown without producing audio (component unmount). */
  abort(): void
}

/** The stop() product: WAV payload or a soft failure reason. */
export type VoiceClip = Awaited<ReturnType<VoiceRecording['stop']>>

/**
 * Start recording from the default microphone.
 * @returns the recording handle; rejects only on permission/driver denial or
 * when the browser lacks the capture APIs (callers translate to copy).
 */
export async function startVoiceRecording(): Promise<VoiceRecording> {
  if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
    throw new Error('unsupported')
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  })
  // The explicit rate avoids resampling on the server; Chrome honors it for
  // capture contexts regardless of hardware rate.
  const AudioContextCtor = window.AudioContext
  const context = new AudioContextCtor({ sampleRate: 16000 })
  const source = context.createMediaStreamSource(stream)
  // bufferSize 4096 (~256 ms at 16 kHz) keeps per-callback work trivial.
  const processor = context.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  let totalSamples = 0
  let stopped = false
  processor.onaudioprocess = (event) => {
    if (stopped) return
    // Copy: the underlying buffer is reused across callbacks.
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
    totalSamples += 4096
  }
  source.connect(processor)
  // A destination is required for the graph to run in some engines; the
  // recorder's own output stays silent (never connected to speakers).
  const mute = context.createGain()
  mute.gain.value = 0
  processor.connect(mute)
  mute.connect(context.destination)
  const autoStop = setTimeout(() => { void finish() }, MAX_RECORDING_MS)

  const teardown = (): void => {
    if (stopped) return
    stopped = true
    clearTimeout(autoStop)
    processor.onaudioprocess = null
    processor.disconnect()
    mute.disconnect()
    source.disconnect()
    void context.close()
    for (const track of stream.getTracks()) track.stop()
  }

  async function finish(): Promise<VoiceClip> {
    teardown()
    if (totalSamples === 0) return { ok: false, reason: 'empty' as const }
    const wav = encodeWav(chunks, totalSamples, 16000)
    return { ok: true, mediaType: 'audio/wav', data: arrayBufferToBase64(wav) }
  }

  return {
    stop: finish,
    abort: teardown,
  }
}

/** Interleave nothing (mono): concatenate chunks into one 16-bit PCM WAV file. */
function encodeWav(chunks: readonly Float32Array[], totalSamples: number, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + totalSamples * 2)
  const view = new DataView(buffer)
  const writeString = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + totalSamples * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, totalSamples * 2, true)
  let offset = 44
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      // Clamp: Float32 mic data is within [-1, 1], but echo cancellation
      // overshoot exists; wrap would turn it into loud noise.
      const sample = Math.max(-1, Math.min(1, chunk[i] as number))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return buffer
}

/** Base64 of an ArrayBuffer without blowing the call stack on large inputs. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const STEP = 0x8000
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STEP))
  }
  return btoa(binary)
}
