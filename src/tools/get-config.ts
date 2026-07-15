import { readFile, stat } from 'node:fs/promises'
import { getErrnoCode } from '../utils/errors.js'
import { resolveSecurePath } from '../utils/path-security.js'
import { redactSecrets } from '../utils/redact.js'

// Checked in order — mirrors Cypress's own config resolution
const CONFIG_FILENAMES = [
  'cypress.config.ts',
  'cypress.config.js',
  'cypress.config.mjs',
  'cypress.config.cjs',
]

const MAX_CONFIG_SIZE_BYTES = 100_000 // 100 KB — config files are small; anything bigger is suspect

export interface CypressConfigFile {
  file: string
  content: string
}

export async function getConfig(projectRoot: string): Promise<CypressConfigFile> {
  for (const filename of CONFIG_FILENAMES) {
    // Security: containment check + symlink resolution (single source of truth)
    let real: string
    try {
      real = await resolveSecurePath(projectRoot, filename)
    } catch (err) {
      if (getErrnoCode(err) === 'ENOENT') continue // try next filename
      throw err
    }

    // Pre-read size check: prevent OOM from huge files before loading into memory
    const fileStat = await stat(real)
    if (fileStat.size > MAX_CONFIG_SIZE_BYTES) {
      return {
        file: filename,
        content: `/* File too large (${fileStat.size} bytes). Maximum: ${MAX_CONFIG_SIZE_BYTES} bytes. */`,
      }
    }

    let content: string
    try {
      content = await readFile(real, 'utf-8')
    } catch (err) {
      // Race: file deleted between resolve and read — try next filename
      if (getErrnoCode(err) === 'ENOENT') continue
      throw err
    }

    // Config files often inline credentials (env blocks, baseUrl with basic auth, API keys)
    return { file: filename, content: redactSecrets(content) }
  }

  throw new Error(`No Cypress config found in the project root. Looked for: ${CONFIG_FILENAMES.join(', ')}`)
}
