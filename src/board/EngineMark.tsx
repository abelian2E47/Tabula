/**
 * A search engine's mark.
 *
 * The marks are bundled paths rather than image files, so a bar shows its
 * engine with no request at all and keeps showing it offline. Every mark is
 * drawn in `currentColor`: the brand colour is carried alongside the geometry
 * purely to tint the medallion around it, because a brand colour is only safe
 * as ink on the background it was designed against, and a tile can be any
 * colour the user has chosen.
 */

import { ENGINE_MARKS, type EngineMark as Mark } from '../assets/engines'
import type { SearchEngine } from '../model/types'

/** Drawn when an engine has no mark of its own, which is the case for one the
 *  user added by hand. A magnifier stands for "an engine" without pretending
 *  to be a brand. */
const GENERIC: Mark = {
  brand: 'currentColor',
  paths: [
    {
      d: 'M10.5 3a7.5 7.5 0 0 0-5.3 12.8A7.5 7.5 0 0 0 15.05 16.46l4.75 4.74 1.4-1.41-4.74-4.74A7.5 7.5 0 0 0 10.5 3Zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z',
    },
  ],
}

/** The bundled mark an engine should be drawn with, or null for the generic one. */
export function markFor(engine: Pick<SearchEngine, 'id' | 'icon'>): keyof typeof ENGINE_MARKS | null {
  for (const candidate of [engine.icon, engine.id]) {
    if (candidate && candidate in ENGINE_MARKS) return candidate
  }
  return null
}

/** The brand colour to tint an engine's medallion with. */
export function brandOf(engine: Pick<SearchEngine, 'id' | 'icon'>): string {
  const key = markFor(engine)
  return key ? ENGINE_MARKS[key].brand : 'currentColor'
}

export function EngineMark({
  engine,
  className,
}: {
  engine: Pick<SearchEngine, 'id' | 'icon'>
  className?: string
}) {
  const key = markFor(engine)
  const mark: Mark = key ? ENGINE_MARKS[key] : GENERIC

  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <g transform={mark.transform}>
        {mark.paths.map((path, index) => (
          <path key={index} d={path.d} fillRule={path.rule} />
        ))}
      </g>
    </svg>
  )
}
