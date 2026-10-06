/**
 * The promise-shaped browser surface the board talks to.
 *
 * Firefox and Zen expose `browser.*` with promises already; Chromium exposes
 * `chrome.*` with callbacks. Plain `pnpm dev` in an ordinary tab exposes
 * neither, which is why there is a third backend: a mock backed by
 * `localStorage` that lets the whole interface run and be reviewed without
 * loading the extension at all.
 *
 * Only the four areas the board actually uses are modelled. Adding a method
 * here means implementing it three times, which is the point: the board never
 * learns which browser it is running in.
 */

import { mockBookmarks, mockHistory, type BookmarkGroup, type HistoryEntry } from './data'
import { VIEW_FILE, type ViewName } from '../model/types'

export interface KVArea {
  get(): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string[]): Promise<void>
}

export interface BrowserSurface {
  /** Where this surface came from, so the UI can say so honestly. */
  origin: 'firefox' | 'chromium' | 'mock'
  storage: KVArea
  bookmarks(): Promise<BookmarkGroup[]>
  history(limit: number): Promise<HistoryEntry[]>
  openUrl(url: string, inNewTab: boolean): Promise<void>
  /**
   * Hand the whole tab over to one of this extension's own pages. Only the
   * extension knows its own origin, so a view is never addressed by a bare
   * relative path in the board.
   */
  openView(name: ViewName): Promise<void>
}

/* ------------------------------------------------------------------ */
/* Real browsers                                                       */
/* ------------------------------------------------------------------ */

type AnyRecord = Record<string, unknown>
type Callback<T> = (result: T) => void

/*
 * `browser.storage.local` / `chrome.storage.local` is itself the *area* — the
 * object carrying get, set and remove. There is no further `.local` inside it.
 * The two browsers differ only in how that area reports back.
 */

/** A Chromium area answers through a callback. */
interface ChromeStorageArea {
  get(keys: string[] | null, cb: Callback<AnyRecord>): void
  set(items: AnyRecord, cb: () => void): void
  remove(keys: string[], cb: () => void): void
}

/** A Firefox area answers with a promise. */
interface FirefoxStorageArea {
  get(): Promise<AnyRecord>
  set(items: AnyRecord): Promise<void>
  remove(keys: string[]): Promise<void>
}

interface RealApi {
  storage?: { local?: unknown }
  bookmarks?: { getTree(): Promise<unknown> | void }
  history?: { search(q: { text: string; maxResults: number; startTime?: number }): Promise<unknown[]> | void }
  tabs?: { create(p: { url: string }): unknown; update(id: number, p: { url: string }): unknown }
  runtime?: { id?: string; getURL?(path: string): string }
}

/**
 * Whether what the browser handed us really is a storage area. Checked rather
 * than assumed: a wrong assumption here is a rejection on the board's very
 * first read, which presents as a blank page with nothing on it to explain why.
 */
function isStorageArea(value: unknown): boolean {
  return typeof value === 'object' && value !== null && typeof (value as { get?: unknown }).get === 'function'
}

/** Firefox's storage area is already promise-based. */
function firefoxStorage(area: FirefoxStorageArea): KVArea {
  return {
    get: () => area.get(),
    set: (items) => area.set(items),
    remove: (keys) => area.remove(keys),
  }
}

/** Chromium's is callback-based, so each call is wrapped in its own promise. */
function chromiumStorage(area: ChromeStorageArea): KVArea {
  return {
    get: () =>
      new Promise((resolve) => {
        area.get(null, (result) => resolve(result ?? {}))
      }),
    set: (items) =>
      new Promise((resolve) => {
        area.set(items, () => resolve())
      }),
    remove: (keys) =>
      new Promise((resolve) => {
        area.remove(keys, () => resolve())
      }),
  }
}

/**
 * Chromium resolves `chrome.bookmarks.getTree()` through a callback while
 * Firefox returns a promise from the same call, so the bridge has to accept
 * either shape rather than assume one.
 */
function callOrResolve<T>(invoke: (cb: Callback<T>) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      invoke((result) => resolve(result))
    } catch (error) {
      reject(error)
    }
  })
}

function isThenable(value: unknown): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value
}

function flattenBookmarks(tree: unknown): BookmarkGroup[] {
  // The tree arrives as an array holding one invisible root.
  const root = Array.isArray(tree) ? (tree[0] as Record<string, unknown>) : (tree as Record<string, unknown>)
  if (!root) return []

  const groups: BookmarkGroup[] = []

  const walk = (node: Record<string, unknown>, fallback: string): void => {
    const children = Array.isArray(node.children) ? (node.children as Array<Record<string, unknown>>) : []
    const leaves = children.filter((child) => typeof child.url === 'string')
    if (leaves.length > 0) {
      groups.push({
        id: String(node.id ?? fallback),
        title: typeof node.title === 'string' && node.title.trim() !== '' ? node.title : fallback,
        items: leaves.map((leaf) => ({
          id: String(leaf.id ?? ''),
          title: typeof leaf.title === 'string' ? leaf.title : '',
          url: String(leaf.url ?? ''),
          dateAdded: typeof leaf.dateAdded === 'number' ? leaf.dateAdded : undefined,
        })),
      })
    }
    for (const child of children) {
      if (!('url' in child)) walk(child, typeof child.title === 'string' ? child.title : fallback)
    }
    // A folder-less root: surface its own leaf children as one unnamed group.
    if (node === root && leaves.length > 0 && groups.length === 0) {
      groups.push({
        id: 'root',
        title: '',
        items: leaves.map((leaf) => ({
          id: String(leaf.id ?? ''),
          title: typeof leaf.title === 'string' ? leaf.title : '',
          url: String(leaf.url ?? ''),
        })),
      })
    }
  }

  walk(root, '')
  return groups
}

function realSurface(api: RealApi, origin: 'firefox' | 'chromium'): BrowserSurface {
  const area = api.storage?.local
  const isFirefoxShaped = origin === 'firefox'

  return {
    origin,
    // An area we do not recognise falls back to memory rather than throwing:
    // a board that runs but forgets is a far better failure than a blank one.
    storage: isStorageArea(area)
      ? isFirefoxShaped
        ? firefoxStorage(area as FirefoxStorageArea)
        : chromiumStorage(area as ChromeStorageArea)
      : memoryStorage(),

    async bookmarks() {
      const bookmarks = api.bookmarks
      if (!bookmarks) return []
      const result = bookmarks.getTree()
      const tree = isThenable(result) ? await result : await callOrResolve<unknown>((cb) => (result as unknown as (cb: Callback<unknown>) => void)(cb))
      return flattenBookmarks(tree)
    },

    async history(limit) {
      const history = api.history
      if (!history) return []
      const query = { text: '', maxResults: limit, startTime: Date.now() - 1000 * 60 * 60 * 24 * 30 }
      const result = history.search(query)
      const rows = isThenable(result) ? await result : await callOrResolve<unknown[]>((cb) => (result as unknown as (cb: Callback<unknown[]>) => void)(cb))
      return (rows as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id ?? ''),
        url: String(row.url ?? ''),
        title: typeof row.title === 'string' ? row.title : '',
        lastVisitTime: typeof row.lastVisitTime === 'number' ? row.lastVisitTime : 0,
        visitCount: typeof row.visitCount === 'number' ? row.visitCount : 1,
      }))
    },

    async openUrl(url, inNewTab) {
      if (inNewTab && api.tabs) {
        api.tabs.create({ url })
        return
      }
      globalThis.location?.assign(url)
    },

    async openView(name) {
      const file = VIEW_FILE[name]
      const url = api.runtime?.getURL ? api.runtime.getURL(file) : `./${file}`
      if (api.tabs) {
        api.tabs.create({ url })
        return
      }
      globalThis.location?.assign(url)
    },
  }
}

/* ------------------------------------------------------------------ */
/* Mock backend, for `pnpm dev`                                        */
/* ------------------------------------------------------------------ */

function memoryStorage(): KVArea {
  const PREFIX = 'tabula:'
  return {
    async get() {
      const out: Record<string, unknown> = {}
      for (let i = 0; i < globalThis.localStorage.length; i += 1) {
        const key = globalThis.localStorage.key(i)
        if (!key?.startsWith(PREFIX)) continue
        try {
          out[key.slice(PREFIX.length)] = JSON.parse(globalThis.localStorage.getItem(key) ?? 'null')
        } catch {
          /* a corrupt entry is treated as absent */
        }
      }
      return out
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) {
        globalThis.localStorage.setItem(PREFIX + key, JSON.stringify(value))
      }
    },
    async remove(keys) {
      for (const key of keys) globalThis.localStorage.removeItem(PREFIX + key)
    },
  }
}

/* ------------------------------------------------------------------ */
/* Detection                                                           */
/* ------------------------------------------------------------------ */

function detect(): BrowserSurface {
  const scope = globalThis as unknown as { browser?: RealApi; chrome?: RealApi }
  const firefox = scope.browser
  if (firefox?.runtime?.id) return realSurface(firefox, 'firefox')
  const chromium = scope.chrome
  if (chromium?.runtime?.id) return realSurface(chromium, 'chromium')
  return {
    origin: 'mock',
    storage: memoryStorage(),
    bookmarks: async () => mockBookmarks(),
    history: async (limit) => mockHistory(limit),
    async openUrl(url) {
      globalThis.open(url, '_blank', 'noopener')
    },
    // A sibling document in the same dev server, which is what the built
    // extension serves too — only the origin differs.
    async openView(name) {
      globalThis.open(`./${VIEW_FILE[name]}`, '_blank', 'noopener')
    },
  }
}

export const surface: BrowserSurface = detect()
