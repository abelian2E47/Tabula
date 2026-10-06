/**
 * One standalone view: all of the bookmarks, or all of the history.
 *
 * These pages exist because a widget is a window, not a room. What the board
 * shows is a dozen rows; this is everything, with a filter and no ceiling.
 *
 * Deliberately not the board: no search plate, no shortcuts, no grid. The only
 * piece of the board that belongs here is the way back to it.
 *
 * Each source gets its own component rather than one with a conditional hook,
 * so the bookmarks page never asks the browser for history and vice versa.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useT, useLocale } from '../i18n'
import { useBookmarks, useHistory } from '../lib/hooks'
import { surface } from '../platform/browser'
import { hostOf, type BookmarkEntry } from '../platform/data'
import type { ViewName } from '../model/types'

interface Row {
  id: string
  title: string
  url: string
  /** Right-hand column: when it was last visited. */
  trailing?: string
  /** Dimmed text after the host: how many visits, and so on. */
  hint?: string
}

interface Group {
  id: string
  title: string
  rows: Row[]
}

/** The board caps history at a month; a page dedicated to it should not. */
const HISTORY_LIMIT = 2000

/**
 * `embedded` is the same view occupying a whole board page rather than a page
 * of its own. It is identical content: the only differences are that there is
 * nothing to go "back" to — the rail is right there — and that the document
 * title belongs to the board.
 */
export function Collection({
  source,
  embedded = false,
}: {
  source: Exclude<ViewName, 'board'>
  embedded?: boolean
}) {
  return source === 'bookmarks' ? <BookmarksView embedded={embedded} /> : <HistoryView embedded={embedded} />
}

/* ------------------------------------------------------------------ */
/* The two sources                                                     */
/* ------------------------------------------------------------------ */

function BookmarksView({ embedded }: { embedded: boolean }) {
  const { groups, loading } = useBookmarks()

  const rows = useMemo<Group[]>(
    () =>
      groups.map((group) => ({
        id: group.id,
        title: group.title,
        rows: group.items.map((item: BookmarkEntry) => ({
          id: item.id,
          title: item.title,
          url: item.url,
        })),
      })),
    [groups],
  )

  return (
    <Page headingKey="nav.bookmarks" emptyKey="view.emptyBookmarks" groups={rows} loading={loading} embedded={embedded} />
  )
}

function HistoryView({ embedded }: { embedded: boolean }) {
  const t = useT()
  const locale = useLocale()
  const { entries, loading } = useHistory(HISTORY_LIMIT)

  const rows = useMemo<Group[]>(() => {
    const tag = locale === 'zh' ? 'zh-CN' : 'en-GB'
    const clock = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit', hour12: false })
    const day = new Intl.DateTimeFormat(tag, { month: 'short', day: '2-digit', weekday: 'short' })

    const midnight = (value: number) => {
      const date = new Date(value)
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    }
    const today = midnight(Date.now())
    const yesterday = midnight(today - 1)

    // Grouped by the day it was visited rather than by hour: a day is the unit
    // people actually search their history in.
    const buckets = new Map<number, Row[]>()
    for (const entry of entries) {
      const key = midnight(entry.lastVisitTime)
      const bucket = buckets.get(key) ?? []
      bucket.push({
        id: entry.id,
        title: entry.title,
        url: entry.url,
        trailing: clock.format(entry.lastVisitTime),
        hint: entry.visitCount > 1 ? t('history.visits', { n: entry.visitCount }) : undefined,
      })
      buckets.set(key, bucket)
    }

    return [...buckets.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([key, bucket]) => ({
        id: String(key),
        title: key === today ? t('history.today') : key === yesterday ? t('history.yesterday') : day.format(key),
        rows: bucket,
      }))
  }, [entries, locale, t])

  return <Page headingKey="nav.history" emptyKey="view.emptyHistory" groups={rows} loading={loading} embedded={embedded} />
}

/* ------------------------------------------------------------------ */
/* The page itself                                                     */
/* ------------------------------------------------------------------ */

function Page({
  headingKey,
  emptyKey,
  groups,
  loading,
  embedded,
}: {
  headingKey: 'nav.bookmarks' | 'nav.history'
  emptyKey: 'view.emptyBookmarks' | 'view.emptyHistory'
  groups: Group[]
  loading: boolean
  embedded: boolean
}) {
  const t = useT()
  const [query, setQuery] = useState('')
  const filter = useRef<HTMLInputElement | null>(null)

  const heading = t(headingKey)
  useEffect(() => {
    if (embedded) return
    document.title = `${heading} · ${t('app.name')}`
  }, [heading, t, embedded])

  // `/` jumps to the filter and Escape leaves it: the two keys a list page is
  // expected to answer to, and neither exists on the board.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.tagName === 'INPUT' || event.target.isContentEditable)
      if (event.key === '/' && !typing) {
        event.preventDefault()
        filter.current?.focus()
      } else if (event.key === 'Escape' && typing) {
        setQuery('')
        filter.current?.blur()
      }
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [])

  const needle = query.trim().toLowerCase()
  const shown = useMemo(() => {
    if (!needle) return groups
    return groups
      .map((group) => ({
        ...group,
        rows: group.rows.filter(
          (row) => row.title.toLowerCase().includes(needle) || row.url.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.rows.length > 0)
  }, [groups, needle])

  const total = shown.reduce((sum, group) => sum + group.rows.length, 0)

  return (
    <div className={`view${embedded ? ' view--embedded' : ''}`}>
      <header className="view__head">
        <h1 className="view__title">{heading}</h1>
        {embedded ? null : <BackToBoard />}
      </header>

      <div className="view__filter">
        <svg className="view__glyph" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          ref={filter}
          className="view__input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('list.filterPlaceholder')}
          aria-label={t('list.filter')}
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className="view__slash">/</kbd>
      </div>

      {total > 0 ? <p className="view__count">{t('list.count', { n: total })}</p> : null}

      <main>{body()}</main>
    </div>
  )

  function body(): ReactNode {
    if (loading) return <p className="view__quiet">{t('view.reading')}</p>
    if (total === 0) return <p className="view__quiet">{needle ? t('list.noMatch') : t(emptyKey)}</p>

    return shown.map((group) => (
      <section className="group" key={group.id}>
        <h2 className="group__head">
          {group.title || t('list.ungrouped')}
          <span>{group.rows.length}</span>
        </h2>
        <ul className="group__rows">
          {group.rows.map((row) => (
            <li key={row.id}>
              <RowView row={row} />
            </li>
          ))}
        </ul>
      </section>
    ))
  }
}

function BackToBoard() {
  const t = useT()
  return (
    <button
      type="button"
      className="view__back"
      onClick={() => {
        // Leaving is a step back when there is somewhere to step back to, and
        // opening a board is the honest fallback when there is not.
        if (globalThis.history.length > 1) globalThis.history.back()
        else void surface.openView('board')
      }}
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M9.5 3.5 5 8l4.5 4.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {t('nav.backToBoard')}
    </button>
  )
}

function RowView({ row }: { row: Row }) {
  return (
    <button type="button" className="row" onClick={() => void surface.openUrl(row.url, false)}>
      <span className="row__mark" aria-hidden="true">
        {letterOf(row.title, row.url)}
      </span>
      <span className="row__text">
        <span className="row__title">{row.title || hostOf(row.url)}</span>
        <span className="row__host">
          {hostOf(row.url)}
          {row.hint ? <em> · {row.hint}</em> : null}
        </span>
      </span>
      {row.trailing ? <span className="row__trailing">{row.trailing}</span> : null}
    </button>
  )
}

function letterOf(title: string, url: string): string {
  const source = title.trim() || hostOf(url)
  return (source.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase()
}
