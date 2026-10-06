/**
 * Locally stored binary-ish payloads: uploaded wallpapers, uploaded images on
 * the board, and user-supplied icons.
 *
 * They live in the same key/value area as the board and are addressed by an
 * opaque key, so a plate stores `imageKey` and knows nothing about data URLs
 * or about how big the picture is.
 */

import { surface } from './browser'

const PREFIX = 'blob:'

export async function putBlob(key: string, dataUrl: string): Promise<void> {
  await surface.storage.set({ [PREFIX + key]: dataUrl })
}

export async function getBlob(key: string): Promise<string | null> {
  const all = await surface.storage.get()
  const value = all[PREFIX + key]
  return typeof value === 'string' ? value : null
}

export async function deleteBlob(key: string): Promise<void> {
  await surface.storage.remove([PREFIX + key])
}

/** Every stored blob key currently on this machine. */
export async function listBlobKeys(): Promise<string[]> {
  const all = await surface.storage.get()
  return Object.keys(all)
    .filter((key) => key.startsWith(PREFIX))
    .map((key) => key.slice(PREFIX.length))
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

/** The longest side a stored picture is allowed to keep, in pixels. A wall is
 *  the whole screen and a tile is a few hundred across, so this is past the
 *  point where more of them can be seen, and a 6000-pixel photograph is four
 *  times the work for a quarter of a screenful. */
const IMAGE_EDGE_MAX = 2560

/** And how much of a file we are willing to turn into a data URL at all. Base64
 *  is a third larger than the bytes it carries, and the areas this panel stores
 *  into quote a handful of megabytes between them. */
const IMAGE_BYTES_MAX = 1_200_000

/** What the re-encoded copy is written at. High enough that the difference is
 *  not the thing anyone notices; nothing is re-encoded that did not have to be. */
const IMAGE_QUALITY = 0.85

async function decodeImage(file: File): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    return await createImageBitmap(file)
  } catch {
    // A picture the codec will not open is read as it is and shown as whatever
    // the browser makes of it, which is more use than refusing the file.
    return null
  }
}

/**
 * A picked picture, in a form that can actually be stored.
 *
 * A photograph straight off a camera used to arrive as a data URL of its own
 * size, and the write was refused for being larger than the area it was written
 * into: the file was given a key, the key resolved to nothing, and the wallpaper
 * simply never appeared. So a picture too big to keep is scaled down to the
 * longest side the panel draws at and re-encoded — WebP first, which holds a
 * transparent background and lands far smaller than the PNG it came from, and
 * JPEG if the browser cannot write one. Anything that already fits is stored
 * byte for byte, and a drawing or an animation is never touched at all: an SVG
 * is smaller than any raster of it, and re-encoding a GIF throws away the only
 * reason to have picked one.
 */
export async function prepareImageFile(file: File): Promise<string> {
  const reencodable =
    file.type.startsWith('image/') && !file.type.includes('svg') && !file.type.includes('gif')
  if (!reencodable) return readFileAsDataUrl(file)

  const bitmap = await decodeImage(file)
  if (!bitmap) return readFileAsDataUrl(file)

  try {
    const longest = Math.max(bitmap.width, bitmap.height)
    if (longest <= IMAGE_EDGE_MAX && file.size <= IMAGE_BYTES_MAX) return await readFileAsDataUrl(file)

    const scale = Math.min(1, IMAGE_EDGE_MAX / longest)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return await readFileAsDataUrl(file)

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const webp = canvas.toDataURL('image/webp', IMAGE_QUALITY)
    const shrunken = webp.startsWith('data:image/webp')
      ? webp
      : canvas.toDataURL('image/jpeg', IMAGE_QUALITY)

    // A re-encode that came out larger than the file it replaced is a re-encode
    // to throw away: it is the same picture, at more bytes and less quality.
    const original = await readFileAsDataUrl(file)
    return shrunken.length < original.length ? shrunken : original
  } finally {
    bitmap.close()
  }
}

/** Short, stable, collision-free enough for one machine. */
export function newKey(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${random}`
}
