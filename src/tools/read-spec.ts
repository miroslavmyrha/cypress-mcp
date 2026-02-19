import { readFile } from 'node:fs/promises'
import path from 'node:path'

const MAX_FILE_SIZE_BYTES = 500_000 // 500 KB — prevent huge files from filling context

export async function readSpec(projectRoot: string, specPath: string): Promise<string> {
  // Security: prevent path traversal outside project root
  // L1: use + path.sep suffix to prevent prefix-confusion bypass (e.g. /proj-evil starts with /proj)
  const resolved = path.resolve(projectRoot, specPath)
  if (!resolved.startsWith(path.resolve(projectRoot) + path.sep)) {
    throw new Error(`Path traversal detected: ${specPath}`)
  }

  let content: string
  try {
    content = await readFile(resolved, 'utf-8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error(`Spec file not found: ${specPath}`)
    if (code === 'EACCES') throw new Error(`Permission denied reading: ${specPath}`)
    throw err
  }

  if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE_BYTES) {
    const truncated = content.slice(0, MAX_FILE_SIZE_BYTES)
    return `${truncated}\n\n/* ... file truncated at ${MAX_FILE_SIZE_BYTES} bytes ... */`
  }

  return content
}
