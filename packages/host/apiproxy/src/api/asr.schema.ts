/**
 * asr domain zod schemas (names derived from map keys:
 * asrTranscribeRequestSchema / asrTranscribeValueSchema). Only `audio/wav`
 * is accepted: the host engine consumes PCM WAV directly, and widening the
 * media type later means teaching it decoding first.
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** Hard audio ceiling: 30 s of 16 kHz 16-bit mono is ~1 MB; 25 MB is generous. */
export const ASR_MAX_AUDIO_BYTES = 25 * 1024 * 1024

/** asr.transcribe request payload. */
export const asrTranscribeRequestSchema = z.object({
  mediaType: z.literal('audio/wav'),
  // Length ceiling mirrors ASR_MAX_AUDIO_BYTES over the base64 alphabet (~4/3).
  data: z.string().min(1).max(Math.ceil(ASR_MAX_AUDIO_BYTES / 3) * 4),
}) satisfies z.ZodType<Wire<RequestPayload<'asr.transcribe'>>>

/** asr.transcribe response value. */
export const asrTranscribeValueSchema = z.object({
  text: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'asr.transcribe'>>>
