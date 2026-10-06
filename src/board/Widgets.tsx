/**
 * What a widget shows on its surface.
 *
 * A widget and a shortcut are the same object at different sizes, so a widget
 * prints a list instead of a mark. How many rows a widget shows is worked out
 * from how tall it actually is, not from a constant, so the same widget reads
 * correctly at 4x3 and at 4x2.
 */

import type { CSSProperties } from 'react'
import { useMemo } from 'react'
import { useBookmarks, useClock, useHistory } from '../lib/hooks'
import { hostOf, type BookmarkEntry, type HistoryEntry } from '../platform/data'
import { useT, useLocale } from '../i18n'
import { useStore } from '../model/store'
import { useTurn } from '../lib/hooks'
import { turnOf } from '../model/rotation'
import { sameWallpaper } from '../model/wallpaper'
import { TEXT_MAX_SIZE, TEXT_MIN_SIZE, type Plate, type TextSpec, type WidgetType } from '../model/types'

/** Every widget the board can hang, in the order they are offered. */
export const WIDGETS: readonly WidgetType[] = ['clock', 'bookmarks', 'history', 'text', 'wallpaper']

/** What a widget is called, wherever it has to be named. */
export const WIDGET_LABELS = {
  clock: 'widget.clock',
  bookmarks: 'widget.bookmarks',
  history: 'widget.history',
  text: 'widget.text',
  wallpaper: 'widget.wallpaper',
} as const satisfies Record<WidgetType, string>

/**
 * The wallpaper changed by hand: one button, and nothing written on it.
 *
 * It steps forwards through the shelf the user filled, one press per picture, and it
 * wraps round the end rather than stopping — the last one is followed by the first,
 * which is what a button that only goes one way has to do to be useful. Named or
 * numbered it would be a label with a button attached; what it says is what the wall
 * says, so it draws a mark and gets out of the way.
 *
 * Stepping by hand does not stop the turns: the next moment of the day still
 * arrives, which is the reading a person wants from a button that says "next" —
 * move it now, and carry on as arranged afterwards.
 */
export function WallpaperWidget() {
  const t = useT()
  const { settings, patchSettings } = useStore()
  const shelf = settings.wallpapers
  /*
   * Where in the shelf the board has got to.
   *
   * Two answers, because the shelf is used two ways: while it is taking turns the
   * clock says which one is hanging, and while it is not, the one hanging is the one
   * that was chosen — so it is found in the shelf and the press carries on from
   * there. Either way the press moves on from the picture in front of the reader
   * rather than from wherever the record was last written.
   */
  const turning = settings.wallRotation.mode !== 'off' && shelf.length > 1
  const chosen = shelf.findIndex((one) => sameWallpaper(one, settings.wallpaper))
  const showing = turning ? turnOf(settings.wallRotation, shelf.length, Date.now()) : Math.max(0, chosen)
  const next = () => {
    if (shelf.length < 2) return
    patchSettings({ wallpaper: shelf[(showing + 1) % shelf.length] })
  }

  return (
    <button
      type="button"
      className="wallpaper-switch"
      disabled={shelf.length < 2}
      onClick={next}
      aria-label={t('wallpaper.next')}
      title={t('wallpaper.next')}
    >
      <WidgetGlyph widget="wallpaper" />
    </button>
  )
}

export function ClockWidget() {
  const locale = useLocale()
  const now = useClock()
  const tag = locale === 'zh' ? 'zh-CN' : 'en-GB'

  const hm = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
  const sec = String(now.getSeconds()).padStart(2, '0')
  const date = new Intl.DateTimeFormat(tag, { month: 'short', day: '2-digit', weekday: 'short' }).format(now)

  return (
    <div className="clock">
      <span className="clock__hm">{hm}</span>
      <span className="clock__sec">{sec}</span>
      <span className="clock__date">{date}</span>
    </div>
  )
}

interface Row {
  id: string
  title: string
  url: string
  trailing?: string
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <div className="plate__rows">
      {rows.map((row) => (
        <div className="plate__row" key={row.id}>
          <Mark letter={letterOf(row.title, row.url)} />
          <span>{row.title || hostOf(row.url)}</span>
          {row.trailing ? <em>{row.trailing}</em> : null}
        </div>
      ))}
    </div>
  )
}

/**
 * Rows are marked with a letter rather than a favicon: one remote icon per row
 * would be dozens of requests for a list nobody reads icon by icon, and the
 * column of text stays aligned without them.
 */
function letterOf(title: string, url: string): string {
  const source = title.trim() || hostOf(url)
  return (source.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase()
}

function Mark({ letter }: { letter: string }) {
  return (
    <span className="plate__mark" aria-hidden="true">
      {letter}
    </span>
  )
}

export function BookmarkWidget({ capacity }: { capacity: number }) {
  const t = useT()
  const { groups, loading } = useBookmarks()

  const { rows, total } = useMemo(() => {
    const flat: BookmarkEntry[] = groups.flatMap((group) => group.items)
    return {
      rows: flat.slice(0, capacity).map((item) => ({ id: item.id, title: item.title, url: item.url })),
      total: flat.length,
    }
  }, [groups, capacity])

  return (
    <div className="plate__stack">
      <div className="plate__kicker">
        {t('widget.bookmarks')}
        <b>{loading ? '—' : total}</b>
      </div>
      <Rows rows={rows} />
    </div>
  )
}

export function HistoryWidget({ capacity }: { capacity: number }) {
  const t = useT()
  const { entries, loading } = useHistory(120)

  const rows: Row[] = entries.slice(0, capacity).map((entry: HistoryEntry) => ({
    id: entry.id,
    title: entry.title,
    url: entry.url,
    trailing: trailingFor(entry.lastVisitTime),
  }))

  return (
    <div className="plate__stack">
      <div className="plate__kicker">
        {t('widget.history')}
        <b>{loading ? '—' : entries.length}</b>
      </div>
      <Rows rows={rows} />
    </div>
  )
}

function trailingFor(time: number): string {
  if (!time) return ''
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/**
 * A widget drawn as one mark, the way a shortcut is drawn.
 *
 * Both marks are authored here rather than borrowed from a font or an emoji,
 * in the same stroke as the rest of the board's own drawing: a ribbon for the
 * things you kept, and a clock with its hand wound back for where you have
 * been. They are read at tile size across the room, so each is one idea — a
 * shape you know — rather than a picture of a feature.
 */
function WidgetGlyph({ widget }: { widget: WidgetType }) {
  if (widget === 'wallpaper') {
    return (
      <svg className="widget-glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* Two frames overlapping: a shelf of pictures, and the one in front of
            it is the one hanging. */}
        <rect x="3.4" y="6.6" width="13.2" height="12" rx="2.1" stroke="currentColor" strokeWidth="1.7" />
        <path d="M7.6 3.6h11a2.1 2.1 0 0 1 2.1 2.1v9.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.45" />
        <path d="M6.6 15.4l2.6-3.1 2.2 2.3 1.9-2 3 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
      </svg>
    )
  }
  if (widget === 'bookmarks') {
    return (
      <svg className="widget-glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {/* A second ribbon behind the first: keeping something is rarely keeping
            one thing, and the pair reads as a stack at any size. */}
        <path
          d="M15.6 5.3h2.5a.9.9 0 0 1 .9.9v12.1l-3.45-2.4-3.45 2.4V6.2a.9.9 0 0 1 .9-.9Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          opacity="0.4"
        />
        <path
          d="M5.4 5.3h8.1a.9.9 0 0 1 .9.9v12.1l-4.05-2.8-4.05 2.8V6.2a.9.9 0 0 1 .9-.9Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg className="widget-glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* The ring, open at the top right, and the head of the arrow that comes
          round into it: the hour running backwards, which is what a history is. */}
      <path d="M12 4.6A7.4 7.4 0 1 0 19.4 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M15.2 2.5 12 4.6l3.2 2.1"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 8.5v4.1l3.1 1.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * A greeting, or any other words worth having on the wall.
 *
 * It carries its own setting rather than inheriting the interface's, because
 * the whole point of putting words on a board is that they are not the
 * interface: the face, the size, the weight and the colour are the plate's own.
 *
 * The size is the one the person chose, unless the tile is too small to hold it
 * at that size — then it comes down to what fits. Words cut in half read as a
 * bug, while words a little smaller just read as words. Both dimensions are
 * counted, because a box is not one number: how wide a line runs decides how
 * many lines there are, and how many lines there are decides how tall each one
 * may be. It is never grown, so a 1x1 tile does not shout because its neighbour
 * is 4x3.
 */
export function TextWidget({ plate, width, height }: { plate: Plate; width: number; height: number }) {
  const t = useT()
  /*
   * Which set of words this one is saying.
   *
   * A greeting may hold several paragraphs and take its turns between them — the
   * same rule the wall and a shelf of pictures use, because it is the same
   * question. A greeting with one paragraph, which is most of them, has no rule
   * and no list, and says the one thing it was given.
   */
  const paragraphs = plate.textVariants ?? []
  const paragraph = paragraphs.length ? paragraphs[useTurn(plate.rotation, paragraphs.length)] : undefined
  const spec: TextSpec = paragraph ?? plate.text ?? { body: '' }
  const words = spec.body.trim() ? spec.body : t('text.empty')
  const chosen = clamp(spec.size ?? 32, TEXT_MIN_SIZE, TEXT_MAX_SIZE)

  // An average glyph is a little over half an em wide. That is all this is: an
  // estimate of how the block would break, used only to come down from a size
  // that does not fit to one that does.
  const perLine = Math.max(1, Math.floor(width / (chosen * 0.62)))
  const lines = Math.max(1, Math.min(PER_LINE_CAP, Math.ceil(words.length / perLine)))
  const size = Math.round(clamp(Math.min(chosen, height / (lines * 1.32)), TEXT_MIN_SIZE, TEXT_MAX_SIZE))

  const style: CSSProperties = {
    fontSize: size,
    fontWeight: spec.weight ?? 600,
  }

  return (
    <p
      className="prose"
      style={style}
      data-font={spec.font ?? 'ui'}
      data-align={spec.align ?? 'left'}
      data-tint={spec.tint ?? 'auto'}
    >
      {words}
    </p>
  )
}

/** Past this many lines the text is trimmed rather than shrunk further. */
const PER_LINE_CAP = 6

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

export function WidgetBody({ plate, width, height }: { plate: Plate; width: number; height: number }) {
  // How many rows fit follows from the opening's own height, measured in
  // pixels rather than guessed from the span: the same widget has to read
  // correctly whether the grid is running at 44px openings or at 96.
  const ROW = 24
  const PADDING = 28
  const KICKER = 30
  const capacity = Math.max(1, Math.floor((height - PADDING - KICKER) / ROW))

  // A widget drawn as a mark does not read what is behind it: there is nothing
  // on the tile to fill, and fetching a page of history to draw a clock face
  // with an arrow on it is work nobody ever sees.
  if (plate.widgetStyle === 'icon' && (plate.widget === 'bookmarks' || plate.widget === 'history')) {
    return <WidgetGlyph widget={plate.widget} />
  }

  switch (plate.widget) {
    case 'clock':
      return <ClockWidget />
    case 'bookmarks':
      return <BookmarkWidget capacity={capacity} />
    case 'history':
      return <HistoryWidget capacity={capacity} />
    case 'text':
      return <TextWidget plate={plate} width={width} height={height} />
    case 'wallpaper':
      return <WallpaperWidget />
    default:
      return null
  }
}
