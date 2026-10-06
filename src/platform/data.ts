/**
 * Bookmarks and history, normalised to the two shapes the board draws.
 *
 * The browser's own tree is deep and irregular; flattening it here means no
 * component ever has to know what a Mozilla bookmark node looks like.
 */

export interface BookmarkEntry {
  id: string
  title: string
  url: string
  dateAdded?: number
}

export interface BookmarkGroup {
  id: string
  title: string
  items: BookmarkEntry[]
}

export interface HistoryEntry {
  id: string
  url: string
  title: string
  lastVisitTime: number
  visitCount: number
}

/** Host of a URL, or the raw string when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Synthetic material for `pnpm dev`, where no browser API exists. It is
 * deliberately plausible rather than lorem ipsum, so the layout can be judged
 * with real lengths, and it is never shown inside the extension.
 */
export function mockBookmarks(): BookmarkGroup[] {
  const group = (id: string, title: string, items: Array<[string, string]>): BookmarkGroup => ({
    id,
    title,
    items: items.map(([name, url], index) => ({ id: `${id}-${index}`, title: name, url })),
  })

  return [
    group('toolbar', 'Bookmarks Toolbar', [
      ['DeepSeek', 'https://chat.deepseek.com/'],
      ['GitHub', 'https://github.com/'],
      ['MDN Web Docs', 'https://developer.mozilla.org/'],
      ['Firefox Extension Workshop', 'https://extensionworkshop.com/'],
    ]),
    group('reading', 'Reading', [
      ['Wikipedia — Contact print', 'https://en.wikipedia.org/wiki/Contact_print'],
      ['Wikipedia — Shadow board', 'https://en.wikipedia.org/wiki/Shadow_board'],
      ['Hacker News', 'https://news.ycombinator.com/'],
      ['Lobsters', 'https://lobste.rs/'],
      ['The Pudding', 'https://pudding.cool/'],
    ]),
    group('work', 'Work', [
      ['Figma', 'https://www.figma.com/'],
      ['Linear', 'https://linear.app/'],
      ['Notion', 'https://www.notion.so/'],
    ]),
  ]
}

export function mockHistory(limit: number): HistoryEntry[] {
  const seeds: Array<[string, string, number]> = [
    ['Firefox Extension Workshop — Manifest V3', 'https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/', 6],
    ['MDN — browser.storage.local', 'https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local', 21],
    ['MDN — browser.bookmarks', 'https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/bookmarks', 47],
    ['GitHub — pointer events and drag', 'https://github.com/topics/pointer-events', 93],
    ['Hacker News — Show HN: a new tab board', 'https://news.ycombinator.com/', 140],
    ['Wikipedia — Plywood', 'https://en.wikipedia.org/wiki/Plywood', 205],
    ['Figma — community files', 'https://www.figma.com/community', 260],
    ['Wikipedia — Stencil', 'https://en.wikipedia.org/wiki/Stencil', 320],
    ['Lobsters — CSS grid snapping', 'https://lobste.rs/', 400],
    ['MDN — prefers-reduced-motion', 'https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion', 505],
    ['The Pudding — visual essays', 'https://pudding.cool/', 610],
    ['Linear — changelog', 'https://linear.app/changelog', 720],
    // Spread across earlier days, so the page's day grouping has something to
    // group: a month window flattened into "today" would not show it at all.
    ['MDN — CSS grid layout', 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout', 1500],
    ['Wikipedia — Platen press', 'https://en.wikipedia.org/wiki/Platen_press', 1620],
    ['Lobsters — keyboard shortcuts in web apps', 'https://lobste.rs/t/javascript', 2760],
    ['GitHub — mozilla/webextensions-examples', 'https://github.com/mozilla/webextensions-examples', 3100],
    ['The Pudding — why the web is slow', 'https://pudding.cool/process/', 5820],
    ['Figma — plugin docs', 'https://www.figma.com/plugin-docs/', 7260],
    ['Hacker News — Ask HN: how do you arrange your new tab?', 'https://news.ycombinator.com/ask', 10100],
  ]

  const now = Date.now()
  return seeds.slice(0, Math.max(0, limit)).map(([title, url, minutesAgo], index) => ({
    id: `mock-history-${index}`,
    title,
    url,
    lastVisitTime: now - minutesAgo * 60_000,
    visitCount: 1 + (index % 7),
  }))
}
