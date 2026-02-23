import { glob } from 'glob'
import path from 'node:path'
import { DEFAULT_SPEC_PATTERNS, SPEC_EXTENSIONS } from '../utils/constants.js'
const IGNORE_PATTERNS = ['node_modules/**', 'dist/**', '.git/**']

export async function listSpecs(projectRoot: string, pattern?: string): Promise<string[]> {
  const patterns = pattern ? [pattern] : DEFAULT_SPEC_PATTERNS

  const matches = await glob(patterns, {
    cwd: projectRoot,
    ignore: IGNORE_PATTERNS,
    nodir: true,
    follow: false,
    nobrace: true, // defense-in-depth: schema blocks { but disable brace expansion at glob level too
  })

  // Security: filter to spec extensions only — prevents file enumeration via arbitrary glob patterns
  return matches
    .filter((p) => SPEC_EXTENSIONS.some((ext) => p.endsWith(ext)))
    .sort()
    .map((p) => path.normalize(p))
}
