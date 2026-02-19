import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const SPEC_PATTERN = /\.(cy|spec)\.(ts|js|tsx|jsx|mjs|cjs)$/
const RUN_SPEC_TIMEOUT_MS = 5 * 60 * 1_000
const SIGKILL_GRACE_MS = 5_000 // M2: grace period before SIGKILL after SIGTERM
// M10: cap stdout/stderr accumulation — Cypress can produce tens of MB over a 5-minute run.
// Trim to 2 KB only happens at output time, but the strings grow in memory during the entire run.
const MAX_OUTPUT_BUFFER = 100_000 // 100 KB — well above the 2 KB output cap, prevents multi-MB heap growth
// Use local cypress binary — more deterministic and secure than npx
const CYPRESS_BIN = path.join('node_modules', '.bin', 'cypress')

// M3: global concurrency limit — each Cypress run spawns a browser process (~300–800 MB RAM)
let activeRuns = 0
const MAX_CONCURRENT_RUNS = 1

export async function runSpec(projectRoot: string, specPath: string): Promise<string> {
  // M3: reject concurrent runs to prevent resource exhaustion
  if (activeRuns >= MAX_CONCURRENT_RUNS) {
    throw new Error('Another spec run is already in progress. Wait for it to complete first.')
  }
  activeRuns++
  try {
    return await _runSpec(projectRoot, specPath)
  } finally {
    activeRuns--
  }
}

async function _runSpec(projectRoot: string, specPath: string): Promise<string> {
  // Layer 1: reject absolute paths
  if (path.isAbsolute(specPath)) {
    throw new Error('spec must be a relative path (e.g. "cypress/e2e/login.cy.ts")')
  }

  // Layer 2: path traversal check — resolved path must stay within project root
  const resolved = path.resolve(projectRoot, specPath)
  if (!resolved.startsWith(projectRoot + path.sep)) {
    throw new Error('spec path must be within the project root')
  }

  // Layer 3: extension check — only accept recognised spec file extensions
  if (!SPEC_PATTERN.test(specPath)) {
    throw new Error(
      'spec must match *.cy.{ts,js,tsx,jsx,mjs,cjs} or *.spec.{ts,js,tsx,jsx,mjs,cjs}',
    )
  }

  // Layer 4: file must exist and must not be a symlink (L3: TOCTOU + symlink protection)
  try {
    const fileStat = await lstat(resolved)
    if (fileStat.isSymbolicLink()) {
      throw new Error('Spec path must not be a symbolic link.')
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error(`Spec file not found: ${specPath}`)
    throw err
  }

  const cypressBin = path.join(projectRoot, CYPRESS_BIN)
  const startMs = Date.now()

  return new Promise((resolve, reject) => {
    // shell: false is critical — prevents command injection via specPath
    // M4: pass minimal env — avoids leaking GITHUB_TOKEN, DATABASE_URL, AWS_* etc. to Cypress
    const child = spawn(cypressBin, ['run', '--spec', resolved], {
      shell: false,
      cwd: projectRoot,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        // Linux headless display (needed for Electron/Chrome in CI)
        ...(process.env['DISPLAY'] ? { DISPLAY: process.env['DISPLAY'] } : {}),
        ...(process.env['XAUTHORITY'] ? { XAUTHORITY: process.env['XAUTHORITY'] } : {}),
        ...(process.env['TMPDIR'] ? { TMPDIR: process.env['TMPDIR'] } : {}),
        // Safe CI signal — not a secret, Cypress uses it for run mode detection
        ...(process.env['CI'] ? { CI: process.env['CI'] } : {}),
      },
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length + stderr.length < MAX_OUTPUT_BUFFER) stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stdout.length + stderr.length < MAX_OUTPUT_BUFFER) stderr += chunk.toString()
    })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      // M2: SIGKILL fallback — Cypress/Electron may ignore SIGTERM
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // already dead — ignore
        }
      }, SIGKILL_GRACE_MS)
      reject(new Error(`run_spec timed out after ${RUN_SPEC_TIMEOUT_MS / 1_000}s`))
    }, RUN_SPEC_TIMEOUT_MS)

    child.on('error', (err) => {
      clearTimeout(timer)
      // L2: strip internal paths from error messages
      const message =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'Cypress binary not found. Run `npm install cypress` in the project.'
          : 'Failed to start Cypress process.'
      reject(new Error(message))
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      const durationMs = Date.now() - startMs
      const success = code === 0
      const result = {
        success,
        exitCode: code ?? -1,
        durationMs,
        // Surface first 2KB of output for quick diagnosis; full results via get_last_run
        output: (stdout + stderr).slice(0, 2_000) || null,
        message: 'Run complete. Call get_last_run to see full results.',
      }
      resolve(JSON.stringify(result, null, 2))
    })
  })
}
