/**
 * Local whisper.cpp transcription engine (host-only). Spawns the whisper-cli
 * executable over one PCM WAV file and collects its no-timestamps stdout as
 * the transcript. Engine locations resolve, highest first: the explicit
 * `$DSH_ASR_WHISPER_BIN` / `$DSH_ASR_WHISPER_MODEL` overrides, then fixed
 * names under `$DSH_ASR_HOME` / `$DSH_HOME` / `~/.dsh` (subdirectory `asr`).
 * The deployment contract is documented in the web-app bundle notes: drop
 * whisper-cli.exe (plus its DLLs) and ggml-base-q5_1.bin into that directory.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Subprocess wall budget: cold model load on CPU plus a generous clip. */
const WHISPER_TIMEOUT_MS = 120_000

/** Resolved engine locations; `present` false means the deployment lacks them. */
export interface WhisperPaths {
  readonly present: boolean
  readonly bin: string
  readonly model: string
}

/** Resolve the whisper-cli executable and model paths for this host. */
export function resolveWhisperPaths(): WhisperPaths {
  const home = process.env.DSH_ASR_HOME ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const bin = process.env.DSH_ASR_WHISPER_BIN ?? join(home, 'asr', 'whisper-cli.exe')
  const model = process.env.DSH_ASR_WHISPER_MODEL ?? join(home, 'asr', 'ggml-base-q5_1.bin')
  return { present: existsSync(bin) && existsSync(model), bin, model }
}

/** Allocate a unique temp WAV path for one transcription. */
export function whisperTempWavPath(): string {
  return join(tmpdir(), `dsh-asr-${randomUUID()}.wav`)
}

/**
 * Run whisper-cli over one WAV file and collect the transcript.
 * @param paths - resolved engine locations (caller checked `present`).
 * @param wav - path to the PCM WAV file.
 * @param signal - cancellation; kills the subprocess.
 * @returns the transcript (whitespace-normalized; empty for silence).
 * @throws Error with the exit code or spawn failure message.
 */
export function transcribeWav(paths: WhisperPaths, wav: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      paths.bin,
      ['-m', paths.model, '-f', wav, '-l', 'auto', '-nt', '-np', '--no-gpu'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    )
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error: Error | undefined, text?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error !== undefined) reject(error)
      else resolve((text ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).join(''))
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error(`whisper-cli exceeded the ${WHISPER_TIMEOUT_MS} ms budget`))
    }, WHISPER_TIMEOUT_MS)
    const onAbort = (): void => {
      child.kill()
      finish(new Error('transcription was cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', error => finish(error))
    child.on('close', (code) => {
      if (code === 0) finish(undefined, stdout)
      else finish(new Error(`whisper-cli exited with code ${code}: ${stderr.trim().split(/\r?\n/).slice(-3).join(' ')}`))
    })
  })
}
