/**
 * asr domain contract: local speech-to-text for the composer's voice input.
 * The audio crosses the wire in exactly one direction — base64-encoded inside
 * `asr.transcribe` — and the recognized text is the only product. The engine
 * is host-local (whisper.cpp); no audio or transcript leaves the machine.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Asr-domain unary methods (the map key asr.transcribe of RpcMethodMap). */
export interface AsrApi {
  /**
   * Transcribe one audio clip. The payload carries canonical base64 audio
   * (16-bit PCM `audio/wav` at 16 kHz, the composer recorder's product);
   * malformed or oversized audio and an absent host engine are error results,
   * never throws.
   * @param request - the media type plus the base64 audio bytes.
   * @param signal - cancellation for the transcription subprocess.
   * @returns the recognized text (empty when the clip carries no speech).
   */
  transcribe(
    request: RpcRequest<{ mediaType: 'audio/wav'; data: string }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<{ text: string }>>
}
