/**
 * Traditional→Simplified Chinese conversion for asr transcripts. whisper's
 * Chinese tokenizer frequently emits Traditional characters; the composer's
 * voice input should insert the same script the user types. Single-char
 * mapping only (OpenCC TSCharacters): phrase-level conversion is overkill
 * for chat input, where a missed variant word remains readable.
 */

import { T2S_PAIRS } from './t2s-table.ts'

const T2S: ReadonlyMap<string, string> = new Map(Array.from(
  { length: T2S_PAIRS.length / 2 },
  (_, index) => [T2S_PAIRS[index * 2] as string, T2S_PAIRS[index * 2 + 1] as string] as const,
))

/** Map one Traditional Chinese character to Simplified (identity when unmapped). */
function convertChar(char: string): string {
  return T2S.get(char) ?? char
}

/** Convert a whisper transcript's Traditional characters to Simplified. */
export function toSimplified(text: string): string {
  let out = ''
  for (const char of text) {
    out += convertChar(char)
  }
  return out
}
