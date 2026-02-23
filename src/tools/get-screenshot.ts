import { stat } from 'node:fs/promises'
import path from 'node:path'
import { getErrnoCode } from '../utils/errors.js'
import { resolveSecurePath } from '../utils/path-security.js'

export interface ScreenshotInfo {
  path: string
  exists: boolean
  sizeBytes: number | null
}

const ALLOWED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg']

// H5: projectRoot is required — screenshots must be within the project
export async function getScreenshot(projectRoot: string, screenshotPath: string): Promise<ScreenshotInfo> {
  // Security: only allow known image file extensions
  const resolved = path.resolve(path.resolve(projectRoot), screenshotPath)
  const ext = path.extname(resolved).toLowerCase()
  if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
    throw new Error(`File extension not allowed. Only image files are permitted: ${ALLOWED_IMAGE_EXTENSIONS.join(', ')}`)
  }

  // Security: containment check + symlink resolution (single source of truth)
  // Use the real (symlink-resolved) path for stat to close TOCTOU window
  let statPath = resolved
  try {
    statPath = await resolveSecurePath(projectRoot, screenshotPath)
  } catch (err) {
    // If file doesn't exist, realpath throws ENOENT — fall through to stat below
    if (getErrnoCode(err) !== 'ENOENT') {
      throw err
    }
  }

  try {
    const stats = await stat(statPath)
    return { path: screenshotPath, exists: true, sizeBytes: stats.size }
  } catch (err) {
    if (getErrnoCode(err) === 'ENOENT') {
      return { path: screenshotPath, exists: false, sizeBytes: null }
    }
    throw err
  }
}
