/**
 * Geometry for the board.
 *
 * An opening is a square tile plus the room around it: `gapX` to the next
 * column, and `gapY` to the next row, where `gapY` also carries the strip a
 * plate's name is printed in. A plate is not a painted cell — it is one object
 * `w` tiles wide and `h` tiles tall, spanning the gaps between them, so a 2x2
 * image is a single picture rather than four tiles that happen to touch.
 *
 * Every position is worked out in openings and only becomes pixels at the
 * moment something is drawn.
 */

import { isLaunchable, LAUNCH_KEYS, type Plate } from '../model/types'

export interface Field {
  cols: number
  rows: number
  /** Side of one square opening, in px. */
  tile: number
  gapX: number
  /** Row pitch minus the tile: the row gap plus the name strip. */
  gapY: number
  /** Height of the strip a name is printed in. */
  labelStrip: number
  /** Size of the whole field, names on the last row included. */
  width: number
  height: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

const MIN_TILE = 44

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * Openings stay square so an icon looks the same whatever shape the window is.
 * The gaps are derived from the tile, which needs the tile first — hence two
 * passes. The second pass is what makes the last row's names fit.
 */
export function computeField(availableWidth: number, availableHeight: number, cols: number, rows: number): Field {
  let tile = MIN_TILE
  let gapX = 12
  let gapY = 32
  let labelStrip = 20

  for (let pass = 0; pass < 2; pass += 1) {
    gapX = clamp(Math.round(tile * 0.14), 8, 26)
    labelStrip = clamp(Math.round(tile * 0.18), 18, 28)
    // The name strip is part of the row pitch, so it is subtracted once for
    // the whole field rather than once per row.
    gapY = gapX + labelStrip
    const byWidth = (availableWidth - gapX * (cols - 1)) / cols
    const byHeight = (availableHeight - labelStrip - gapY * (rows - 1)) / rows
    tile = Math.max(MIN_TILE, Math.floor(Math.min(byWidth, byHeight)))
  }

  return {
    cols,
    rows,
    tile,
    gapX,
    gapY,
    labelStrip,
    width: cols * tile + (cols - 1) * gapX,
    height: rows * tile + (rows - 1) * gapY + labelStrip,
  }
}

export function boxToPx(field: Field, box: Box): Rect {
  return {
    left: box.x * (field.tile + field.gapX),
    top: box.y * (field.tile + field.gapY),
    width: box.w * field.tile + (box.w - 1) * field.gapX,
    height: box.h * field.tile + (box.h - 1) * field.gapY,
  }
}

/** Nearest opening to a pixel offset inside the field. */
export function pointToBox(field: Field, px: number, py: number): { x: number; y: number } {
  return {
    x: clamp(Math.round(px / (field.tile + field.gapX)), 0, Math.max(0, field.cols - 1)),
    y: clamp(Math.round(py / (field.tile + field.gapY)), 0, Math.max(0, field.rows - 1)),
  }
}

/**
 * Where a plate lands when it is let go.
 *
 * There is no sticky target during the drag any more: the plate is drawn where
 * the pointer is and the cell only matters at the moment of release, so the
 * opening is the nearest one, with no bias towards wherever it started. The
 * bias was there to stop a landing preview from flickering between two cells;
 * with nothing drawn to flicker it only made the drop disagree with the hand.
 */

function platesOf(plates: Plate[], pageId: string, ignoreId?: string): Plate[] {
  // A plate inside a folder is not on the grid, and neither is one that has
  // been taken off it. Both are absent from the board, so neither takes room,
  // and nothing dropped where they are counts as landing on them. A bar that
  // was put away used to keep reserving its cells, which is why a bar dropped
  // beside it had nowhere to land and came back.
  return plates.filter(
    (plate) => plate.pageId === pageId && !plate.folderId && !plate.hidden && plate.id !== ignoreId,
  )
}

export function isFree(
  plates: Plate[],
  pageId: string,
  box: Box,
  bounds: { cols: number; rows: number },
  ignoreId?: string,
): boolean {
  if (box.x < 0 || box.y < 0 || box.x + box.w > bounds.cols || box.y + box.h > bounds.rows) return false
  return !platesOf(plates, pageId, ignoreId).some(
    (plate) =>
      box.x < plate.x + plate.w && plate.x < box.x + box.w && box.y < plate.y + plate.h && plate.y < box.y + box.h,
  )
}

/**
 * The nearest opening this size can occupy, searched outward from where the
 * pointer asked for it. Growing rings keep the result predictable: a plate
 * lands at or beside where it was dropped, never somewhere surprising across
 * the board.
 */
export function findOpening(
  plates: Plate[],
  pageId: string,
  bounds: { cols: number; rows: number },
  w: number,
  h: number,
  preferX: number,
  preferY: number,
  ignoreId?: string,
): { x: number; y: number } | null {
  if (w > bounds.cols || h > bounds.rows) return null

  const originX = clamp(Math.round(preferX), 0, bounds.cols - w)
  const originY = clamp(Math.round(preferY), 0, bounds.rows - h)
  const maxRadius = Math.max(bounds.cols, bounds.rows)

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        // Only the edge of each ring, so radius 0 tries the drop point first
        // and each step outward follows.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
        const box = { x: originX + dx, y: originY + dy, w, h }
        if (box.x < 0 || box.y < 0 || box.x + w > bounds.cols || box.y + h > bounds.rows) continue
        if (isFree(plates, pageId, box, bounds, ignoreId)) return { x: box.x, y: box.y }
      }
    }
  }
  return null
}

/**
 * Launch keys are read off the board rather than stored: row-major from the
 * top left of the current page, so the keys always describe what is on screen.
 * Only plates that actually open something are counted, and the search plate is
 * never a target — it is reached with its own key instead.
 */
export function launchOrder(plates: Plate[], pageId: string): Plate[] {
  return plates
    // What a folder holds is opened from inside it, so it gets no key of its
    // own — a key that reaches something you cannot see reads as broken.
    .filter((plate) => plate.pageId === pageId && !plate.folderId && isLaunchable(plate))
    .slice()
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))
    .slice(0, LAUNCH_KEYS.length)
}

/** Plate id → the key that launches it, in the order `launchOrder` returns. */
export function keysFor(plates: Plate[], pageId: string): Map<string, string> {
  const map = new Map<string, string>()
  launchOrder(plates, pageId).forEach((plate, index) => {
    const key = LAUNCH_KEYS[index]
    if (key) map.set(plate.id, key)
  })
  return map
}
