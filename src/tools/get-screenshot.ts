import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'

export interface ScreenshotInfo {
  path: string
  exists: boolean
  sizeBytes: number | null
}

const ALLOWED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg']

// H5: projectRoot is required — screenshots must be within the project
export async function getScreenshot(projectRoot: string, screenshotPath: string): Promise<ScreenshotInfo> {
  // Security: restrict to paths within the project root to prevent filesystem oracle attacks
  const resolved = path.resolve(screenshotPath)
  const rootPrefix = path.resolve(projectRoot) + path.sep
  if (!resolved.startsWith(rootPrefix)) {
    throw new Error('Screenshot path must be within the project root')
  }

  // Security: only allow known image file extensions
  const ext = path.extname(resolved).toLowerCase()
  if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
    throw new Error(`File extension not allowed. Only image files are permitted: ${ALLOWED_IMAGE_EXTENSIONS.join(', ')}`)
  }

  // Security: resolve symlinks and re-check containment to prevent symlink escape
  try {
    const real = await realpath(resolved)
    if (!real.startsWith(rootPrefix)) {
      throw new Error('Screenshot path must be within the project root')
    }
  } catch (err) {
    // If file doesn't exist, realpath will throw ENOENT — fall through to stat below
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }

  try {
    const stats = await stat(resolved)
    return { path: screenshotPath, exists: true, sizeBytes: stats.size }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path: screenshotPath, exists: false, sizeBytes: null }
    }
    throw err
  }
}
