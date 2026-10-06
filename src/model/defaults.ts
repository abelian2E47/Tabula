/**
 * The board a new installation starts with.
 *
 * It arrives furnished rather than empty — real destinations, real widgets —
 * and every plate on it is an ordinary plate: movable, resizable, reshapable,
 * removable. Nothing is a special case; only the surrounding copy says the set
 * was preloaded.
 *
 * There is no artwork here on purpose. A new board is a blank surface in the
 * theme's own colour plus whatever wallpaper the user brings, and the presets
 * below are flat tints rather than pictures.
 */

import {
  BOARD_VERSION,
  ROTATION_OFF,
  type Board,
  type BoardPage,
  type Locale,
  type Plate,
  type SearchEngine,
  type Settings,
  type TextSpec,
} from './types'

export interface FlatWallpaper {
  id: string
  label: { zh: string; en: string }
  /** Drawn as a plain fill; never an image, never a pattern. */
  colour: string
  /** Presets that only make sense against one interface tone. */
  theme?: 'light' | 'dark'
}

export const FLAT_WALLPAPERS: FlatWallpaper[] = [
  { id: 'mist', label: { zh: '薄雾', en: 'Mist' }, colour: '#f0f1f3', theme: 'light' },
  { id: 'paper', label: { zh: '纸白', en: 'Paper' }, colour: '#faf9f7', theme: 'light' },
  { id: 'sand', label: { zh: '砂', en: 'Sand' }, colour: '#ece5da', theme: 'light' },
  { id: 'slate', label: { zh: '石板', en: 'Slate' }, colour: '#20242a', theme: 'dark' },
  { id: 'midnight', label: { zh: '午夜', en: 'Midnight' }, colour: '#111418', theme: 'dark' },
  { id: 'moss', label: { zh: '苔', en: 'Moss' }, colour: '#1b2320', theme: 'dark' },
]

export function flatWallpaper(id: string): FlatWallpaper | undefined {
  return FLAT_WALLPAPERS.find((candidate) => candidate.id === id)
}

/**
 * The engines that ship. Order is the order they are offered in, and the first
 * one is the one a new install searches with.
 *
 * `icon` names a mark in `src/assets/engines.ts`; the marks are bundled rather
 * than fetched, so switching engines costs nothing and works offline.
 */
export const DEFAULT_ENGINES: SearchEngine[] = [
  { id: 'google', name: 'Google', urlTemplate: 'https://www.google.com/search?q=%s', icon: 'google' },
  { id: 'bing', name: 'Bing', urlTemplate: 'https://www.bing.com/search?q=%s', icon: 'bing' },
  { id: 'baidu', name: '百度', urlTemplate: 'https://www.baidu.com/s?wd=%s', icon: 'baidu' },
  { id: 'bilibili', name: '哔哩哔哩', urlTemplate: 'https://search.bilibili.com/all?keyword=%s', icon: 'bilibili' },
  { id: 'github', name: 'GitHub', urlTemplate: 'https://github.com/search?q=%s', icon: 'github' },
]

export function defaultSettings(): Settings {
  return {
    locale: 'zh',
    theme: 'light',
    tileRadius: 18,
    imageRadius: 0,
    peek: true,
    // What a bar has always been rounded by, in px. A bar is long and short, so it
    // is rounded by a length: the same share of a bar and of a tile is not the same
    // corner, and a share of a bar is an ellipse.
    barRadius: 20,
    wallMargin: 4,
    iconSource: 'auto',
    // The first entry in the provider list, and the one that answers with a
    // large picture: a board of 32px icons is a board of soft icons.
    iconProvider: 'faviconim',
    grid: 'drag',
    // Sixteen across and six down lands an opening at roughly 76px in a laptop
    // window, which is the size a favicon stays recognisable at and still
    // leaves a search bar and two bands of shortcuts room to breathe.
    cols: 16,
    rows: 6,
    wallpaper: { kind: 'none' },
    // The shelf the user's own wallpapers are put on, and the rule by which it
    // takes turns. Empty and off, because a shelf nobody has filled cannot rotate
    // and a board that changed its own wallpaper unasked would be a board that
    // moved while it was being read.
    wallpapers: [],
    wallRotation: ROTATION_OFF,
    // The wallpaper as it is: no tint over it and no diffusion. A blurred
    // background is a look to ask for, not the one the board opens on. The
    // strength is the material's amount and belongs with it, so a plain wall is
    // the kind saying `clear` rather than the amount saying nought.
    wall: { kind: 'clear', blur: 0, strength: 62 },
    // The plain card, which is what the board has always drawn. The other answers
    // — a colour of the user's, or no tile at all — are there to be chosen, not to
    // be the house style.
    tileFill: { kind: 'auto' },
    /*
     * Two layers, two materials, and both of them `none` to begin with.
     *
     * `none` is not a material in this vocabulary: it is the absence of one, and
     * it is what the board has always drawn — a card for the tile, nothing at all
     * under the mark. A new install therefore looks exactly as it did, and the
     * four materials are four things to reach for rather than a style imposed on
     * somebody who only wanted their bookmarks on a page.
     *
     * Both carry a strength already, so the first press of `亚克力` gives glass
     * rather than a sheet so thin it reads as a bug: the amount is a separate
     * question, and a separate question wants an answer already in it.
     */
    backgroundMaterial: { kind: 'none', strength: 62, transparency: 0 },
    backgroundMaterialEnabled: true,
    iconMaterial: { kind: 'none', strength: 66, transparency: 0 },
    iconMaterialEnabled: true,
    // A folder's own surface, which is the third thing on the board that can be
    // made of something. Nothing, as every folder has been drawn until now.
    folderMaterial: { kind: 'none', strength: 66, transparency: 0 },
    showNames: true,
    nameSize: 12,
    // The board opens at full: this is a page somebody arranged themselves and
    // looks at dozens of times a day, and the stops below it are for the machine
    // that cannot afford it rather than for the look itself.
    performance: 'high',
    imageBlur: 0,
    // Just over half the tile: enough for a mark to be recognised at 1x1, and
    // it is a fraction of the tile, so a 2x2 tile wears a 2x2 tile's mark.
    iconSize: 0.54,
    // The middle, where a mark goes unless it is asked to go elsewhere.
    markOffset: { x: 0, y: 0 },
    // Both ways of changing engines, of which the panel ships on and the strip
    // ships off: a bar with six marks along its top is a bar that has to be looked
    // at, and one opening per board is the house style.
    engineMenu: true,
    engineStrip: false,
    engineMark: 34,
    focusKey: ' ',
    // The two keys the board has always used: Ctrl gathers, Alt reveals.
    pickModifier: 'ctrl',
    revealModifier: 'alt',
    // The rail ships where it has always been: along the bottom, at the left,
    // as a row of tags. Every other answer is a setting.
    rail: { orientation: 'row', edge: 'bottom', align: 'start' },
    searchEngines: DEFAULT_ENGINES,
    activeEngineId: 'google',
  }
}

export const SAMPLE_BAYS: BoardPage[] = [
  { id: 'bay-1', tint: 'blue' },
  { id: 'bay-2', tint: 'green' },
  // The third page ships given over to reading, so the shape of a page that
  // holds a whole view is visible from the start rather than only described.
  { id: 'bay-3', tint: 'amber', view: 'bookmarks' },
]

/**
 * A folder, furnished, so the shape of one is visible from the start rather
 * than only described. It is an ordinary plate holding ordinary plates.
 */
const SAMPLE_FOLDER_ID = 'folder-1'

const SAMPLE_FOLDER_PLATES: Plate[] = [
  {
    id: SAMPLE_FOLDER_ID,
    pageId: 'bay-1',
    kind: 'folder',
    shape: 'tile',
    x: 12,
    y: 3,
    w: 2,
    h: 2,
    title: '稍后读',
  },
  {
    id: 'folder-1-a',
    pageId: 'bay-1',
    kind: 'link',
    shape: 'tile',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    folderId: SAMPLE_FOLDER_ID,
    title: '少数派',
    url: 'https://sspai.com/',
  },
  {
    id: 'folder-1-b',
    pageId: 'bay-1',
    kind: 'link',
    shape: 'tile',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    folderId: SAMPLE_FOLDER_ID,
    title: 'Notion',
    url: 'https://www.notion.so/',
  },
]

interface LinkSeed {
  title: string
  url: string
  x: number
  y: number
  w?: number
  h?: number
}

// Laid out for sixteen columns by six rows, and composed rather than packed:
// the widgets claim the top two corners, the search bar and its two bands of
// shortcuts sit centred between them, and the clock and a larger tile take the
// bottom corners. The rest of the lower field is left open, which is what an
// unfurnished canvas is meant to look like.
const BAY_ONE_TOP: LinkSeed[] = [
  { title: '百度', url: 'https://www.baidu.com/', x: 5, y: 1 },
  { title: '哔哩哔哩', url: 'https://www.bilibili.com/', x: 6, y: 1 },
  { title: '知乎', url: 'https://www.zhihu.com/', x: 7, y: 1 },
  { title: '微博', url: 'https://weibo.com/', x: 8, y: 1 },
  { title: '豆瓣', url: 'https://www.douban.com/', x: 9, y: 1 },
  { title: '淘宝', url: 'https://www.taobao.com/', x: 10, y: 1 },
]

const BAY_ONE_BOTTOM: LinkSeed[] = [
  { title: 'GitHub', url: 'https://github.com/', x: 6, y: 2 },
  { title: 'MDN Web Docs', url: 'https://developer.mozilla.org/', x: 7, y: 2 },
  { title: 'Hacker News', url: 'https://news.ycombinator.com/', x: 8, y: 2 },
  { title: 'Lobsters', url: 'https://lobste.rs/', x: 9, y: 2 },
]

const BAY_TWO_LINKS: LinkSeed[] = [
  { title: 'Extension Workshop', url: 'https://extensionworkshop.com/', x: 7, y: 1 },
  { title: 'Wikipedia', url: 'https://en.wikipedia.org/', x: 8, y: 1 },
  { title: 'Figma', url: 'https://www.figma.com/', x: 7, y: 2 },
  { title: 'Linear', url: 'https://linear.app/', x: 8, y: 2 },
  { title: 'DeepSeek Platform', url: 'https://platform.deepseek.com/', x: 7, y: 3, w: 2, h: 2 },
]

/**
 * What a greeting says before anyone has written one, and how it is set.
 *
 * A text plate is the one widget with nothing to read off the browser, so it
 * starts with words rather than an empty box: an empty tile is a puzzle, and
 * the whole point of putting this on the wall is that you had something to say.
 */
const TEXT_GREETING: Record<Locale, string> = {
  zh: '你好，欢迎回来',
  en: 'Hello, good to see you',
}

export function freshText(locale: Locale): TextSpec {
  return { body: TEXT_GREETING[locale], font: 'ui', size: 32, weight: 600, align: 'left', tint: 'auto' }
}

/** The greeting the sample board ships with, sized for the room it sits in. */
const SAMPLE_TEXT: TextSpec = { body: TEXT_GREETING.zh, font: 'kai', size: 40, weight: 600, align: 'left', tint: 'auto' }

const BAY_TWO_WIDGETS: Plate[] = [
  {
    id: 'bookmarks-2',
    pageId: 'bay-2',
    kind: 'widget',
    shape: 'tile',
    x: 0,
    y: 0,
    w: 4,
    h: 3,
    widget: 'bookmarks',
  },
]

function linkPlate(id: string, pageId: string, seed: LinkSeed): Plate {
  return {
    id,
    pageId,
    kind: 'link',
    shape: 'tile',
    x: seed.x,
    y: seed.y,
    w: seed.w ?? 1,
    h: seed.h ?? 1,
    title: seed.title,
    url: seed.url,
  }
}

export function sampleBoard(): Board {
  const plates: Plate[] = [
    { id: 'search-1', pageId: 'bay-1', kind: 'search', shape: 'tile', x: 4, y: 0, w: 8, h: 1 },
    { id: 'bookmarks-1', pageId: 'bay-1', kind: 'widget', shape: 'tile', x: 0, y: 0, w: 4, h: 3, widget: 'bookmarks' },
    { id: 'history-1', pageId: 'bay-1', kind: 'widget', shape: 'tile', x: 12, y: 0, w: 4, h: 3, widget: 'history' },
    { id: 'clock-1', pageId: 'bay-1', kind: 'widget', shape: 'tile', x: 0, y: 3, w: 2, h: 2, widget: 'clock' },
    {
      id: 'text-1',
      pageId: 'bay-1',
      kind: 'widget',
      shape: 'tile',
      x: 2,
      y: 3,
      // Wide enough to hold the greeting on one line at the size it is set in:
      // a sample that folds its own last word onto a second line teaches the
      // wrong thing about what the tile is for.
      w: 5,
      h: 2,
      widget: 'text',
      text: SAMPLE_TEXT,
      showName: false,
    },
    {
      id: 'feature-1',
      pageId: 'bay-1',
      kind: 'link',
      shape: 'tile',
      x: 14,
      y: 3,
      w: 2,
      h: 2,
      title: 'DeepSeek',
      url: 'https://chat.deepseek.com/',
    },
  ]

  BAY_ONE_TOP.forEach((seed, index) => plates.push(linkPlate(`bay1-top-${index}`, 'bay-1', seed)))
  BAY_ONE_BOTTOM.forEach((seed, index) => plates.push(linkPlate(`bay1-bottom-${index}`, 'bay-1', seed)))
  BAY_TWO_LINKS.forEach((seed, index) => plates.push(linkPlate(`bay2-link-${index}`, 'bay-2', seed)))
  plates.push(...BAY_TWO_WIDGETS.map((plate) => ({ ...plate })))
  plates.push(...SAMPLE_FOLDER_PLATES.map((plate) => ({ ...plate })))

  return { version: BOARD_VERSION, pages: SAMPLE_BAYS.map((page) => ({ ...page })), plates }
}
