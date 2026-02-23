import { realpath } from 'node:fs/promises'
import path from 'node:path'

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathTraversalError'
  }
}

/**
 * Resolve inputPath within root, verify containment, resolve symlinks, re-verify.
 * Returns the real (symlink-resolved) path.
 * Throws PathTraversalError on traversal. Lets fs errors (ENOENT etc.) propagate to caller.
 */
export async function resolveSecurePath(root: string, inputPath: string): Promise<string> {
  // Resolve symlinks in root itself — prevents false rejects when projectRoot path contains symlinks
  const normalizedRoot = await realpath(path.resolve(root))
  const resolved = path.resolve(normalizedRoot, inputPath)
  const rootPrefix = normalizedRoot + path.sep
  if (!resolved.startsWith(rootPrefix)) {
    throw new PathTraversalError('Path must be within the project root')
  }
  const real = await realpath(resolved)
  if (!real.startsWith(rootPrefix)) {
    throw new PathTraversalError('Path escapes project root via symlink')
  }
  return real
}
