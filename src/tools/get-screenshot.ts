import { stat } from 'node:fs/promises'
import path from 'node:path'

export interface ScreenshotInfo {
  path: string
  exists: boolean
  sizeBytes: number | null
}

// H5: projectRoot is required — screenshots must be within the project
export async function getScreenshot(projectRoot: string, screenshotPath: string): Promise<ScreenshotInfo> {
  // Security: restrict to paths within the project root to prevent filesystem oracle attacks
  const resolved = path.resolve(screenshotPath)
  if (!resolved.startsWith(path.resolve(projectRoot) + path.sep)) {
    throw new Error('Screenshot path must be within the project root')
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
