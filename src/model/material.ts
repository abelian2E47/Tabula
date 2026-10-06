import { PERFORMANCE, type Performance } from './types'

/**
 * What a material is worth, worked out once and written as custom properties.
 *
 * A material is a shape and an amount. The shape — where the sheen falls, what
 * colour the cut is, which way the light comes — belongs to the stylesheet,
 * because it is the same on every sheet that asks for that material. The amount
 * does not: it is arithmetic over two settings that are not independent of each
 * other, and a stylesheet holding both would need a `calc` per property in every
 * rule that spends them.
 *
 * So the amounts are computed here, as numbers, and the stylesheet reads them as
 * variables. That the arithmetic lives in the model rather than in the board is
 * what lets one tile answer for its own sheet: the board writes one set per layer
 * on the root element and a tile that was given a strength of its own writes the
 * same set over itself, and every rule beneath it reads whichever one it is under.
 *
 * ## Why there are two sets
 *
 * A tile is two layers, and each is made of something: the background the tile
 * itself is cut from, and the icon standing on it. They are different surfaces —
 * one is the size of the opening, the other the size of a chip; one is looked at
 * for its colour, the other for its edge and its gloss — and the same amount of
 * frost across a hundred pixels and across twenty is not the same amount of
 * frost. So each layer is asked its own two questions and gets its own set of
 * names: `--bg-*` for the background sheet and `--mark-*` for the icon sheet.
 *
 * The one difference written into the arithmetic is the chip's share of the
 * blur: a sheet the size of a mark wants a milder diffusion than a sheet the size
 * of a tile, because the same call across forty pixels is not glass, it is a
 * smudge. Everything else is the same question asked twice.
 *
 * Each amount has a floor that is not nought, and the floor is the point: at the
 * lowest setting these are still faintly the material that was asked for, because
 * somebody who chose glass and got a card would be a bug wearing a setting's
 * clothes. The ceiling is where the material stops being itself — past about
 * ninety per cent of ground glass there is nothing left to see through it and it
 * has become the card it was meant not to be.
 *
 * `transparency` is spent apart from `strength` and answers a different question:
 * how much of the material's own ground is in the sheet at all. Nought leaves the
 * sheet as the board always drew it; a hundred takes the ground out and leaves the
 * sheen, the diffusion and the edge, which is what a pane of clean glass is.
 */

/** Which of a tile's two layers a set of amounts belongs to. */
export type MaterialLayer = 'background' | 'mark'

/** The prefix every variable of a layer is written under. */
const PREFIX: Record<MaterialLayer, string> = { background: '--bg', mark: '--mark' }

export function materialVars(
  strength: number,
  transparency: number,
  performance: Performance,
  layer: MaterialLayer = 'mark',
): Record<string, string> {
  const fx = PERFORMANCE[performance].fx
  const share = clamp(strength / 100, 0, 1)
  const clear = 1 - clamp(transparency / 100, 0, 1)
  const ns = PREFIX[layer]

  // Ground glass, in two sizes: what dissolves a window into light is, across
  // forty pixels, a pane with nothing behind it at all, so a chip gets its own
  // milder measure. Both are cut by the performance stop.
  const frost = (blur: number) =>
    blur < 0.4 ? 'none' : `blur(${blur.toFixed(1)}px) saturate(1.16) brightness(1.04)`

  // Clear acrylic is graded rather than diffused — that is the whole difference
  // between it and ground glass — so its filter does not follow the strength and
  // costs nothing like a blur does. It deepens what is behind it; a saturation of
  // one and a half would not be a sheet, it would be a colour.
  //
  // Liquid glass is the third answer: clearer than ice and thicker than acrylic,
  // and the only one that bends the wall where the sheet meets it. The refraction
  // is a filter pass of its own, so it is the first thing a slow machine gives up —
  // what is left without it is still the material, read from its sheen and its cut.
  const refract = fx > 0.6 ? 'url(#lg-refract) ' : ''
  const budget = 0.6 + 0.4 * fx

  const vars: Record<string, string> = {
    /*
     * A card's own amount, which is the one that has no wall to show.
     *
     * The three glasses are mixed against transparent and let the wall into
     * themselves; a card cannot, because a card is the thing that stops the wall —
     * so what its amount buys is the difference between a card and a *sheet*: at
     * nothing it is a film, and at everything it is the opaque card with a cut
     * edge. It is the same question ("how much of this material is there") asked of
     * the one material whose answer is not a blur, and it is written the same way
     * so that a tile answers for it the same way.
     */
    [`${ns}-solid-mix`]: `${((62 + 38 * share) * clear).toFixed(1)}%`,
    [`${ns}-acrylic-mix`]: `${((5 + 22 * share) * clear).toFixed(1)}%`,
    [`${ns}-glass-mix`]: `${((18 + 42 * share) * clear).toFixed(1)}%`,
    [`${ns}-liquid-mix`]: `${((10 + 26 * share) * clear).toFixed(1)}%`,
    [`${ns}-acrylic-filter`]: 'saturate(1.14) brightness(1.02)',
    [`${ns}-frost-filter`]: frost((1.6 + 12.4 * share) * budget),
    [`${ns}-liquid-filter`]: `${refract}blur(${((5 + 15 * share) * budget).toFixed(1)}px) saturate(1.45) brightness(1.05)`,
    // The bed under a filled tile is a copy of the picture, magnified until it is
    // a colour. Its blur is not a material's — it is what keeps the copy from
    // reading as a second picture — so it has a floor well clear of nought and only
    // leans on the strength above it.
    [`${ns}-bed-blur`]: `${(8 + 10 * share).toFixed(1)}px`,
    /*
     * The glass edge, which is what carries a sheet on a pale wall.
     *
     * A sheet of clean glass on a white desk is a sheet of clean glass on a white
     * desk: there is nothing behind it to diffuse and nothing in front of it to
     * notice, and the material that reads beautifully over a photograph reads as
     * nothing at all. What carries it there is the thickness — and the thickness is
     * the one amount a pane has to be able to have less of without stopping being
     * glass, so it follows the strength: the shade the sheet holds along the edge
     * that turns away from the light, drawn from the strength and deliberately
     * soft. An inked line around a pane is a frame, and a frame is a mount, which
     * is the one thing a pane must not be mistaken for. See the material rules.
     */
    [`${ns}-sheet-shade`]: `${(0.06 + 0.14 * share).toFixed(3)}`,
  }

  // A chip wants its own, milder diffusion. Only the mark layer draws at chip
  // size, so only the mark layer is given the pair.
  if (layer === 'mark') {
    vars['--mark-frost-filter-mark'] = frost((0.6 + 3.6 * share) * budget)
    vars['--mark-liquid-filter-mark'] =
      `${refract}blur(${((2 + 6 * share) * budget).toFixed(1)}px) saturate(1.4) brightness(1.05)`
  }

  return vars
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}
