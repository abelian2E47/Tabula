import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { surface } from '../platform/browser'
import { getBlob, newKey, prepareImageFile, putBlob } from '../platform/blobs'
import type { BookmarkGroup, HistoryEntry } from '../platform/data'
import { linkIconSources } from '../platform/favicon'
import { defaultSettings } from '../model/defaults'
import { loadSaved } from '../model/persist'
import { nextTurnIn, turnOf } from '../model/rotation'
import type { Rotation, Settings } from '../model/types'

/** Ticks once a second so a clock with seconds does not lie. */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = globalThis.setInterval(() => setNow(new Date()), 1000)
    return () => globalThis.clearInterval(id)
  }, [])
  return now
}

/**
 * Which of a set of things is showing, and when to look again.
 *
 * The answer is worked out from the clock rather than kept, so the first render
 * already shows what the hour asks for: a board opened at eleven shows the eleven
 * o'clock wallpaper, not the one that was hanging when it was last closed. What the
 * timer is for is the moment the answer may change — an interval waits for its own
 * next step and a list of moments waits for the next one on the clock, so a board
 * left open all day goes on changing at the right times without a poll.
 *
 * Nothing is scheduled at all when the set is a single thing or the rule is off,
 * which is most boards: a timer that fires to answer "still the first one" is a
 * timer that costs a wake-up for nothing.
 */
export function useTurn(rotation: Rotation | undefined, count: number): number {
  const [now, setNow] = useState(() => Date.now())
  const running = Boolean(rotation && rotation.mode !== 'off' && count > 1)
  useEffect(() => {
    if (!running) return
    const wait = nextTurnIn(rotation, Date.now())
    if (wait === null) return
    const id = globalThis.setTimeout(() => setNow(Date.now()), Math.max(1000, wait))
    return () => globalThis.clearTimeout(id)
  }, [running, rotation, count, now])
  return turnOf(rotation, count, now)
}

/**
 * Whether the reader has asked their system for less movement.
 *
 * Read here rather than left to a media query in the stylesheet, because the
 * board also writes `--motion` from the performance setting and an inline style
 * on the root element beats a rule: a stylesheet that said `--motion: 0` would be
 * quietly overruled by a board that is drawing at full speed. It is watched
 * rather than sampled once, so the answer can change without a reload.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  useEffect(() => {
    const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

/**
 * The saved settings alone, for the standalone views. They are not the board
 * and must not mount its store: doing so would start the store's debounced
 * writer and rewrite the user's board from a page that only meant to read it.
 */
export function useLoadedSettings(): Settings {
  const [settings, setSettings] = useState<Settings>(() => defaultSettings())
  useEffect(() => {
    let cancelled = false
    void loadSaved().then((saved) => {
      if (!cancelled) setSettings(saved.settings)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return settings
}

export function useBookmarks(): { groups: BookmarkGroup[]; loading: boolean } {
  const [groups, setGroups] = useState<BookmarkGroup[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    void surface
      .bookmarks()
      .then((result) => {
        if (!cancelled) setGroups(result)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  return { groups, loading }
}

export function useHistory(limit: number): { entries: HistoryEntry[]; loading: boolean } {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    void surface
      .history(limit)
      .then((result) => {
        if (!cancelled) setEntries([...result].sort((a, b) => b.lastVisitTime - a.lastVisitTime))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [limit])
  return { entries, loading }
}

export interface Size {
  width: number
  height: number
}

/**
 * What a box is actually worth in pixels, measured rather than assumed.
 *
 * Returns a callback ref rather than a ref object on purpose. A ref object is
 * attached once, and if the element it points at is not in the tree on that
 * first commit — which is exactly what happens while the store is still
 * loading — the effect has already run and will not run again, leaving the
 * board measuring a size of zero forever. A callback ref fires whenever the
 * element actually appears.
 */
export function useMeasuredSize<T extends HTMLElement>(): [(node: T | null) => void, Size] {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const observer = useRef<ResizeObserver | null>(null)

  const attach = useCallback((node: T | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!node) return

    const measure = () => {
      const rect = node.getBoundingClientRect()
      setSize((current) =>
        Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
          ? current
          : { width: rect.width, height: rect.height },
      )
    }

    measure()
    const next = new ResizeObserver(measure)
    next.observe(node)
    observer.current = next
  }, [])

  useEffect(() => () => observer.current?.disconnect(), [])

  return [attach, size]
}

/**
 * Resolves either a stored key or a remote address to something an `<img>` can
 * use. Stored payloads are read once and cached in memory for the session: a
 * data URL of a large photograph is expensive to keep re-reading from disk on
 * every render.
 */
const blobCache = new Map<string, string>()

export function useImageSource(key?: string | null, remote?: string | null): string | null {
  const [resolved, setResolved] = useState<string | null>(() => (key ? blobCache.get(key) ?? null : remote ?? null))

  useEffect(() => {
    if (!key) {
      setResolved(remote ?? null)
      return
    }
    const cached = blobCache.get(key)
    if (cached) {
      setResolved(cached)
      return
    }
    let cancelled = false
    void getBlob(key).then((value) => {
      if (cancelled || !value) return
      blobCache.set(key, value)
      setResolved(value)
    })
    return () => {
      cancelled = true
    }
  }, [key, remote])

  return resolved
}

export interface MarkIcon {
  src: string | null
  onError(): void
}

/**
 * The address a mark draws from, and what it learns once the picture arrives.
 *
 * Two things live here rather than at each call site. A mark walks down the
 * list of services when one refuses a host, because they do not all answer for
 * the same sites. And the picture is given no size of its own: how big a mark is
 * is a number the user set, and a cap measured off the file used to overrule it
 * on every small icon.
 *
 * Takes the address rather than the plate: the list has to be built from values
 * that hold still between renders, or a mark that has already used its second
 * service would keep starting over.
 */
export function useMarkIcon(
  url: string | undefined,
  settings: Settings,
  stored: string | null,
  chosen?: string | null,
): MarkIcon {
  const sources = useMemo(() => linkIconSources(url, settings, stored, chosen), [url, settings, stored, chosen])
  const [attempt, setAttempt] = useState(0)
  // Keyed by the addresses themselves: a mark that has used up its second
  // service should start over when the plate, or the setting behind it, changes.
  const key = sources.join(' ')

  useEffect(() => {
    setAttempt(0)
  }, [key])

  const onError = useCallback(() => {
    setAttempt((current) => current + 1)
  }, [])

  return { src: sources[attempt] ?? null, onError }
}

/** Stores a picked file and returns the key it was filed under. */export function useStoreFile(): (file: File, prefix: string) => Promise<string | null> {
  return useCallback(async (file: File, prefix: string) => {
    // A picture too large to keep is brought down to size here rather than
    // stored and left to fail at the far end of the store.
    const dataUrl = await prepareImageFile(file)
    const key = newKey(prefix)
    await putBlob(key, dataUrl)
    blobCache.set(key, dataUrl)
    return key
  }, [])
}

/** Re-runs a callback when a pointer press lands outside the given element. */
export function useDismiss<T extends HTMLElement>(
  active: boolean,
  onDismiss: () => void,
): RefObject<T | null> {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    if (!active) return
    const onDown = (event: PointerEvent) => {
      const node = ref.current
      if (node && event.target instanceof Node && node.contains(event.target)) return
      onDismiss()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    // Capture phase: a plate's own pointerdown must not swallow the dismissal.
    globalThis.addEventListener('pointerdown', onDown, true)
    globalThis.addEventListener('keydown', onKey)
    return () => {
      globalThis.removeEventListener('pointerdown', onDown, true)
      globalThis.removeEventListener('keydown', onKey)
    }
  }, [active, onDismiss])
  return ref
}
