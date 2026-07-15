import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { MAX_SCREENSHOT_EMBED_BYTES } from '../utils/constants.js'
import { getErrnoCode } from '../utils/errors.js'
import { resolveSecurePath } from '../utils/path-security.js'

export interface ScreenshotImage {
  /** Base64-encoded file content, ready for an MCP image content block */
  data: string
  mimeType: 'image/png' | 'image/jpeg'
}

export interface ScreenshotInfo {
  path: string
  exists: boolean
  sizeBytes: number | null
  /** Inline image payload when the file exists and is within MAX_SCREENSHOT_EMBED_BYTES */
  image: ScreenshotImage | null
  note?: string
}

const MIME_BY_EXTENSION: Record<string, ScreenshotImage['mimeType']> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

// H5: projectRoot is required — screenshots must be within the project
export async function getScreenshot(projectRoot: string, screenshotPath: string): Promise<ScreenshotInfo> {
  // Security: only allow known image file extensions
  const resolved = path.resolve(projectRoot, screenshotPath)
  const ext = path.extname(resolved).toLowerCase()
  const mimeType = MIME_BY_EXTENSION[ext]
  if (mimeType === undefined) {
    throw new Error(`File extension not allowed. Only image files are permitted: ${Object.keys(MIME_BY_EXTENSION).join(', ')}`)
  }

  // Security: containment check + symlink resolution (single source of truth)
  // Use the real (symlink-resolved) path for stat to close TOCTOU window
  let statPath = resolved
  try {
    statPath = await resolveSecurePath(projectRoot, screenshotPath)
  } catch (err) {
    if (getErrnoCode(err) === 'ENOENT') {
      // File doesn't exist — resolveSecurePath couldn't realpath it.
      // Still enforce containment on the resolved path to prevent traversal
      // (e.g. if Zod schema is relaxed in the future, this remains a hard boundary).
      const normalizedRoot = path.resolve(projectRoot)
      if (!resolved.startsWith(normalizedRoot + path.sep)) {
        throw new Error('Path must be within the project root')
      }
      // fall through to stat below — will return exists: false
    } else {
      throw err
    }
  }

  let sizeBytes: number
  try {
    const stats = await stat(statPath)
    sizeBytes = stats.size
  } catch (err) {
    if (getErrnoCode(err) === 'ENOENT') {
      return { path: screenshotPath, exists: false, sizeBytes: null, image: null }
    }
    throw err
  }

  if (sizeBytes > MAX_SCREENSHOT_EMBED_BYTES) {
    return {
      path: screenshotPath,
      exists: true,
      sizeBytes,
      image: null,
      note: `Screenshot exceeds ${MAX_SCREENSHOT_EMBED_BYTES} bytes and is not embedded. View it directly at the path above.`,
    }
  }

  let data: Buffer
  try {
    data = await readFile(statPath)
  } catch (err) {
    // Race: file deleted between stat and read — report as missing
    if (getErrnoCode(err) === 'ENOENT') {
      return { path: screenshotPath, exists: false, sizeBytes: null, image: null }
    }
    throw err
  }

  return {
    path: screenshotPath,
    exists: true,
    sizeBytes,
    image: { data: data.toString('base64'), mimeType },
  }
}
