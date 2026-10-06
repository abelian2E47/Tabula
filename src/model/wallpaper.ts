/**
 * What a wallpaper is, said in two ways the board needs: whether two of them are
 * the same picture, and what one is called in a list.
 *
 * A wallpaper is a small union — a blank wall, a preset, an address, a file the user
 * filed — and both of these questions come up wherever wallpapers are handled: the
 * board compares what the shelf says should be hanging against what is hanging, so
 * that it does not write a record on every render, and the drawer names each one on
 * the shelf. Both belong to the shape of a wallpaper rather than to either caller.
 */

import { FLAT_WALLPAPERS } from './defaults'
import type { Locale, Wallpaper } from './types'

export function sameWallpaper(one: Wallpaper, two: Wallpaper): boolean {
  if (one.kind !== two.kind) return false
  if (one.kind === 'flat' && two.kind === 'flat') return one.id === two.id
  if (one.kind === 'url' && two.kind === 'url') return one.url === two.url
  if (one.kind === 'upload' && two.kind === 'upload') return one.key === two.key
  return true
}

/**
 * What a wallpaper is called where it has to be named.
 *
 * A file is called what it was called, a preset by its own name, an address by the
 * site it points at — the host rather than the whole URL, because a shelf of six
 * chips reading `https://images.example.com/…/2048.jpg` is a shelf nobody can tell
 * apart.
 */
export function labelOfWallpaper(wallpaper: Wallpaper, locale: Locale): string {
  if (wallpaper.kind === 'upload') return wallpaper.name
  if (wallpaper.kind === 'flat') {
    return FLAT_WALLPAPERS.find((preset) => preset.id === wallpaper.id)?.label[locale] ?? wallpaper.id
  }
  if (wallpaper.kind === 'url') {
    try {
      return new URL(wallpaper.url, 'https://example.invalid').host || wallpaper.url
    } catch {
      return wallpaper.url
    }
  }
  return locale === 'zh' ? '空白' : 'Blank'
}
