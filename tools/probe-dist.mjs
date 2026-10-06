/**
 * Smoke-check the built extension in a headless browser.
 *
 * The dev server is the wrong thing to test here: it is not what gets loaded
 * into the browser, and it has no storage. This runs the actual `dist` bundle —
 * with no `browser` global, so the platform layer falls back to its mock, which
 * is exactly what a plain page load looks like — and reports what the board
 * drew. It writes a temporary `dist/__probe.html`, drives it, prints the
 * findings as JSON and removes the file again.
 *
 *   node tools/probe-dist.mjs
 *   node tools/probe-dist.mjs --firefox
 *
 * With `--firefox` a stand-in `browser` object is installed before the bundle
 * runs, in the shape Firefox hands an extension, and every call it receives is
 * recorded. That is the path that actually runs inside the browser — storage,
 * `bookmarks.getTree`, `history.search`, `tabs.create` — and the one the mock
 * cannot speak for.
 */

import { spawn } from 'node:child_process'
import { copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, normalize, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const probeFile = join(dist, '__probe.html')
/** Where a walk that stopped leaves the page it stopped on. */
const domFile = join(root, '.probe-dom.html')

const CHROME_CANDIDATES = [  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

/** The checks, run inside the page. Kept as source so it sees the page's own DOM. */
/** What both walks start from: the page's own readers and its error ledger. */
const HELPERS = `
const out = {}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, budget = 4000) => {
  const started = Date.now()
  while (Date.now() - started < budget) {
    if (fn()) return true
    await wait(50)
  }
  return false
}
const q = (sel, from) => (from || document).querySelector(sel)
const qa = (sel, from) => [...(from || document).querySelectorAll(sel)]
const style = (el) => (el ? getComputedStyle(el) : null)
const key = (type, init) => globalThis.dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init }))
const stage = (name) => {
  document.documentElement.setAttribute('data-stage', name)
  // Also told to the server, out of band: a walk that stalls leaves no DOM to
  // read (the dump never comes), so the only way to know where it stopped is
  // for it to say so while it still can.
  try {
    fetch('/__stage/' + name, { keepalive: true }).catch(() => {})
  } catch (ignored) {
    /* no server, no matter */
  }
}
const errors = []
window.addEventListener('error', (e) => errors.push(String(e.message)))
// A step that throws stops the walk, so what has been gathered is published
// anyway, along with the reason: a silent probe is worse than a failed one.
window.addEventListener('unhandledrejection', (e) => {
  out.fatal = String((e.reason && e.reason.message) || e.reason)
  document.body.setAttribute('data-probe', JSON.stringify(out))
})

// Opening a tab is counted rather than performed: headless blocks popups, and
// what matters is that the board asked for the right addresses.
const opened = []
globalThis.open = (url) => {
  opened.push(String(url))
  return null
}
`

/** The full walk over a fresh board. */
const SCRIPT = HELPERS + `
await until(() => qa('.plate').length > 0)
stage('boot')
out.booted = qa('.plate').length > 0
out.backend = globalThis.__shim ? 'firefox' : 'mock'
out.plates = qa('.plate').length
out.tiles = qa('.plate__tile').length
out.widgets = qa('.plate__stack').length
out.pages = qa('.rail__tag').map((el) => el.textContent.trim())
out.isMockBackend = Boolean(q('.dev-badge'))

// A rail tag that owns a view is the "bookmarks/history as a whole page" case.
const viewTag = qa('.rail__tag').find((el) => el.classList.contains('rail__tag--view'))
if (viewTag) {
  viewTag.click()
  await wait(250)
  out.embeddedView = Boolean(q('.board-view .view--embedded'))
  out.embeddedGroups = qa('.board-view .group__head').map((el) => el.textContent.trim())
  out.embeddedRows = qa('.board-view .row').length
  out.embeddedHasCanvas = Boolean(q('.board-view .canvas'))
  qa('.rail__tag')[0].click()
  await wait(250)
}
stage('bar')
out.backOnBoard = Boolean(q('.canvas'))

// The engine mark, and the list behind it.
out.searchMedal = Boolean(q('.search__medal .search__mark'))
const medal = q('.search__medal--button')
if (medal) {
  medal.click()
  await wait(160)
  out.engineRows = qa('.engines__row').length
  out.engineOrder = qa('.engines__name').map((el) => el.textContent.trim())
  medal.click()
  await wait(160)
  out.engineRowsAfterClose = qa('.engines__row').length
}

// Widgets hand the tab to their own page. Two of the sample plates are a
// widget with a view, and the engine list is read from the copy.
const viewWidget = qa('[data-plate]').find((el) => {
  const label = el.getAttribute('aria-label') ?? ''
  return /书签|Bookmarks/.test(label)
})
if (viewWidget) {
  opened.length = 0
  viewWidget.click()
  await wait(200)
  out.widgetOpened = opened.slice()
}

// What a tile stands on, and names on and off. Transitions are switched off
// first: a shadow mid-flight is not the shadow the rule asked for, and headless
// does not run the animation clock the way a window does.
//
// A tile's ground is its *background colour* — the theme's card, a colour, or
// nothing — and the sheet that colour is worn as is the background material, which
// is a separate row further down this same group. So this stage presses the three
// colours the drawer offers and reads what the tile actually wears for each.
const root = document.documentElement
const tile = q('.plate__tile')
const settle = 320
root.style.setProperty('--motion', '0')
await wait(settle)
stage('fill')
const colourOf = (value) => {
  const parts = String(value).match(/rgba?\(([^)]+)\)/)
  if (!parts) return null
  const nums = parts[1].split(/[,/]/).map((n) => parseFloat(n))
  if (nums.length < 3 || nums.some((n) => Number.isNaN(n))) return null
  return { r: nums[0], g: nums[1], b: nums[2], a: nums.length > 3 ? nums[3] : 1 }
}
const atop = (front, back) => {
  const f = colourOf(front)
  const b = colourOf(back)
  if (!f || !b) return null
  return {
    r: f.r * f.a + b.r * (1 - f.a),
    g: f.g * f.a + b.g * (1 - f.a),
    b: f.b * f.a + b.b * (1 - f.a),
  }
}
const luminance = (c) => {
  const channel = (n) => {
    const s = n / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}
/** WCAG's own ratio, so the answer is a number rather than an opinion. */
const contrast = (ink, ground) => {
  const a = colourOf(ink)
  const b = ground && ground.r !== undefined ? ground : colourOf(ground)
  if (!a || !b) return null
  const one = luminance(a)
  const two = luminance(b)
  return Math.round(((Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05)) * 100) / 100
}
// The wall behind the tiles: a flat fill is a colour this can reason about, a
// photograph is not, and saying which one it is matters more than a number.
// With no wallpaper at all the wall element is see-through, and what is actually
// behind a pane is the surface under it.
const wallNow = () => {
  const wall = style(q('.surface__wall'))
  const under = colourOf(wall.backgroundColor)
  return {
    ground: under && under.a > 0 ? wall.backgroundColor : style(q('.surface')).backgroundColor,
    picture: wall.backgroundImage !== 'none',
  }
}
const readTile = (node) => {
  const box = style(node)
  const words =
    node.querySelector('.plate__initial') ||
    node.parentElement.querySelector('.plate__name') ||
    node.querySelector('.plate__kicker')
  const ink = words ? style(words).color : null
  const wall = wallNow()
  return {
    fill: node.getAttribute('data-fill') || 'inherit',
    ground: box.backgroundColor,
    backdrop: box.backdropFilter,
    shadow: box.boxShadow.replace(/\s+/g, ' ').slice(0, 70),
    ink,
    ratio: wall.picture ? null : contrast(ink, atop(box.backgroundColor, wall.ground)),
  }
}
out.wall = wallNow()
out.tileBeforeDrawer = readTile(tile)
qa('.chrome--top .chip')[1].click()
await wait(320)
// The drawer's own row reader, local to this visit: the shared one is declared
// further down the walk, where the drawer is opened for the size sliders.
const drawerRow = (pattern) =>
  qa('.drawer .field-row').find((row) =>
    pattern.test((row.querySelector('.field-row__label') || {}).textContent || ''),
  )
const groundRow = drawerRow(/背景颜色|Background colour/)
out.groundRow = Boolean(groundRow)
const pressGround = async (label) => {
  if (!groundRow) return false
  const button = qa('.drawer .button', groundRow).find((el) => new RegExp(label).test(el.textContent || ''))
  if (!button) return false
  button.click()
  await wait(settle)
  return true
}
out.pressedTransparent = await pressGround('透明|Transparent')
out.tileNone = readTile(tile)
out.pressedTheme = await pressGround('默认颜色|The default colour')
out.tileAuto = readTile(tile)
// The colour picker is the third answer: a tile standing on a colour of the
// user's, which is the one ground the theme cannot vouch for.
const groundSwatch = groundRow ? groundRow.querySelector('input[type="color"]') : null
if (groundSwatch) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(groundSwatch, '#123456')
  groundSwatch.dispatchEvent(new Event('input', { bubbles: true }))
  groundSwatch.dispatchEvent(new Event('change', { bubbles: true }))
}
await wait(settle + 200)
out.tileCustom = readTile(tile)
// The three must differ from each other, or the setting is a name for something
// the tile never wears.
out.groundsDiffer = Boolean(
  out.tileNone.ground !== out.tileAuto.ground &&
    out.tileCustom.ground !== out.tileAuto.ground &&
    out.tileCustom.ground !== out.tileNone.ground,
)
out.groundNoneIsClear = out.tileNone.fill === 'none' && colourOf(out.tileNone.ground)?.a === 0
out.groundCustomIsTheColor = Boolean(
  (() => {
    const c = colourOf(out.tileCustom.ground)
    return c && c.r === 0x12 && c.g === 0x34 && c.b === 0x56
  })(),
)
// And it is saved, not just drawn: the board reads its own record back.
await wait(900)
const savedState = () => {
  if (globalThis.__shim) return globalThis.__shim.store.state ?? null
  try {
    return JSON.parse(localStorage.getItem('tabula:state') ?? 'null')
  } catch {
    return null
  }
}
out.savedTileFill = (() => {
  const saved = savedState()
  return saved ? saved.settings.tileFill : null
})()

// Names are the plate's own decision now: the board's answer is only the
// default, so switching the board's answer off is what the setting does — the
// element is not drawn at all, and there is no rule left to fight over it.
const namesTick = qa('.drawer .field-row--check').find((row) =>
  /显示名称|Show names/.test((row.querySelector('.field-row__label') || {}).textContent || ''),
)
out.namesRow = Boolean(namesTick)
if (namesTick) {
  const tick = namesTick.querySelector('input')
  if (tick && tick.checked) {
    tick.click()
    await wait(settle)
  }
  out.namesAfterBoardOff = qa('.plate__name').length
  if (tick) {
    tick.click()
    await wait(settle)
  }
  out.namesAfterBoardOn = qa('.plate__name').length
}
qa('.drawer .button')[0].click()
await wait(260)

// The size of a mark is a fraction of its tile, and a tile answers how big it
// is: both halves of that have to be true for the mark to follow its tile.
const icon = q('.plate--tile .plate__icon') || q('.plate--tile .plate__initial')
if (icon) {
  const tileOfIcon = icon.closest('.plate__tile')
  out.markShape = {
    cls: icon.className,
    width: style(icon).width,
    height: style(icon).height,
    fontSize: style(icon).fontSize,
    radius: style(icon).borderRadius,
    containerType: tileOfIcon ? style(tileOfIcon).containerType : null,
    tileSize: tileOfIcon ? Math.round(tileOfIcon.getBoundingClientRect().width) : null,
  }
  root.style.setProperty('--icon-size', '0.9')
  root.style.setProperty('--icon-radius', '50%')
  await wait(settle)
  out.markAtNinety = {
    width: style(icon).width,
    height: style(icon).height,
    fontSize: style(icon).fontSize,
    radius: style(icon).borderRadius,
  }
  root.style.removeProperty('--icon-size')
  root.style.removeProperty('--icon-radius')
  await wait(settle)
}

// A stack opens its list, and offers to open all of it. It sits on the second
// sample page, so the page has to be turned to first.
const tags = qa('.rail__tag')
if (tags[1]) {
  tags[1].click()
  await wait(300)
}
stage('stack')
out.stackPagePlates = qa('.plate').length
const stackPlate = qa('[data-plate]').find((el) => /一键打开|Open a set/.test(el.getAttribute('aria-label') ?? ''))
out.stackFound = Boolean(stackPlate)
if (stackPlate) {
  stackPlate.click()
  await wait(220)
  out.stackRows = qa('.stack__open').map((el) => el.textContent.trim())
  const openAll = qa('.popover button').find((b) => /全部打开|Open all/.test(b.textContent))
  out.stackOpenAll = Boolean(openAll)
  if (openAll) {
    opened.length = 0
    openAll.click()
    await wait(220)
    out.stackOpened = opened.slice()
  }
  await wait(140)
  out.stackClosed = !q('.popover')
}
if (tags[0]) {
  tags[0].click()
  await wait(300)
}

// Holding Alt numbers the things that can actually be launched. The badge is
// always in the DOM and revealed by a class, so the class is what is read.
key('keydown', { key: 'Alt', altKey: true })
await wait(500)
out.numbered = qa('.plate--numbered').length
out.labels = qa('.plate--numbered .plate__badge').map((el) => el.textContent.trim())
out.clockNumbered = qa('.plate').some((el) => el.querySelector('.clock') && el.classList.contains('plate--numbered'))
out.searchNumbered = qa('.plate--search.plate--numbered').length
key('keyup', { key: 'Alt', altKey: false })
await wait(500)
out.numberedAfterRelease = qa('.plate--numbered').length

// Ctrl picks several and opens them all on release.
key('keydown', { key: 'Control', ctrlKey: true })
await wait(120)
const digits = ['1', '2', '3']
for (const digit of digits) {
  key('keydown', { key: digit, ctrlKey: true })
  await wait(120)
}
stage('multi')
out.selectedCount = qa('.plate--selected').length
out.selectionBar = Boolean(q('.marks'))
// Ctrl alone is meant to reveal the numbers too, not just to pick things.
out.numberedUnderCtrl = qa('.plate--numbered').length
const selectedLabels = qa('.plate--selected .plate__badge').map((el) => el.textContent.trim())
opened.length = 0
key('keyup', { key: 'Control', ctrlKey: false })
await wait(300)
out.batchOpened = opened.slice()
out.selectedAfterRelease = qa('.plate--selected').length
out.selectedLabels = selectedLabels

// A digit on its own switches page.
const before = qa('.rail__tag--current')[0]?.textContent.trim()
key('keydown', { key: '3' })
await wait(250)
out.pageBeforeDigit = before
out.pageAfterDigit = qa('.rail__tag--current')[0]?.textContent.trim()
key('keydown', { key: '1' })
await wait(250)

// A page may hold more than one bar. The add menu used to refuse the second.
qa('.chrome--top .chip')[0].click()
await wait(260)
const searchMode = qa('.popover button').find((b) => /^搜索栏$|^Search bar$/.test(b.textContent.trim()))
stage('addbar')
out.addMenuHasSearch = Boolean(searchMode)
if (searchMode) {
  searchMode.click()
  await wait(220)
  const confirm = qa('.popover button').find((b) => /^挂上$|^Hang it up$/.test(b.textContent.trim()))
  out.addBarEnabled = confirm ? !confirm.disabled : false
  if (confirm) {
    confirm.click()
    await wait(400)
  }
}
out.barsAfterAdd = qa('.plate--search').length

// The bar's own menu carries its sizes and the way off the board. Folding is
// gone — a bar is a bar — so nothing here may offer a folded form.
const menuOn = (el) => {
  const rect = el.getBoundingClientRect()
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left + 24, clientY: rect.top + 12 }))
}
const menuButton = (pattern) => qa('.popover button').find((b) => pattern.test(b.textContent))

const bar = qa('.plate--search')[0]
menuOn(bar)
await wait(280)
out.barMenu = qa('.popover .menu-label, .popover .menu-item').map((el) => el.textContent.trim())
out.searchSpanChoices = qa('.popover .span-choice__name').map((el) => el.textContent.trim())
out.barMenuHasForm = out.barMenu.some((label) => /成图标|成搜索栏|Fold into|Open as a bar/.test(label))

// The height is where the grid stops being the only answer: a bar can be put at
// any thickness between rows, because a bar that can only be whole rows tall is
// a bar that cannot be made to sit right next to the tiles beside it.
const heightRow = qa('.popover .field-row').find((row) => /高度|Height/.test(row.textContent))
const heightSlider = heightRow ? heightRow.querySelector('input[type="range"]') : null
out.barHeightSlider = Boolean(heightSlider)
if (heightSlider) {
  out.barHeightRange = heightSlider.min + '–' + heightSlider.max + ' step ' + heightSlider.step
  // Driven here rather than through the shared helper, which is declared further
  // down the walk than this.
  const pushSlider = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  pushSlider.call(heightSlider, '1.45')
  heightSlider.dispatchEvent(new Event('input', { bubbles: true }))
  heightSlider.dispatchEvent(new Event('change', { bubbles: true }))
  await wait(340)
  const barTile = q('.plate--search .plate__tile')
  out.barHeightAtOneAndHalf = barTile ? Math.round(barTile.getBoundingClientRect().height) : null
  const canvasStyleNow = getComputedStyle(q('.canvas'))
  const tileSize = Number(canvasStyleNow.getPropertyValue('--tile').replace('px', ''))
  const pitchY = Number(canvasStyleNow.getPropertyValue('--pitch-y').replace('px', ''))
  const gapY = pitchY - tileSize
  out.barHeightExpected = Math.round(1.45 * tileSize + 0.45 * gapY)
  // A height no whole number of rows can produce is the point of the slider.
  out.barHeightOffGrid =
    out.barHeightAtOneAndHalf !== Math.round(tileSize) &&
    out.barHeightAtOneAndHalf !== Math.round(2 * tileSize + gapY)
}
key('keydown', { key: 'Escape' })
await wait(240)
out.foldedCount = qa('.plate--folded').length

// Hiding is done from the bar, and undone from the drawer.
const barNow = qa('.plate--search')[0]
if (barNow) {
  menuOn(barNow)
  await wait(280)
  const hide = menuButton(/收起来|Take this bar off/)
  if (hide) {
    hide.click()
    await wait(360)
  }
}
out.barsAfterHide = qa('.plate--search').length

qa('.chrome--top .chip')[1].click()
await wait(300)
// The bars are listed in their own section of the drawer, next to the tiles
// section whose checkbox is also a tick row.
const barsInDrawer = qa('.drawer section').find((section) =>
  /^(搜索栏|Search bars)$/.test(((section.querySelector('.section__title') || {}).textContent || '').trim()),
)
out.drawerBars = barsInDrawer
  ? qa('.field-row--check .field-row__label', barsInDrawer).map((el) => el.textContent.trim())
  : ['no section']
out.drawerBarRows = barsInDrawer ? barsInDrawer.querySelectorAll('.field-row--check input').length : 0
const barTick = barsInDrawer ? qa('.field-row--check input', barsInDrawer) : []
out.drawerBarRows = barTick.length
if (barTick.length) {
  barTick[0].click()
  await wait(340)
}
out.barsAfterUntick = qa('.plate--search').length
qa('.drawer .button')[0].click()
await wait(260)

// Space puts the caret in the field, since that is what the key is for.
key('keydown', { key: ' ' })
await wait(260)
stage('focus')
out.focusTarget = document.activeElement
  ? (document.activeElement.className || document.activeElement.tagName).toString()
  : 'none'

// A frame is what focuses a bar that had to be unfolded first, so whether this
// window draws any is worth knowing.
out.rafFires = await new Promise((resolve) => {
  const bail = setTimeout(() => resolve('no frame'), 900)
  globalThis.requestAnimationFrame(() => {
    clearTimeout(bail)
    resolve('frame')
  })
})

// A page can be given over to one view, and that is set from the page's own
// menu — the path a person takes, rather than a default written into the file.
// Giving the page you are looking at over to a view has to show it at once,
// which is the whole point of it being a page.
menuOn(q('.rail__tag--current') || qa('.rail__tag')[0])
await wait(settle)
const contentRow = qa('.popover .button').find((node) => /^(书签|Bookmarks)$/.test(node.textContent.trim()))
stage('viewpage')
out.pageMenuContentView = Boolean(contentRow)
if (contentRow) contentRow.click()
await wait(600)
out.viewPageHasView = Boolean(q('.board-view'))
out.viewPageHasCanvas = Boolean(q('.canvas-host'))
out.viewPageRows = qa('.board-view .list__row, .board-view .group__head').length

// And it has to be able to go back to being an ordinary canvas.
menuOn(q('.rail__tag--current') || qa('.rail__tag')[0])
await wait(settle)
const boardRow = qa('.popover .button').find((node) => /^(快捷启动|Shortcuts)$/.test(node.textContent.trim()))
out.pageMenuBoardRow = Boolean(boardRow)
if (boardRow) boardRow.click()
await wait(600)
out.canvasAfterReturn = Boolean(q('.canvas-host'))
out.viewGoneAfterReturn = !q('.board-view')

/* ------------------------------------------------------------------ */
/* Folders, per-tile answers, icon sizing, engine strip                 */
/* ------------------------------------------------------------------ */

// A folder is a plate that holds plates. Its marks say what is inside without
// opening it; pressing it opens what it holds; anything taken back out goes
// onto the grid and leaves the folder one mark lighter.
stage('folder')
out.folderMarks = qa('.plate--folder .folder__cell').length
const folder = q('.plate--folder')
if (folder) {
  folder.click()
  await wait(360)
  const sheet = q('.folder-sheet__body')
  out.folderSheet = Boolean(sheet)
  out.folderVeiled = Boolean(q('.folder-sheet__veil'))
  out.folderRows = qa('.folder-sheet__grid .folder-item').length
  out.folderNames = qa('.folder-sheet .folder-item__name').map((el) => el.textContent.trim())
  // "Open all" belongs in the corner a page's own button would be in: the
  // bottom-right of the sheet, not under the last item or beside the title.
  const openAll = qa('.folder-sheet__foot .button').find((el) => el.textContent.trim())
  if (sheet && openAll) {
    const box = sheet.getBoundingClientRect()
    const button = openAll.getBoundingClientRect()
    out.openAllInCorner =
      button.right > box.right - 40 && button.bottom > box.bottom - 40 && button.left > box.left + box.width / 3
  }
  out.folderMarksInSheet = qa('.folder-sheet .folder__icon, .folder-sheet .folder__initial').length
  opened.length = 0
  const firstRow = q('.folder-sheet .folder-item__open')
  if (firstRow) {
    firstRow.click()
    await wait(220)
  }
  out.folderOpened = opened.slice()
  const unfile = q('.folder-sheet .folder-item__drop')
  if (unfile) {
    unfile.click()
    await wait(420)
  }
  out.folderRowsAfterUnfile = qa('.folder-sheet__grid .folder-item').length
  out.folderMarksAfterUnfile = qa('.plate--folder .folder__cell').length
  out.platesAfterUnfile = qa('.plate').length
  key('keydown', { key: 'Escape' })
  await wait(260)
  out.folderSheetClosed = !q('.folder-sheet__body')
  // The veil is the way out anyone finds first: a press outside the sheet.
  const again = q('.plate--folder')
  if (again) {
    again.click()
    await wait(340)
    const veil = q('.folder-sheet__veil')
    if (veil) veil.click()
    await wait(260)
    out.folderClosedByVeil = !q('.folder-sheet__body')
  }
}

// One tile's own fill, and one tile's own name: either may disagree with what
// the board says, and the board's answer is only the default. The board is set
// to draw names first, so the tile that refuses one is refusing a live default.
qa('.chrome--top .chip')[1].click()
await wait(320)
const tilesRow = qa('.drawer .field-row--check').find((row) =>
  /显示名称|Show names/.test((row.querySelector('.field-row__label') || {}).textContent || ''),
)
const namesBox = tilesRow ? tilesRow.querySelector('input') : null
if (namesBox && !namesBox.checked) {
  namesBox.click()
  await wait(320)
}
out.namesOnFirst = qa('.plate__name').length
qa('.drawer .button')[0].click()
await wait(260)

const namedPlate = qa('.plate').find((el) => el.querySelector(':scope > .plate__name'))
out.namedPlateFound = Boolean(namedPlate)
if (namedPlate) {
  menuOn(namedPlate)
  await wait(300)
  out.plateMenuHasFill = qa('.popover .menu-label').some((el) => /底色|Backdrop/.test(el.textContent.trim()))
  const clearFill = qa('.popover .button').find((b) => /^(透明|Transparent)$/.test(b.textContent.trim()))
  out.plateMenuHasClear = Boolean(clearFill)
  if (clearFill) {
    clearFill.click()
    await wait(300)
  }
  const plateSel = '[data-plate="' + namedPlate.getAttribute('data-plate') + '"]'
  const stripped = document.querySelector(plateSel + ' .plate__tile[data-fill="none"]')
  out.perTileFillNone = Boolean(stripped)
  out.perTileFillNoneColour = stripped ? style(stripped).backgroundColor : null

  const nameTick = q('.popover input[type=checkbox]')
  if (nameTick) {
    nameTick.click()
    await wait(300)
  }
  const after = document.querySelector(plateSel)
  out.perTileNameOff = Boolean(after && !after.querySelector(':scope > .plate__name') && after.classList.contains('plate--tight'))
  key('keydown', { key: 'Escape' })
  await wait(240)
}

// Gathering a selection makes a folder where the first of them was, and files
// the rest under it. The selection is read off the marks bar, which is where a
// person reaches for it.
const foldersBefore = qa('.plate--folder').length
key('keydown', { key: 'Control', ctrlKey: true })
key('keydown', { key: '1', ctrlKey: true })
key('keydown', { key: '2', ctrlKey: true })
await wait(260)
stage('group')
out.selectedByCtrl = qa('.plate--selected').length
const groupButton = qa('.marks .button').find((b) => /放进|folder/i.test(b.textContent))
out.marksGroupButton = Boolean(groupButton)
opened.length = 0
if (groupButton) {
  groupButton.click()
  await wait(420)
}
out.foldersAfterGroup = qa('.plate--folder').length
out.foldersGrew = qa('.plate--folder').length > foldersBefore
out.selectedAfterGroup = qa('.plate--selected').length
key('keyup', { key: 'Control', ctrlKey: false })
await wait(300)
out.openedOnRelease = opened.slice()

// The size of a mark is a fraction of the tile it sits in, and its corners are
// its own: the two are separate settings, which is the point of having both.
qa('.chrome--top .chip')[1].click()
await wait(320)
const rowFor = (pattern) =>
  qa('.drawer .field-row').find((row) => pattern.test((row.querySelector('.field-row__label') || {}).textContent || ''))
const setRange = (row, value) => {
  const range = row ? row.querySelector('input[type=range]') : null
  if (!range) return false
  // A controlled range has to be moved through the prototype's own setter:
  // React keeps its own copy of the last value, and assigning to the node
  // updates that copy too, so the event would look like no change at all.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setValue.call(range, String(value))
  range.dispatchEvent(new Event('input', { bubbles: true }))
  range.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}
const markOf = () => q('.plate--tile .plate__icon') || q('.plate--tile .plate__initial')
const markBefore = markOf()
stage('marksize')
out.markWidthBefore = markBefore ? Math.round(markBefore.getBoundingClientRect().width) : null
// A tile's corner and a mark's corner are two different things now: the drawer's
// radius rounds the tile, and the mark standing inside it keeps the corners its
// own box has. So the row is set to the top of its range and *both* are read — the
// tile has to be round at fifty and the mark has to be untouched by it.
out.tileRadiusRow = setRange(rowFor(/磁贴圆角|Tile corners/), 50)
await wait(280)
const markAfter = markOf()
out.markWidthAtDefault = markAfter ? Math.round(markAfter.getBoundingClientRect().width) : null
out.markRadius = markAfter ? style(markAfter).borderRadius : null
out.tileRadius = (() => {
  const tile = q('.plate--tile .plate__tile')
  return tile ? style(tile).borderRadius : null
})()
out.radiiDiffer = Boolean(out.markRadius && out.tileRadius && out.markRadius !== out.tileRadius)

out.iconSizeRow = setRange(rowFor(/图标大小|Icon size/), 90)
await wait(320)
const markBig = markOf()
out.markWidthAtNinety = markBig ? Math.round(markBig.getBoundingClientRect().width) : null
out.markGrewWithIconSize = Boolean(
  out.markWidthAtDefault !== null && out.markWidthAtNinety !== null && out.markWidthAtNinety > out.markWidthAtDefault,
)

// Size is one number and it goes past the tile: a mark told to be bigger than
// the tile it stands in is cropped by it, which is what makes a logo read as the
// opening rather than as something stuck on it. The slider's own ceiling is what
// this measures — a range that stopped at 100% would leave the two readings the
// same, and the setting would be a promise the control cannot keep.
stage('marksize-max')
const sizeInput = (() => {
  const row = rowFor(/图标大小|Icon size/)
  return row ? row.querySelector('input[type=range]') : null
})()
out.iconSizeRange = sizeInput ? { min: Number(sizeInput.min), max: Number(sizeInput.max) } : null
const smallTile = qa('.plate--tile').find((node) => {
  const box = node.getBoundingClientRect()
  return node.querySelector('.plate__icon') && box.width > 40 && box.width < 130
})
if (smallTile && sizeInput) {
  const narrow = Math.round(smallTile.getBoundingClientRect().width)
  const markWidth = () => {
    const mark = smallTile.querySelector('.plate__icon')
    return mark ? Math.round(mark.getBoundingClientRect().width) : null
  }
  setRange(rowFor(/图标大小|Icon size/), 100)
  await wait(340)
  out.markAtHundred = { tile: narrow, mark: markWidth() }
  setRange(rowFor(/图标大小|Icon size/), Number(sizeInput.max))
  await wait(340)
  out.markAtCeiling = { tile: narrow, mark: markWidth() }
  out.markOutgrowsTile = Boolean(
    out.markAtCeiling.mark !== null && out.markAtCeiling.mark > out.markAtHundred.mark && out.markAtCeiling.mark > narrow,
  )
  setRange(rowFor(/图标大小|Icon size/), 54)
  await wait(300)
}

// The two ways to change engines: the panel behind the mark, and a strip of
// every engine above the field, one press each.
const placeRow = rowFor(/搜索引擎的切换|How engines/)
const placeSelect = placeRow ? placeRow.querySelector('select') : null
out.enginePlacementRow = Boolean(placeSelect)
if (placeSelect) {
  placeSelect.value = 'strip'
  placeSelect.dispatchEvent(new Event('change', { bubbles: true }))
  await wait(360)
}
stage('strip')
out.stripMarks = qa('.strip__mark').length

// The strips' marks are a size the drawer names in pixels, because a row of
// engine logos above the bar is a row of buttons rather than a mark standing on
// a tile: it has to be legible whatever the grid is doing.
const engineMarkRow = rowFor(/引擎图标大小|Engine mark size/)
out.engineMarkRow = Boolean(engineMarkRow)
if (engineMarkRow) {
  setRange(engineMarkRow, 46)
  await wait(320)
  const engineMark = q('.strip__mark')
  out.engineMarkWidth = engineMark ? Math.round(engineMark.getBoundingClientRect().width) : null
  out.engineMarkGrew = out.engineMarkWidth !== null && out.engineMarkWidth >= 44
}
out.stripMedalGone = !q('.search__medal--button')
// Each bar carries its own engine, so the "current" mark is read inside one
// bar's strip rather than across every strip on the page.
const stripEl = q('.strip')
const stripMarks = stripEl ? qa('.strip__mark', stripEl) : []
const stripTarget = stripMarks[1]
if (stripTarget) {
  stripTarget.click()
  await wait(300)
}
out.stripOnMoved = Boolean(
  stripMarks.length > 1 &&
    stripMarks[1].classList.contains('strip__mark--on') &&
    stripEl &&
    qa('.strip__mark--on', stripEl).length === 1,
)
out.stripFocus = document.activeElement ? (document.activeElement.className || document.activeElement.tagName).toString() : 'none'
if (placeSelect) {
  placeSelect.value = 'menu'
  placeSelect.dispatchEvent(new Event('change', { bubbles: true }))
  await wait(320)
}
out.stripAfterReset = qa('.strip__mark').length
qa('.drawer .button')[0].click()
await wait(280)

/* ------------------------------------------------------------------ */
/* One material, and every kind of opening that has to wear it          */
/* ------------------------------------------------------------------ */

// The material that is left is the mark's: the pane a logo or a glyph stands on.
// Tiles themselves are cards, colours, or nothing — a tile's material was taken
// out on purpose, so this asks the four answers of every kind of opening that has
// a mark in it: a square tile, a round one, a widget's glyph, a folder's cells
// and the search bar's engine mark.
stage('mark-material')
const putMarksOn = async (label, rowPattern) => {
  qa('.chrome--top .chip')[1].click()
  await wait(300)
  const row = qa('.drawer .field-row').find((el) =>
    rowPattern.test((el.querySelector('.field-row__label') || {}).textContent || ''),
  )
  const button = row ? qa('.drawer .button', row).find((el) => new RegExp(label).test(el.textContent || '')) : null
  if (button) {
    button.click()
    await wait(settle)
  }
  qa('.drawer .button')[0].click()
  await wait(280)
  return Boolean(button)
}
out.markRowFound = await putMarksOn('毛玻璃|Frosted', /^图标材质$|^Icon material$/)
// A tile's corner is the tile's own decision, so a round tile is made here rather
// than hoped for: a board that shipped with none would turn this into a test of
// the sample. The tile is rounded from its own menu, where its corner is answered,
// and at fifty per cent of itself a square tile is a circle — which is the case
// that has to go on wearing its marks' material like every other opening.
const roundMe = qa('.plate--tile').find((el) => el.querySelector('.plate__icon'))
if (roundMe) {
  menuOn(roundMe)
  await wait(320)
  const corner = qa('.popover .field-row')
    .find((el) => /磁贴圆角|Tile corners/.test(el.textContent))
    ?.querySelector('input[type=range]')
  if (corner) {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setValue.call(corner, '50')
    corner.dispatchEvent(new Event('input', { bubbles: true }))
    corner.dispatchEvent(new Event('change', { bubbles: true }))
    await wait(420)
  }
  key('keydown', { key: 'Escape' })
  await wait(260)
}
/** What the mark of a plate was told to be: the kind, and what it actually wears. */
const wearOf = (plateEl) => {
  const node = plateEl ? plateEl.querySelector('.plate__tile') : null
  if (!node) return null
  const mark = node.querySelector('.plate__icon, .plate__initial, .widget-glyph, .folder__icon')
  const markBox = mark ? style(mark) : null
  return {
    kind: node.getAttribute('data-mark'),
    ground: markBox ? markBox.backgroundColor : null,
    backdrop: markBox ? markBox.backdropFilter : null,
    box: mark ? mark.getBoundingClientRect().width : null,
  }
}
const widgetPlate = qa('.plate').find((el) => el.querySelector('.plate__stack'))
out.scope = {
  link: wearOf(qa('.plate--tile').find((el) => el.querySelector('.plate__icon'))),
  round: wearOf(roundMe),
  widget: wearOf(widgetPlate),
  folder: wearOf(q('.plate--folder')),
}
// Every one of them has to be wearing it: the same kind read off each round tile,
// square tile, glyph and folder cell, and a pane behind the marks — a ground or a
// backdrop, one or the other. The round tile is among them because a round opening
// is where a chip's corners and its material have to agree.
const worn = Object.entries(out.scope).filter(([, value]) => value)
out.scopeWearing = worn.filter(([, value]) => value.kind === 'frosted').map(([name]) => name)
out.scopeFlat = worn.filter(([, value]) => value.kind !== 'frosted').map(([name, value]) => name + ':' + value.kind)
out.markMaterialReachesEveryOpening = out.scopeWearing.length === worn.length && worn.length >= 4
// And the plate has to be a plate: the mark drawn inside it with a margin left
// showing, or the pane hides behind a logo that arrives as an opaque square and
// the materials read as one and the same.
const plateBox = (() => {
  const node = q('.plate--tile .plate__icon') || q('.plate--tile .plate__initial')
  if (!node) return null
  const box = style(node)
  return { pad: parseFloat(box.paddingTop) || 0, w: node.getBoundingClientRect().width }
})()
out.markPlateBox = plateBox
out.markPlateShows = Boolean(plateBox && plateBox.pad > 1 && plateBox.pad < plateBox.w / 2)
// And a mark given no pane at all is the mark every board has always drawn: the
// one answer that must leave nothing behind it.
const noMarks = await putMarksOn('透明|Transparent', /^图标材质$|^Icon material$/)
out.markNoneWearsNothing = noMarks && wearOf(q('.plate--tile'))?.kind === 'none'
out.markNoneHasNoMargin = (() => {
  const node = q('.plate--tile .plate__icon') || q('.plate--tile .plate__initial')
  return node ? (parseFloat(style(node).paddingTop) || 0) < 0.5 : null
})()
// A folder's own cells are left out of this on purpose: what shows through a
// folder is the board under it, and a pane behind a pane is not a material.
out.folderCellInk = (() => {
  const cell = q('.plate--folder .folder__cell')
  return cell ? style(cell).color : null
})()
await putMarksOn('实心|Solid', /^图标材质$|^Icon material$/)

/* ------------------------------------------------------------------ */
/* A greeting, and what it is set in                                   */
/* ------------------------------------------------------------------ */

// Words on a board carry their own face, size, weight, alignment and colour, so
// every one of those has to reach the words rather than the tile, and the words
// themselves have to come back out of storage.
stage('text')
qa('.chrome--top .chip')[0].click()
await wait(280)
const widgetMode = qa('.popover button').find((b) => /^小组件$|^Widgets$/.test(b.textContent.trim()))
out.addMenuHasWidgets = Boolean(widgetMode)
if (widgetMode) {
  widgetMode.click()
  await wait(240)
}
const wordsMode = qa('.popover button').find((b) => /^文字$|^Words$/.test(b.textContent.trim()))
out.addMenuHasText = Boolean(wordsMode)
if (wordsMode) {
  wordsMode.click()
  await wait(460)
}
const proseHosts = () => qa('.plate').filter((el) => el.querySelector('.prose'))
out.textPlates = proseHosts().length
out.textBody = q('.prose') ? q('.prose').textContent.trim() : null

// A greeting opens nothing, so it is given no key: it must not be numbered
// while the keys are showing, and it must not be pickable with Ctrl either.
key('keydown', { key: 'Alt', altKey: true })
await wait(420)
const textPlate = proseHosts()[proseHosts().length - 1]
out.textNumbered = textPlate ? textPlate.classList.contains('plate--numbered') : null
out.textHasBadge = textPlate ? Boolean(textPlate.querySelector('.plate__badge')) : null
key('keyup', { key: 'Alt', altKey: false })
await wait(320)

const host = proseHosts()[proseHosts().length - 1]
if (host) {
  menuOn(host)
  await wait(300)
  out.textMenu = qa('.popover .menu-label').map((el) => el.textContent.trim())
  const pick = (pattern) => qa('.popover button').find((b) => pattern.test(b.textContent.trim()))
  const setText = (node, value) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setValue.call(node, value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const before = host.querySelector('.prose')
  out.textFontBefore = before ? style(before).fontFamily.split(',')[0].replace(/"/g, '') : null

  const brush = pick(/^楷体$|^Brush$/)
  if (brush) {
    brush.click()
    await wait(240)
  }
  const bold = pick(/^加粗$|^Bold$/)
  if (bold) {
    bold.click()
    await wait(240)
  }
  const right = pick(/^右$|^Right$/)
  if (right) {
    right.click()
    await wait(240)
  }
  // The colour row is the follow-theme button plus one swatch per token, in the
  // order the whole board uses: blue, green, amber, rose, violet, slate.
  const swatches = qa('.popover .swatch')
  out.textSwatches = swatches.length
  const rose = swatches[3]
  if (rose) {
    rose.click()
    await wait(260)
  }
  const sizeRow = qa('.popover .field-row').find((row) => row.querySelector('input[type=range]'))
  out.textRangeRow = Boolean(sizeRow)
  if (sizeRow) setRange(sizeRow, 96)
  await wait(300)
  const box = q('.popover textarea')
  out.textHasBox = Boolean(box)
  if (box) {
    setText(box, '今天也请多指教')
    await wait(160)
    const save = pick(/^保存$|^Save$/)
    if (save) {
      save.click()
      await wait(360)
    }
  }
  const styled = proseHosts()[proseHosts().length - 1]
  const styledText = styled ? styled.querySelector('.prose') : null
  out.textBodyAfter = styledText ? styledText.textContent.trim() : null
  out.textFontAfter = styledText ? style(styledText).fontFamily : null
  out.textSizeAfter = styledText ? style(styledText).fontSize : null
  out.textWeightAfter = styledText ? style(styledText).fontWeight : null
  out.textAlignAfter = styledText ? style(styledText).textAlign : null
  out.textColourAfter = styledText ? style(styledText).color : null
  out.textAttrs = styledText
    ? { font: styledText.dataset.font, align: styledText.dataset.align, tint: styledText.dataset.tint }
    : null
  out.textHostWide = host.getBoundingClientRect().width
  out.textHostTall = host.getBoundingClientRect().height

  // The size that was asked for is what a tile draws, until the tile is too
  // short to hold it: then the words come down to what fits rather than being
  // cut in half.
  key('keydown', { key: 'Escape' })
  await wait(240)
  const wideHost = proseHosts()[proseHosts().length - 1]
  if (wideHost) {
    menuOn(wideHost)
    await wait(300)
    const square = qa('.popover .span-choice').find((b) => /^1×1$/.test(b.textContent.trim()))
    if (square) {
      square.click()
      await wait(300)
      key('keydown', { key: 'Escape' })
      await wait(300)
    }
  }
  const small = proseHosts()[proseHosts().length - 1]
  const smallText = small ? small.querySelector('.prose') : null
  out.textSizeWhenTiny = smallText ? style(smallText).fontSize : null
  out.textFits = smallText
    ? Math.round(smallText.getBoundingClientRect().height) <= Math.round(small.getBoundingClientRect().height)
    : null
}

/* ------------------------------------------------------------------ */
/* Banding, and moving what a band gathered                             */
/* ------------------------------------------------------------------ */

// A press on bare wall that drags draws a band, and whatever it covers becomes
// the selection. The press has to start on bare wall, so bare points are found
// rather than guessed. The two furthest apart are used: a band from a point
// beside a plate to that plate's centre is a band that covers almost nothing,
// which would report the gesture as broken when it is only small.
const canvas = q('.canvas')
const canvasBox = canvas ? canvas.getBoundingClientRect() : null
const firstPlate = qa('.plate')[0]
const plateUnder = (x, y) => {
  const el = document.elementFromPoint(x, y)
  return el ? el.closest('[data-plate]') : null
}
const barePoints = []
if (canvasBox) {
  for (let y = Math.round(canvasBox.top) + 3; y < canvasBox.bottom - 3; y += 6) {
    for (let x = Math.round(canvasBox.left) + 3; x < canvasBox.right - 3; x += 6) {
      if (!plateUnder(x, y)) barePoints.push({ x, y })
    }
  }
}
let bare = null
let far = null
if (barePoints.length) {
  const byDepth = [...barePoints].sort((a, b) => a.x + a.y - (b.x + b.y))
  bare = byDepth[0]
  far = byDepth[byDepth.length - 1]
}
stage('wall')
out.bareWall = Boolean(bare && far)
const elementOf = (id) => document.querySelector('[data-plate="' + id + '"]')
const leftsOf = (ids) => ids.map((id) => Math.round(elementOf(id).getBoundingClientRect().left))
if (bare && far && canvasBox) {
  canvas.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, clientX: bare.x, clientY: bare.y, button: 0, buttons: 1, pointerId: 11 }),
  )
  await wait(70)
  globalThis.dispatchEvent(
    new PointerEvent('pointermove', { bubbles: true, clientX: far.x, clientY: far.y, buttons: 1, pointerId: 11 }),
  )
  await wait(160)
  out.bandFrom = [bare.x, bare.y]
  out.bandTo = [far.x, far.y]
  out.bandDrawn = Boolean(q('.band'))
  globalThis.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, clientX: far.x, clientY: far.y, pointerId: 11 }),
  )
  await wait(220)
  out.bandSelected = qa('.plate--selected').length
  out.bandCoversASpan = qa('.plate--selected').some((el) => el.getBoundingClientRect().width > 100)
  key('keydown', { key: 'Escape' })
  await wait(160)
}

// Then a band over one row only. Gathering the whole wall proves the gesture
// works; gathering a row is what a person does with it. The band is drawn from
// the row's upper left corner to its lower right, because a band with no height
// is a band with no room to cover anything.
const rowBand = () => {
  const rows = new Map()
  for (const el of qa('.plate')) {
    const rect = el.getBoundingClientRect()
    const key = Math.round(rect.top / 8)
    rows.set(key, [...(rows.get(key) ?? []), rect])
  }
  const bands = [...rows.values()]
    .map((rects) => ({
      rects,
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    }))
    .sort((a, b) => a.top - b.top)
  for (const row of bands) {
    const start = barePoints.find((point) => point.x < row.left - 4 && point.y > row.top - 6 && point.y < row.top + 12)
    const end = barePoints.find((point) => point.x > row.right + 4 && point.y < row.bottom + 6 && point.y > row.bottom - 12)
    if (start && end) return { start, end, row }
  }
  return null
}
const band = rowBand()
out.rowBandFound = Boolean(band)
if (band) {
  canvas.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, clientX: band.start.x, clientY: band.start.y, button: 0, buttons: 1, pointerId: 13 }),
  )
  await wait(70)
  globalThis.dispatchEvent(
    new PointerEvent('pointermove', { bubbles: true, clientX: band.end.x, clientY: band.end.y, buttons: 1, pointerId: 13 }),
  )
  await wait(160)
  globalThis.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, clientX: band.end.x, clientY: band.end.y, pointerId: 13 }),
  )
  await wait(220)
  out.rowBandSelected = qa('.plate--selected').length
  out.selectionMarks = qa('.plate--selected .plate__picked').length
  // What is being gathered has to be the loudest thing on the wall: the marks
  // say what is in the selection and the rest steps back behind it.
  out.selectionTicks = qa('.plate--selected .plate__picked svg').length
  out.selectionDimmed = qa('.plate').filter(
    (el) => !el.classList.contains('plate--selected') && Number(getComputedStyle(el).opacity) < 1,
  ).length
}

// Then what a band gathered can be put somewhere else in one gesture: pressing
// any plate that is in the selection carries all of them, and they land
// together — a step they cannot take is a step they all refuse.
const bandIds = qa('.plate--selected').map((el) => el.getAttribute('data-plate'))
stage('band')
out.bandIds = bandIds
if (bandIds.length > 1 && canvasBox) {
  const carried = bandIds.map((id) => elementOf(id).getBoundingClientRect())
  const others = qa('.plate')
    .filter((el) => !bandIds.includes(el.getAttribute('data-plate')))
    .map((el) => el.getBoundingClientRect())
  const step = Math.round(carried[0].width) + 8
  const lands = (dx) =>
    carried.every((rect) => {
      const x = rect.left + dx
      const y = rect.top + rect.height / 2
      const inside = x > canvasBox.left && x + rect.width < canvasBox.right && y > canvasBox.top && y < canvasBox.bottom
      const clear = !others.some((other) => x < other.right && x + rect.width > other.left && rect.top < other.bottom && rect.bottom > other.top)
      return inside && clear
    })
  // Moving the whole selection a step further than it has room for is the case
  // worth watching: the gesture still has to carry all of them, and all of them
  // still have to come back. That it cannot land is the board saying no, not
  // the gesture failing.
  const open = lands(step) ? step : lands(-step) ? -step : Math.round(step)
  out.batchStep = open
  out.batchLands = lands(open)
  const before = leftsOf(bandIds)
  const grip = carried[0]
  const from = { x: Math.round(grip.left + grip.width / 2), y: Math.round(grip.top + grip.height / 2) }
  elementOf(bandIds[0]).dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, clientX: from.x, clientY: from.y, button: 0, buttons: 1, pointerId: 12 }),
  )
  await wait(80)
  globalThis.dispatchEvent(
    new PointerEvent('pointermove', { bubbles: true, clientX: from.x + open, clientY: from.y, buttons: 1, pointerId: 12 }),
  )
  await wait(220)
  // The preview rides on animation frames; headless virtual time gives it none,
  // so this is reported rather than asserted. Where it lands is checked below.
  out.batchPreviewFollows = bandIds.every((id, index) => Math.round(elementOf(id).getBoundingClientRect().left) !== before[index])
  out.batchRefusedShown = Boolean(q('.drop-target--refused'))
  globalThis.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, clientX: from.x + open, clientY: from.y, pointerId: 12 }),
  )
  await wait(280)
  const after = leftsOf(bandIds)
  const deltas = after.map((left, index) => left - before[index])
  out.batchBefore = before
  out.batchAfter = after
  out.batchDeltas = deltas
  // What matters is that the selection moved as one thing: every plate took the
  // same step, and the step is the grid's own, not the pointer's raw pixels.
  out.batchMovedTogether = deltas.every((delta) => delta === deltas[0])
  out.batchKeptSpacing = new Set(deltas).size === 1 && deltas[0] !== 0
  out.batchSnapped = Math.abs(deltas[0] - open) <= 4
  key('keydown', { key: 'Escape' })
  await wait(200)
}

/* ------------------------------------------------------------------ */
/* The grid, and the hand the drag answers to                            */
/* ------------------------------------------------------------------ */

// The openings are the grid, so a plate has to be drawn where the openings are,
// and the lines drawn while dragging have to start at the same origin as they
// do. A plate that sits a few pixels off the line looks like it is standing
// between two squares even though it is in one.
stage('grid')
const gridMetrics = getComputedStyle(canvas)
const tileSize = Number(gridMetrics.getPropertyValue('--tile').replace('px', ''))
const pitchAcross = Number(gridMetrics.getPropertyValue('--pitch-x').replace('px', ''))
const pitchDown = Number(gridMetrics.getPropertyValue('--pitch-y').replace('px', ''))
out.gridTile = tileSize
out.gridPitch = [pitchAcross, pitchDown]
const gridLayer = q('.canvas__grid')
const gridLayerBox = gridLayer ? gridLayer.getBoundingClientRect() : null
out.gridLinesShareOrigin = Boolean(
  gridLayerBox &&
    Math.abs(gridLayerBox.left - canvasBox.left) < 1 &&
    Math.abs(gridLayerBox.top - canvasBox.top) < 1,
)
const offGridPlates = qa('.plate').filter((el) => {
  const rect = el.getBoundingClientRect()
  const dx = (rect.left - canvasBox.left) % pitchAcross
  const dy = (rect.top - canvasBox.top) % pitchDown
  return Math.min(dx, pitchAcross - dx) > 1 || Math.min(dy, pitchDown - dy) > 1
})
out.platesOffGrid = offGridPlates.length
out.plateOffsets = qa('.plate')
  .slice(0, 3)
  .map((el) => {
    const rect = el.getBoundingClientRect()
    return [Math.round((rect.left - canvasBox.left) * 10) / 10, Math.round((rect.top - canvasBox.top) * 10) / 10]
  })

// A drag answers the hand in two ways, and the landing is where both have to be
// true: the plate follows the pointer, and it does not move on to the next
// opening until the pointer is most of the way there. Half a pitch, and a shade
// over half, must leave a plate where it was; most of a pitch must hand it to
// the next opening.
//
// The middle of a drag cannot be read here: the preview of the landing rides on
// animation frames, and headless virtual time draws none of them, so what the
// hover would have shown is where the plate is put down instead.
stage('dragfeel')
const cellOf = (el) => {
  const rect = el.getBoundingClientRect()
  return {
    x: Math.round((rect.left - canvasBox.left) / pitchAcross),
    y: Math.round((rect.top - canvasBox.top) / pitchDown),
    w: Math.max(1, Math.round(rect.width / pitchAcross)),
    h: Math.max(1, Math.round(rect.height / pitchDown)),
  }
}
const cellsOf = (cell) => {
  const list = []
  for (let x = cell.x; x < cell.x + cell.w; x += 1) for (let y = cell.y; y < cell.y + cell.h; y += 1) list.push([x, y])
  return list
}
const others = (ignoreId) => qa('.plate').filter((el) => el.getAttribute('data-plate') !== ignoreId).map(cellOf)
const gridCols = Math.round(canvasBox.width / pitchAcross)
const gridRows = Math.round(canvasBox.height / pitchDown)
const stepIsFree = (cell, dx, dy, ignoreId) => {
  const shifted = { ...cell, x: cell.x + dx, y: cell.y + dy }
  if (shifted.x < 0 || shifted.y < 0 || shifted.x + shifted.w > gridCols || shifted.y + shifted.h > gridRows) return false
  return !others(ignoreId).some((other) =>
    cellsOf(shifted).some(([x, y]) => x >= other.x && x < other.x + other.w && y >= other.y && y < other.y + other.h),
  )
}
const dragPlate = qa('.plate--tile').find((el) => el.getBoundingClientRect().width > 60 && el.querySelector('.plate__icon'))
if (dragPlate) {
  const id = dragPlate.getAttribute('data-plate')
  const own = cellOf(dragPlate)
  // Whichever way there is room: a landing the board refuses would report the
  // hold as working when the board is the thing saying no.
  const way =
    [['across', 1, 0], ['across', -1, 0], ['down', 0, 1], ['up', 0, -1]].find(([, dx, dy]) =>
      stepIsFree(own, dx, dy, id),
    ) ?? null
  out.dragWay = way ? way[0] + (way[1] ? ' +1' : way[1] < 0 ? ' -1' : '') + (way[2] > 0 ? ' +1 row' : way[2] < 0 ? ' -1 row' : '') : null
  if (way) {
    // Each landing is measured from where the plate is *now*, and takes the
    // first free heading from there: repeated drags in one run would otherwise
    // be refused by the tile that the previous landing put in the way, and a
    // refusal would read as a drop that did not happen.
    const landAfter = async (fraction, settle = 0) => {
      const started = elementOf(id)
      const ownNow = started ? cellOf(started) : null
      const heading =
        ownNow &&
        ([['across', 1, 0], ['across', -1, 0], ['down', 0, 1], ['up', 0, -1]].find(([, hx, hy]) =>
          stepIsFree(ownNow, hx, hy, id),
        ) ??
          null)
      if (!heading) return { pickedUp: false, step: null, pitch: null, way: null }
      const [, hx, hy] = heading
      const step = hx !== 0 ? pitchAcross : pitchDown
      const box = started.getBoundingClientRect()
      const grab = { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
      const before = [Math.round(box.left), Math.round(box.top)]
      const dx = Math.round(step * fraction) * hx
      const dy = Math.round(step * fraction) * hy
      started.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          clientX: grab.x,
          clientY: grab.y,
          button: 0,
          buttons: 1,
          pointerId: 21,
        }),
      )
      await wait(90)
      globalThis.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: grab.x + dx,
          clientY: grab.y + dy,
          buttons: 1,
          pointerId: 21,
        }),
      )
      await wait(220)
      const held = q('.plate--dragging')
      const heldStyle = held ? getComputedStyle(held) : null
      const heldState = {
        transitionOff: heldStyle ? heldStyle.transitionProperty === 'none' : null,
        lifted: heldStyle ? Number(heldStyle.zIndex) >= 20 : null,
      }
      // The pointer stands still, and the frame loop keeps running: anything the
      // drop depends on being drawn has to survive this.
      const preview = Boolean(q('.drop-target'))
      if (settle) await wait(settle)
      globalThis.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          clientX: grab.x + dx,
          clientY: grab.y + dy,
          pointerId: 21,
        }),
      )
      await wait(320)
      const landed = elementOf(id)
      const after = landed ? landed.getBoundingClientRect() : null
      return {
        pickedUp: Boolean(held),
        transitionOff: heldState.transitionOff,
        lifted: heldState.lifted,
        preview,
        step: after ? [Math.round(after.left) - before[0], Math.round(after.top) - before[1]] : null,
        pitch: [hx * step, hy * step],
        way: heading,
      }
    }
    const under = await landAfter(0.4)
    const half = await landAfter(0.5)
    out.dragPicksUp = half.pickedUp
    // Nothing is drawn snapping to a cell while the plate is held: it floats
    // where the pointer is and only meets the grid when it is let go.
    out.dragNoPreview = Boolean(under.pickedUp && !under.preview && !half.preview)
    out.dragUnderHalfStep = under.step
    out.dragHeldStep = half.step
    out.dragNearlyStep = (await landAfter(0.6)).step
    const past = await landAfter(0.8)
    out.dragPastStep = past.step
    out.dragTransitionOff = past.transitionOff
    out.dragLifted = past.lifted
    // Short of half a cell it stays where it was; from half a cell on it takes
    // the next one. That is the whole of the snapping, and it happens on release.
    out.dragHoldsUnderHalf = Boolean(under.step && under.step[0] === 0 && under.step[1] === 0)
    out.dragTakesNearest = Boolean(
      half.step &&
        half.pitch &&
        half.step[0] === half.pitch[0] &&
        half.step[1] === half.pitch[1] &&
        out.dragHoldsUnderHalf,
    )
    out.dragCrossesAtMost = Boolean(
      past.step && past.pitch && (past.step[0] === past.pitch[0] || past.step[1] === past.pitch[1]),
    )
    // What was reported: carry a tile until the preview sits on the neighbouring
    // opening, then hold the pointer still and let go. The preview is drawn on
    // animation frames and a drop read out of that frame's variable is a drop
    // read out of nothing once the frame has run.
    const settled = await landAfter(0.8, 460)
    out.dragSettledStep = settled.step
    out.dragLandsAfterSettling = Boolean(
      settled.step && settled.pitch && (settled.step[0] === settled.pitch[0] || settled.step[1] === settled.pitch[1]),
    )
    key('keydown', { key: 'Escape' })
    await wait(160)
  }
}

// A pick is made with a band, because Ctrl plus a number opens what it gathered
// the moment Ctrl is released — that is what that gesture is for, and it is why
// the standing selection is the banded one. Delete and Return act on it.
//
// The bands are row bands: the first row for Delete, the last row for Return,
// because the first is gone by the time Return is tried.
const scanBare = () => {
  const spots = []
  for (let y = Math.round(canvasBox.top) + 3; y < canvasBox.bottom - 3; y += 6) {
    for (let x = Math.round(canvasBox.left) + 3; x < canvasBox.right - 3; x += 6) {
      if (!plateUnder(x, y)) spots.push({ x, y })
    }
  }
  return spots
}
const rowBandAt = (index) => {
  // The wall is scanned again rather than reused: plates have moved since the
  // first scan, and a press where a plate now stands drags that plate instead
  // of drawing a band.
  const spots = scanBare()
  const rows = new Map()
  for (const el of qa('.plate')) {
    const rect = el.getBoundingClientRect()
    const line = Math.round(rect.top / 8)
    rows.set(line, [...(rows.get(line) ?? []), rect])
  }
  const bands = [...rows.values()]
    .map((rects) => ({
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    }))
    .sort((a, b) => a.top - b.top)
  // Walked outwards from the row asked for towards the other end of the board,
  // because a row that touches the top or right edge of the wall has no bare
  // point beside it to start the band from.
  const order = []
  for (let step = 0; step < bands.length; step += 1) {
    const at = index < 0 ? bands.length - 1 - step : step
    if (bands[at]) order.push(bands[at])
  }
  for (const row of order) {
    const start = spots.find((point) => point.x < row.left - 4 && point.y > row.top - 6 && point.y < row.top + 12)
    const end = spots.find((point) => point.x > row.right + 4 && point.y < row.bottom + 6 && point.y > row.bottom - 12)
    if (start && end) return { start, end }
  }
  return null
}
// The whole wall, for the second try: a band that covers everything cannot miss
// for want of bare wall beside one particular row.
const wholeWall = () => {
  const spots = scanBare()
  if (spots.length < 2) return null
  const byDepth = [...spots].sort((a, b) => a.x + a.y - (b.x + b.y))
  return { start: byDepth[0], end: byDepth[byDepth.length - 1] }
}
const deleteKey = async (name, gather) => {
  const area = gather()
  if (!area) return null
  canvas.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: area.start.x,
      clientY: area.start.y,
      button: 0,
      buttons: 1,
      pointerId: 31,
    }),
  )
  await wait(70)
  globalThis.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      clientX: area.end.x,
      clientY: area.end.y,
      buttons: 1,
      pointerId: 31,
    }),
  )
  await wait(160)
  globalThis.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, clientX: area.end.x, clientY: area.end.y, pointerId: 31 }),
  )
  await wait(220)
  const pickedIds = qa('.plate--selected').map((el) => el.getAttribute('data-plate'))
  const before = qa('.plate').length
  key('keydown', { key: name })
  await wait(320)
  const stayed = pickedIds.filter((id) => document.querySelector('[data-plate="' + id + '"]'))
  return { picked: pickedIds.length, gone: before - qa('.plate').length, stayed }
}
// A tile whose picture and background are one thing: the card behind it goes,
// the picture fills the opening, and the opening keeps its rounded corners.
stage('seamless')
const seamPlate = qa('.plate--tile').find(
  (el) => el.querySelector('.plate__icon') && el.getBoundingClientRect().width > 60,
)
if (seamPlate) {
  const seamId = seamPlate.getAttribute('data-plate')
  menuOn(seamPlate)
  await wait(320)
  const seamRow = qa('.popover .field-row--check').find((row) => /填满磁贴|fills the tile/.test(row.textContent))
  out.seamRow = Boolean(seamRow)
  const seamTick = seamRow ? seamRow.querySelector('input[type="checkbox"]') : null
  if (seamTick) {
    seamTick.click()
    await wait(340)
  }
  key('keydown', { key: 'Escape' })
  await wait(260)
  const seamNow = elementOf(seamId)
  const seamTile = seamNow ? seamNow.querySelector('.plate__tile') : null
  const seamIcon = seamNow ? seamNow.querySelector('.plate__icon') : null
  out.seamPlateMarked = Boolean(seamNow && seamNow.classList.contains('plate--seamless'))
  out.seamIconFillsTile = Boolean(
    seamTile &&
      seamIcon &&
      Math.abs(seamIcon.getBoundingClientRect().width - seamTile.getBoundingClientRect().width) <= 2,
  )
  out.seamTileIsClear = seamTile ? style(seamTile).backgroundColor : null
  out.seamTileCorners = seamTile ? style(seamTile).borderRadius : null
  // Filling the tile must not be a way of losing part of the mark. contain
  // inscribes what arrives; cover, which this was, cut it down to the tile's
  // shape, so resizing the tile only changed which part of the mark went missing.
  out.seamIconFit = seamIcon ? style(seamIcon).objectFit : null
  out.seamIconWhole = Boolean(
    seamIcon &&
      seamTile &&
      Math.abs(seamIcon.getBoundingClientRect().height - seamTile.getBoundingClientRect().height) <= 2,
  )
  // The complaint was about resizing: a mark that had been told to fill its tile
  // has to keep filling it when the tile changes shape, rather than being cut to
  // whatever the new shape is.
  if (seamIcon && seamTile) {
    out.seamIconAtFirst = [Math.round(seamIcon.getBoundingClientRect().width), Math.round(seamIcon.getBoundingClientRect().height)]
    const chips = qa('.popover .span-choice')
    const other = chips.find((chip) => !chip.classList.contains('span-choice--on'))
    if (other) {
      other.click()
      await wait(520)
      const grown = elementOf(seamId)
      const grownTile = grown ? grown.querySelector('.plate__tile') : null
      const grownIcon = grown ? grown.querySelector('.plate__icon') : null
      out.seamIconAfterResize = grownIcon
        ? [Math.round(grownIcon.getBoundingClientRect().width), Math.round(grownIcon.getBoundingClientRect().height)]
        : null
      out.seamTileAfterResize = grownTile ? [Math.round(grownTile.getBoundingClientRect().width), Math.round(grownTile.getBoundingClientRect().height)] : null
      // Whole again, at the new size: both sides of the mark answered the tile
      // and neither of them was allowed to grow past it.
      out.seamIconFollowsSize = Boolean(
        grownIcon &&
          grownTile &&
          Math.abs(grownIcon.getBoundingClientRect().width - grownTile.getBoundingClientRect().width) <= 2 &&
          Math.abs(grownIcon.getBoundingClientRect().height - grownTile.getBoundingClientRect().height) <= 2 &&
          grownIcon.getBoundingClientRect().width !== seamIcon.getBoundingClientRect().width,
      )
    }
  }
}

// A pick is configured as one thing. Twelve tiles set one at a time is not an
// interface, so the menu opened on any plate in a pick reaches every plate in
// it — the name is the one thing that stays its own.
stage('batchset')
{
  const area = rowBandAt(0)
  let picked = []
  if (area) {
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: area.start.x,
        clientY: area.start.y,
        button: 0,
        buttons: 1,
        pointerId: 41,
      }),
    )
    await wait(70)
    globalThis.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: area.end.x,
        clientY: area.end.y,
        buttons: 1,
        pointerId: 41,
      }),
    )
    await wait(160)
    globalThis.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, clientX: area.end.x, clientY: area.end.y, pointerId: 41 }),
    )
    await wait(240)
    picked = qa('.plate--selected').map((el) => el.getAttribute('data-plate'))
  }
  out.batchSetPicked = picked.length
  if (picked.length > 1) {
    const sizeOf = (id) => {
      const node = elementOf(id)
      return node ? node.style.getPropertyValue('--icon-size').trim() || null : null
    }
    out.batchSetBefore = picked.map(sizeOf)
    const first = elementOf(picked[0])
    if (first) {
      menuOn(first)
      await wait(340)
      const row = qa('.popover .field-row').find((item) => /图标大小|Icon size/.test(item.textContent))
      out.batchSetRow = Boolean(row)
      out.batchSetNote = (q('.popover__note') || {}).textContent || null
      if (row) {
        setRange(row, 30)
        await wait(400)
      }
    }
    out.batchSetAfter = picked.map(sizeOf)
    out.batchSetReachesAll = out.batchSetAfter.every(
      (size, index) => size !== null && size !== out.batchSetBefore[index],
    )
    key('keydown', { key: 'Escape' })
    await wait(240)
  }
}

// A menu that is already open has to keep up with what it has just done. It
// reads the plate out of the board rather than holding the copy it was opened
// with, so the highlit choice follows the click instead of waiting for the menu
// to be closed and opened again.
stage('lively')
{
  const host = qa('.plate').find((el) => el.querySelector('.plate__icon'))
  const sizeLabel = () => {
    const on = q('.popover .span-choice--on')
    return on ? on.textContent.trim() : null
  }
  if (host) {
    menuOn(host)
    await wait(320)
    out.liveBefore = sizeLabel()
    const choice = qa('.popover .span-choice').find((el) => el.textContent.trim() !== out.liveBefore)
    if (choice) {
      out.liveTarget = choice.textContent.trim()
      choice.click()
      await wait(420)
    }
    out.liveAfter = sizeLabel()
    out.liveSwitches = Boolean(out.liveTarget && out.liveAfter === out.liveTarget && out.liveBefore !== out.liveAfter)

    // The same question asked of the other pickers in the menu: a press that
    // lands and a highlight that stays where it was is the report, and the size
    // grid is only where it was noticed.
    const byText = (re) => qa('.popover .buttons button').find((el) => re.test(el.textContent.trim()))
    const tileBtn = byText(/^(磁贴|Tile)$/)
    const circleBtn = byText(/^(圆形|Circle)$/)
    out.liveShapeBefore = tileBtn ? tileBtn.classList.contains('button--primary') : null
    if (circleBtn) {
      circleBtn.click()
      await wait(400)
    }
    out.liveShapeAfter = circleBtn ? circleBtn.classList.contains('button--primary') : null
    if (tileBtn) {
      tileBtn.click()
      await wait(340)
    }
    // The tile's own ground, asked the same question: a press has to move the
    // highlight and change what the tile stands on, while the menu stays open.
    const followBtn = byText(/跟随整板|Follow the board/)
    const clearBtn = byText(/^透明$|^Transparent$/)
    const hostTile = host.querySelector('.plate__tile')
    out.liveFillPlate = hostTile ? hostTile.getAttribute('data-fill') : null
    out.liveFillButtons = qa('.popover .buttons button').map((el) => [
      el.textContent.trim(),
      el.classList.contains('button--primary'),
    ])
    out.liveFillBefore = followBtn ? followBtn.classList.contains('button--primary') : null
    if (clearBtn) {
      clearBtn.click()
      await wait(420)
    }
    out.liveFillAfter = clearBtn ? clearBtn.classList.contains('button--primary') : null
    out.liveFillWorn = hostTile ? hostTile.getAttribute('data-fill') : null
    out.liveFillSwitches = Boolean(
      out.liveFillBefore && out.liveFillAfter && out.liveFillWorn === 'none',
    )
    if (followBtn) {
      followBtn.click()
      await wait(380)
    }
    out.liveFillHandedBack = hostTile ? hostTile.getAttribute('data-fill') : null
    if (autoFill) {
      autoFill.click()
      await wait(320)
    }
    key('keydown', { key: 'Escape' })
    await wait(240)
  }
}

/* ------------------------------------------------------------------ */
/* A bar is a plate                                                    */
/* ------------------------------------------------------------------ */

// A search bar is mostly field, so what is left of it has to carry it: the
// engine mark, the button, the edge of the card. And the click the browser
// dispatches when such a drag ends belongs to the drag, not to the mark that
// happens to be under the pointer.
stage('bardrag')
{
  const barEl = qa('.plate--search').find((el) => el.getBoundingClientRect().width > 0)
  out.barDragFound = Boolean(barEl)
  if (barEl) {
    const id = barEl.getAttribute('data-plate')
    // A bar eight cells wide has nowhere to go on a board that is full of
    // things: narrowing it is what makes room, and it is also the size picker
    // this stage needs to watch for the highlight following the press.
    const widthOf = () => (elementOf(id) ? Math.round(elementOf(id).getBoundingClientRect().width) : null)
    menuOn(barEl)
    await wait(320)
    const chips = qa('.popover .span-choice')
    out.barSizeChips = chips.map((el) => el.textContent.trim())
    out.barSizeBefore = chips.find((el) => el.classList.contains('span-choice--on'))?.textContent.trim() ?? null
    out.barWidthBefore = widthOf()
    const narrower = chips.find((el) => el.textContent.trim() !== out.barSizeBefore)
    if (narrower) {
      out.barSizeTarget = narrower.textContent.trim()
      narrower.click()
      await wait(460)
    }
    const after = qa('.popover .span-choice')
    out.barSizeAfter = after.find((el) => el.classList.contains('span-choice--on'))?.textContent.trim() ?? null
    out.barWidthAfter = widthOf()
    out.barSizeSwitches = Boolean(
      out.barSizeTarget && out.barSizeAfter === out.barSizeTarget && out.barSizeAfter !== out.barSizeBefore,
    )
    key('keydown', { key: 'Escape' })
    await wait(260)

    const handle = (elementOf(id) ? elementOf(id) : barEl).querySelector('.search__medal--button')
    out.barDragHandle = handle ? handle.className.split(' ')[0] : null
    if (handle) {
      // Which way there is room is something to find out by trying: a bar is
      // several cells wide and, once its height has been set between two rows,
      // taller than the whole cells it is measured in.
      const tried = []
      for (const [, hx, hy] of [['across', 1, 0], ['across', -1, 0], ['down', 0, 1], ['up', 0, -1]]) {
        const step = hx !== 0 ? pitchAcross : pitchDown
        const hold = handle.getBoundingClientRect()
        const box = elementOf(id) ? elementOf(id).getBoundingClientRect() : barEl.getBoundingClientRect()
        const from = { x: Math.round(hold.left + hold.width / 2), y: Math.round(hold.top + hold.height / 2) }
        const to = { x: from.x + step * hx, y: from.y + step * hy }
        const before = [Math.round(box.left), Math.round(box.top)]
        handle.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, ...from, button: 0, buttons: 1, pointerId: 41 }),
        )
        await wait(90)
        globalThis.dispatchEvent(
          new PointerEvent('pointermove', { bubbles: true, ...to, buttons: 1, pointerId: 41 }),
        )
        await wait(300)
        out.barDragPickedUp = out.barDragPickedUp || Boolean(q('.plate--search.plate--dragging'))
        out.barDragNoPreview = out.barDragNoPreview !== false && !q('.drop-target')
        globalThis.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, ...to, pointerId: 41 }))
        await wait(400)
        const now = elementOf(id)
        const seen = now ? now.getBoundingClientRect() : null
        const move = seen ? [Math.round(seen.left) - before[0], Math.round(seen.top) - before[1]] : null
        // The click the browser fires on release lands on the mark the bar was
        // carried by; a panel opening there would be the press read twice.
        out.barDragNoPanel = out.barDragNoPanel !== false && !q('.engines')
        tried.push(hx !== 0 ? (hx > 0 ? '→' : '←') : hy > 0 ? '↓' : '↑')
        if (move && Math.abs(move[0]) + Math.abs(move[1]) > 4) {
          out.barDragStep = move
          out.barDragHeading = tried[tried.length - 1]
          break
        }
      }
      out.barDragTried = tried
      out.barDragMoved = Boolean(out.barDragStep && Math.abs(out.barDragStep[0]) + Math.abs(out.barDragStep[1]) > 4)
      key('keydown', { key: 'Escape' })
      await wait(200)
    }
  }
}

/* ------------------------------------------------------------------ */
/* A bar's own card                                                    */
/* ------------------------------------------------------------------ */

// The bar is a plate, so it can answer for itself instead of taking the board's
// answer: its card is the field's background, and a bar left as glass while the
// tiles stay solid is the same question one plate down.
stage('backdrop')
{
  const barEl = qa('.plate--search').find((el) => el.getBoundingClientRect().width > 0)
  if (barEl) {
    const id = barEl.getAttribute('data-plate')
    const tileOf = () => (elementOf(id) ? elementOf(id).querySelector('.plate__tile') : null)
    menuOn(barEl)
    await wait(340)
    const chips = qa('.popover .buttons button')
    out.barOwnFillChips = chips.map((el) => [el.textContent.trim(), el.classList.contains('button--primary')])
    out.barOwnFillBefore = tileOf() ? tileOf().getAttribute('data-fill') : null
    const glass = chips.find((el) => /^透明$|^Transparent$/.test(el.textContent.trim()))
    const own = chips.find((el) => /跟随整板|Follow the board/.test(el.textContent.trim()))
    out.barOwnFollowChip = Boolean(own)
    if (glass) {
      glass.click()
      await wait(420)
    }
    out.barOwnFillNone = tileOf() ? tileOf().getAttribute('data-fill') : null
    out.barOwnFillGround = tileOf() ? style(tileOf()).backgroundColor : null
    out.barOwnFillBlur = tileOf() ? style(tileOf()).backdropFilter : null
    out.barOwnWhileOpen = Boolean(q('.popover'))
    // Written down as the bar's own answer: a record that kept only the board's
    // would hand the bar its material back the next time it was opened.
    await wait(900)
    const record = globalThis.__shim
      ? (globalThis.__shim.store.state ?? null)
      : (() => { try { return JSON.parse(localStorage.getItem('tabula:state') ?? 'null') } catch { return null } })()
    out.barOwnFillSaved = record
      ? (((record.board.plates || []).find((plate) => plate.id === id) || {}).fill ?? null)
      : null
    if (own) {
      own.click()
      await wait(400)
    }
    out.barOwnFillBack = tileOf() ? tileOf().getAttribute('data-fill') : null
    key('keydown', { key: 'Escape' })
    await wait(220)
  }
}

/* ------------------------------------------------------------------ */
/* A widget as a mark                                                  */
/* ------------------------------------------------------------------ */

// Bookmarks and history have a page behind them, so on the board they can be
// the list they read or one mark standing for it — drawn here like a shortcut's
// mark, named under it like a tile's.
stage('widgeticon')
{
  let hosts = qa('[data-plate]').filter((el) => el.querySelector('.plate__stack'))
  out.widgetStackPlates = hosts.map((el) => el.getAttribute('aria-label'))
  if (hosts.length === 0) {
    // The walk is not necessarily on the page the sample board put its reading
    // widgets on, so one is hung here: the add path is worth covering anyway.
    qa('.chrome--top .chip')[0].click()
    await wait(300)
    const widgetMode = qa('.popover button').find((b) => /^小组件$|^Widgets$/.test(b.textContent.trim()))
    if (widgetMode) {
      widgetMode.click()
      await wait(260)
    }
    const bookmarksMode = qa('.popover button').find((b) => /^书签$|^Bookmarks$/.test(b.textContent.trim()))
    out.widgetAddedFromMenu = Boolean(bookmarksMode)
    if (bookmarksMode) {
      bookmarksMode.click()
      await wait(520)
    }
    hosts = qa('[data-plate]').filter((el) => el.querySelector('.plate__stack'))
  }
  const host = hosts.find((el) => /书签|Bookmarks/.test(el.getAttribute('aria-label') ?? '')) ?? hosts[0]
  out.widgetIconHost = Boolean(host)
  if (host) {
    const id = host.getAttribute('data-plate')
    menuOn(host)
    await wait(320)
    const markBtn = qa('.popover button').find((el) => /^(图标|Mark)$/.test(el.textContent.trim()))
    const listBtn = qa('.popover button').find((el) => /^(列表|List)$/.test(el.textContent.trim()))
    out.widgetStyleButtons = Boolean(markBtn && listBtn)
    out.widgetListOnFirst = Boolean(listBtn && listBtn.classList.contains('button--primary'))
    if (markBtn) {
      markBtn.click()
      await wait(420)
    }
    const now = elementOf(id)
    out.widgetGlyph = Boolean(now && now.querySelector('.widget-glyph'))
    out.widgetListGone = Boolean(now && !now.querySelector('.plate__stack'))
    out.widgetNamed = Boolean(now && now.querySelector('.plate__name'))
    out.widgetName = now && now.querySelector('.plate__name') ? now.querySelector('.plate__name').textContent.trim() : null
    out.widgetMarkOn = markBtn ? markBtn.classList.contains('button--primary') : null
    out.widgetStyleSwitches = out.widgetMarkOn === true
    if (listBtn) {
      listBtn.click()
      await wait(380)
    }
    const back = elementOf(id)
    out.widgetListBack = Boolean(back && back.querySelector('.plate__stack'))
    key('keydown', { key: 'Escape' })
    await wait(220)
  }
}

/* ------------------------------------------------------------------ */
/* Site icons                                                          */
/* ------------------------------------------------------------------ */

// Read at the end of the walk rather than waited for at the start: an icon is a
// request to somebody else's server, and a walk that waits on one is a walk that
// hangs when that server does. Anything still in flight by now is reported as
// such instead of being waited on.
stage('icons')
const marks = qa('.plate__icon')
const reached = (src) => {
  try {
    return new URL(src).host
  } catch {
    return src
  }
}
out.marks = marks.map((img) => {
  const box = img.parentElement
  return {
    from: reached(img.src),
    arrived: img.complete && img.naturalWidth ? img.naturalWidth + 'x' + img.naturalHeight : 'pending',
    drawn: Math.round(img.getBoundingClientRect().width),
    cap: img.style.getPropertyValue('--icon-cap') || null,
    box: box ? Math.round(Math.min(box.clientWidth, box.clientHeight)) : null,
  }
})
const arrived = out.marks.filter((mark) => mark.arrived !== 'pending')
out.marksArrived = arrived.length + '/' + out.marks.length
out.marksWithinStretch = arrived.every((mark) => mark.drawn <= Number(mark.arrived.split('x')[0]) * 2 + 1)
// Marks the cap actually held back: their picture would have filled the slot and
// was drawn smaller instead, because filling it would have meant stretching.
out.marksCapped = arrived.filter((mark) => mark.cap && Number.parseFloat(mark.cap) < mark.box).length
out.letterMarks = qa('.plate__initial, .folder__initial').length
out.iconsFrom = [...new Set(out.marks.map((mark) => mark.from))]

stage('storage')
out.storageKey = Object.keys(localStorage)
out.apiCalls = globalThis.__shim ? globalThis.__shim.calls : []
out.shimStoreKeys = globalThis.__shim ? Object.keys(globalThis.__shim.store) : []
// The board is only worth anything if it comes back the way it was left: read
// the saved record back and say what the new settings and bars look like in it.
const saved = globalThis.__shim
  ? (globalThis.__shim.store.state ?? null)
  : (() => {
      try {
        return JSON.parse(localStorage.getItem('tabula:state') ?? 'null')
      } catch {
        return null
      }
    })()
out.savedSchema = saved ? saved.schema : null
out.savedPageViews = saved ? (saved.board.pages || []).map((page) => page.view ?? null) : null
out.savedSettings = saved
  ? {
      tileFill: saved.settings.tileFill,
      backgroundMaterial: saved.settings.backgroundMaterial,
      iconMaterial: saved.settings.iconMaterial,
      focusKey: saved.settings.focusKey,
      showNames: saved.settings.showNames,
      iconSize: saved.settings.iconSize,
      tileRadius: saved.settings.tileRadius,
      imageRadius: saved.settings.imageRadius,
      engineMark: saved.settings.engineMark,
      enginePlacement: saved.settings.enginePlacement,
    iconProvider: saved.settings.iconProvider,
    }
  : null
out.savedBars = saved
  ? (saved.board.plates || [])
      .filter((plate) => plate.kind === 'search')
      .map((plate) => ({ hidden: Boolean(plate.hidden), w: plate.w, h: plate.h, form: plate.form ?? null }))
  : null
out.savedFolders = saved
  ? (saved.board.plates || [])
      .filter((plate) => plate.kind === 'folder')
      .map((folderPlate) => ({
        w: folderPlate.w,
        h: folderPlate.h,
        holds: (saved.board.plates || []).filter((plate) => plate.folderId === folderPlate.id).length,
      }))
  : null
out.savedTileAnswers = saved
  ? (saved.board.plates || [])
      .filter((plate) => plate.fill || plate.backgroundMaterial || plate.iconMaterial || plate.radius !== undefined || plate.showName === false)
      .map((plate) => ({
        fill: plate.fill ?? null,
        background: plate.backgroundMaterial ?? null,
        mark: plate.iconMaterial ?? null,
        radius: plate.radius ?? null,
        showName: plate.showName ?? null,
      }))
  : null
// A greeting's own setting is part of the record, or the words come back set
// the way the interface is rather than the way they were written.
out.savedText = saved
  ? (saved.board.plates || [])
      .filter((plate) => plate.widget === 'text')
      .map((plate) => plate.text ?? null)
  : null
// A tile that answers for its own mark, and a tile that is nothing but picture:
// both are written to the record or neither survives a reopen.
// What a tile answered about its own mark, which now includes how far the mark is
// pulled out of its own shape: a stretch that does not survive a reopen is a
// setting the user made and lost.
out.savedMarkOverrides = saved
  ? (saved.board.plates || [])
      .filter(
        (plate) =>
          plate.iconSize !== undefined ||
          plate.markOffset !== undefined ||
          plate.iconStretchX !== undefined ||
          plate.iconStretchY !== undefined,
      )
      .map((plate) => ({
        id: plate.id,
        iconSize: plate.iconSize ?? null,
        markOffset: plate.markOffset ?? null,
        stretchX: plate.iconStretchX ?? null,
        stretchY: plate.iconStretchY ?? null,
      }))
  : null
out.savedSeamless = saved ? (saved.board.plates || []).filter((plate) => plate.bleed).length : null

// Delete and Return go last, because they take plates off the wall and
// everything above reads the board whole.
stage('deletekey')
out.deletedByDelete = await deleteKey('Delete', () => rowBandAt(0))
out.deletedByEnter = await deleteKey('Enter', wholeWall)
// What is being asked of both keys is that the pick goes away whole: every plate
// that was picked is gone, and none of the plates beside it was touched.
out.deletesWholeSelection = Boolean(
  out.deletedByDelete &&
    out.deletedByDelete.picked > 0 &&
    out.deletedByDelete.stayed.length === 0 &&
    out.deletedByEnter &&
    out.deletedByEnter.picked > 0 &&
    out.deletedByEnter.stayed.length === 0,
)

out.errors = errors
document.title = 'probe-done'
document.body.setAttribute('data-probe', JSON.stringify(out))
`

/**
 * One short section of the walk: what a tile does while it is carried.
 *
 * The tile is held where the pointer is and meets the grid only when it is let
 * go, so the two things to check are that nothing is drawn snapping to a cell
 * during the drag (`preview`), and that the drop rounds to the nearest cell —
 * short of half a cell it stays put, from half a cell on it takes the next one.
 */
const QUICK_SCRIPT = HELPERS + `
await until(() => qa('.plate').length > 0)
// The walk's own readers live in the walk; this section carries the few it
// needs so the two can be edited without dragging each other along. They are
// read after the board is up, because there is no canvas before that.
const elementOf = (id) => document.querySelector('[data-plate="' + id + '"]')
const canvasEl = document.querySelector('.canvas')
const canvasNum = (name) => Number.parseFloat(getComputedStyle(canvasEl).getPropertyValue(name)) || 0
const pitchAcross = canvasNum('--pitch-x')
const pitchDown = canvasNum('--pitch-y')
const cellOf = (el) => {
  const own = el.getBoundingClientRect()
  const base = canvasEl.getBoundingClientRect()
  return {
    x: Math.round((own.left - base.left) / pitchAcross),
    y: Math.round((own.top - base.top) / pitchDown),
    w: Math.round(own.width / pitchAcross),
    h: Math.round(own.height / pitchDown),
  }
}
const gridCols = Math.round(canvasEl.getBoundingClientRect().width / pitchAcross)
const gridRows = Math.round(canvasEl.getBoundingClientRect().height / pitchDown)
const stepIsFree = (cell, hx, hy, ignoreId) => {
  const box = { x: cell.x + hx, y: cell.y + hy, w: cell.w, h: cell.h }
  // A step off the board is not a step the board will take.
  if (box.x < 0 || box.y < 0 || box.x + box.w > gridCols || box.y + box.h > gridRows) return false
  return !qa('[data-plate]').some((el) => {
    if (el.getAttribute('data-plate') === ignoreId) return false
    const other = cellOf(el)
    return box.x < other.x + other.w && other.x < box.x + box.w && box.y < other.y + other.h && other.y < box.y + box.h
  })
}
out.booted = qa('.plate').length > 0
out.quickPlates = qa('.plate').length
stage('quick')
const tile = qa('.plate--tile').find((el) => el.getBoundingClientRect().width > 60 && el.querySelector('.plate__icon'))
out.quickPlate = tile ? tile.getAttribute('data-plate') : null
if (tile) {
  const id = tile.getAttribute('data-plate')
  const run = async (fraction) => {
    const start = elementOf(id)
    if (!start) return null
    const cell = cellOf(start)
    const heading =
      ([['across', 1, 0], ['across', -1, 0], ['down', 0, 1], ['up', 0, -1]].find(([, hx, hy]) =>
        stepIsFree(cell, hx, hy, id),
      ) ?? null)
    if (!heading) return null
    const [, hx, hy] = heading
    const pitch = hx !== 0 ? pitchAcross : pitchDown
    const box = elementOf(id).getBoundingClientRect()
    const from = { clientX: Math.round(box.left + box.width / 2), clientY: Math.round(box.top + box.height / 2) }
    const at = [Math.round(box.left), Math.round(box.top)]
    const to = {
      clientX: from.clientX + Math.round(pitch * fraction) * hx,
      clientY: from.clientY + Math.round(pitch * fraction) * hy,
    }
    elementOf(id).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, ...from, button: 0, buttons: 1, pointerId: 71 }))
    await wait(90)
    globalThis.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, ...to, buttons: 1, pointerId: 71 }))
    await wait(260)
    const preview = Boolean(q('.drop-target'))
    globalThis.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, ...to, pointerId: 71 }))
    const placedAtOnce = elementOf(id) ? elementOf(id).style.left + ' ' + elementOf(id).style.top : null
    await wait(360)
    const landed = elementOf(id)
    const after = landed.getBoundingClientRect()
    const saved = (() => {
      try {
        const state = JSON.parse(localStorage.getItem('tabula:state') || 'null')
        const plate = state && state.board ? state.board.plates.find((candidate) => candidate.id === id) : null
        return plate ? [plate.x, plate.y] : null
      } catch (error) {
        return null
      }
    })()
    return { preview, step: [Math.round(after.left) - at[0], Math.round(after.top) - at[1]], placedAtOnce, saved, from, to, pitch }
  }
  out.quickPitch = [pitchAcross, pitchDown]
  out.quickUnder = await run(0.45)
  out.quickHalf = await run(0.55)
  out.quickPast = await run(0.8)
  out.quickNoPreview = Boolean(
    out.quickUnder && out.quickHalf && out.quickPast && !out.quickUnder.preview && !out.quickHalf.preview && !out.quickPast.preview,
  )
  // The landing shadow is the ask: it has to be on screen for the whole carry,
  // not just at the moment of release.
  out.quickShowsLanding = Boolean(out.quickUnder && out.quickHalf && out.quickPast && out.quickUnder.preview && out.quickHalf.preview && out.quickPast.preview)
  out.quickStaysUnderHalf = Boolean(out.quickUnder && out.quickUnder.step[0] === 0 && out.quickUnder.step[1] === 0)
  out.quickTakesNearest = Boolean(
    out.quickHalf && Math.abs(out.quickHalf.step[0]) + Math.abs(out.quickHalf.step[1]) > 4 && out.quickStaysUnderHalf,
  )
}
key('keydown', { key: 'Escape' })
await wait(200)

/** Opens a plate's menu, which is where its own settings live. */
const menuOn = (el) => {
  const box = el.getBoundingClientRect()
  el.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      clientX: Math.round(box.left + box.width / 2),
      clientY: Math.round(box.top + 12),
    }),
  )
}
const chipOn = () => {
  const on = q('.popover .span-choice--on')
  return on ? on.textContent.trim() : null
}

try {
  // The size a tile is set to has to be the one drawn as chosen — this is the
  // highlight that used to stay behind until the menu was closed and reopened.
  const sizing = qa('.plate--tile').find((el) => el.querySelector('.plate__icon') && el.getBoundingClientRect().width > 60)
  if (sizing) {
    menuOn(sizing)
    await wait(520)
    out.sizeChips = qa('.popover .span-choice').map((el) => el.textContent.trim())
    const was = chipOn()
    const other = qa('.popover .span-choice').find((el) => el.textContent.trim() !== was)
    if (other) {
      out.sizeWas = was
      out.sizeTarget = other.textContent.trim()
      other.click()
      await wait(520)
      out.sizeAfter = chipOn()
      out.sizeSwitches = Boolean(out.sizeWas && out.sizeAfter && out.sizeAfter !== out.sizeWas)
    }
    key('keydown', { key: 'Escape' })
    await wait(320)
  }

  // Let go at the edge of the board: the tile has to end up on the cell the
  // shadow was showing. That is the whole complaint — it looked aligned and
  // then went back where it came from.
  const edgeTile = qa('.plate--tile').find((el) => el.querySelector('.plate__icon') && el.getBoundingClientRect().width > 60)
  if (edgeTile) {
    const id = edgeTile.getAttribute('data-plate')
    const start = elementOf(id).getBoundingClientRect()
    const cell = cellOf(elementOf(id))
    const from = { clientX: Math.round(start.left + start.width / 2), clientY: Math.round(start.top + start.height / 2) }
    const to = { clientX: from.clientX - Math.round((cell.x + 3) * pitchAcross), clientY: from.clientY }
    elementOf(id).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, ...from, button: 0, buttons: 1, pointerId: 73 }))
    await wait(100)
    globalThis.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, ...to, buttons: 1, pointerId: 73 }))
    await wait(280)
    const shadow = q('.drop-target')
    const hint = shadow ? shadow.getBoundingClientRect() : null
    out.edgeHintAt = hint ? [Math.round(hint.left), Math.round(hint.top)] : null
    globalThis.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, ...to, pointerId: 73 }))
    await wait(460)
    const landed = elementOf(id)
    const after = landed ? landed.getBoundingClientRect() : null
    out.edgeFrom = [cell.x, cell.y]
    out.edgeTo = landed ? [cellOf(landed).x, cellOf(landed).y] : null
    out.edgeLandsOnHint = Boolean(
      hint && after && Math.abs(Math.round(after.left) - Math.round(hint.left)) <= 2 && Math.abs(Math.round(after.top) - Math.round(hint.top)) <= 2,
    )
  }

  // A widget shown as a list and as a mark: the mark is a small square of its
  // own kind, drawn as strokes, so it has no icon to fetch and no row to draw.
  // A bookmarks or history widget keeps its rows in a plate__stack; the plate
  // around them wears no modifier of its own for that.
  const widget = qa('[data-plate]').find((el) => el.querySelector('.plate__stack'))
  out.widgetHost = Boolean(widget)
  out.widgetLabel = widget ? widget.getAttribute('aria-label') : null
  if (widget) {
    menuOn(widget)
    await wait(520)
    const buttons = qa('.popover .buttons button')
    out.widgetStyleButtons = buttons.map((el) => el.textContent.trim())
    const mark = buttons.find((el) => /^(图标|Mark)$/.test(el.textContent.trim()))
    if (mark) {
      mark.click()
      await wait(520)
      out.widgetGlyph = Boolean(q('.widget-glyph'))
      out.widgetNamed = Boolean(widget.querySelector('.plate__name'))
      out.widgetListGone = !widget.querySelector('.plate__stack')
    }
    key('keydown', { key: 'Escape' })
    await wait(320)
  }

  // The bar is a plate like the rest, so the same hold-and-move has to carry
  // it. Its field is left alone — the strip beside it is where the hand goes.
  const bar = q('.plate--search')
  out.quickBar = bar ? bar.getAttribute('data-plate') : null
  if (bar) {
    const row = (() => {
      const cell = cellOf(bar)
      const ways = [['down', 0, 1], ['down', 0, 2], ['across', 1, 0], ['across', -1, 0], ['up', 0, -1]]
      // A free opening is preferred, but a bar is eight cells wide and a board
      // with anything on it rarely has one: two rows down is tried anyway, since
      // what is being checked is that the hand carries the bar, not that the
      // board has room for it.
      return ways.find(([, hx, hy]) => stepIsFree(cell, hx, hy, bar.getAttribute('data-plate'))) ?? ['down', 0, 2]
    })()
    if (row) {
      const [, hx, hy] = row
      // The press goes on the bar's own card rather than on its engine button:
      // the button has a press of its own, and a probe is not the place to
      // decide which of the two a hand would have meant.
      const handle = bar.querySelector('.plate__tile') || bar
      const spot = handle.getBoundingClientRect()
      const from = { clientX: Math.round(spot.left + 6), clientY: Math.round(spot.top + spot.height / 2) }
      const was = cellOf(bar)
      const barBox = bar.getBoundingClientRect()
      const barAt = { x: parseFloat(bar.style.left) || 0, y: parseFloat(bar.style.top) || 0 }
      const arm = { x: Math.round(pitchAcross * 1.2) * hx, y: Math.round(pitchDown * 1.2) * hy }
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, ...from, button: 0, buttons: 1, pointerId: 72 }))
      await wait(100)
      // Three moves, reading back after each: a bar that never moved has to be
      // told apart from a move that never arrived.
      out.quickBarTicks = []
      for (const share of [0.4, 0.8, 1]) {
        globalThis.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            clientX: from.clientX + Math.round(arm.x * share),
            clientY: from.clientY + Math.round(arm.y * share),
            buttons: 1,
            pointerId: 72,
          }),
        )
        await wait(200)
        const nowBar = q('.plate--search')
        out.quickBarTicks.push(nowBar ? [nowBar.style.left, nowBar.style.top] : null)
      }
      globalThis.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          clientX: from.clientX + arm.x,
          clientY: from.clientY + arm.y,
          buttons: 1,
          pointerId: 72,
        }),
      )
      await wait(280)
      const shadow = q('.drop-target')
      const hint = shadow ? shadow.getBoundingClientRect() : null
      const carried = q('.plate--search')
      // Centres rather than edges: a plate being carried is drawn at 1.05×, which
      // moves the edge of a 646px bar by sixteen pixels all by itself — its
      // middle is the one point the lift leaves alone.
      const carriedBox = carried ? carried.getBoundingClientRect() : null
      const middle = (box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
      out.quickBarFollows = Boolean(
        carriedBox &&
          Math.abs(Math.round(middle(carriedBox).x) - Math.round(middle(barBox).x) - arm.x) <= 4 &&
          Math.abs(Math.round(middle(carriedBox).y) - Math.round(middle(barBox).y) - arm.y) <= 4,
      )
      // Whether the board thinks it is carrying anything is half the answer:
      // a bar that did not lift is a different defect from one that lifted and
      // was drawn in the wrong place.
      out.quickBarLifted = carried ? /plate--dragging/.test(String(carried.className)) : null
      out.quickBarClass = carried ? String(carried.className).slice(0, 80) : null
      // What the bar was actually told while it was in the air: the plate the
      // board is carrying, where it was put, and where it drew itself.
      out.quickBarTrace = carried
        ? {
            id: carried.getAttribute('data-plate'),
            pressed: bar.getAttribute('data-plate'),
            inline: [carried.style.left, carried.style.top],
            before: [barAt.x, barAt.y],
            rect: [Math.round(carriedBox.left), Math.round(carriedBox.top), Math.round(carriedBox.width), Math.round(carriedBox.height)],
            wasRect: [Math.round(barBox.left), Math.round(barBox.top), Math.round(barBox.width), Math.round(barBox.height)],
            arm,
            drop: shadow ? [Math.round(hint.left), Math.round(hint.top)] : null,
          }
        : null
      globalThis.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          clientX: from.clientX + arm.x,
          clientY: from.clientY + arm.y,
          pointerId: 72,
        }),
      )
      await wait(460)
      const landed = q('.plate--search')
      out.quickBarHandled = handle.className.toString()
      out.quickBarHeading = row[0]
      out.quickBarStep = landed ? [cellOf(landed).x - was.x, cellOf(landed).y - was.y] : null
      out.quickBarMoved = Boolean(out.quickBarStep && (out.quickBarStep[0] !== 0 || out.quickBarStep[1] !== 0))
      out.quickBarStayedOnScreen = Boolean(landed)
      out.quickBarLandsOnHint = Boolean(
        hint && landed && Math.abs(Math.round(landed.getBoundingClientRect().left) - Math.round(hint.left)) <= 2 && Math.abs(Math.round(landed.getBoundingClientRect().top) - Math.round(hint.top)) <= 2,
      )
      key('keydown', { key: 'Escape' })
      await wait(320)
    }

    // The bar is a plate, so it stands on a ground like any other: the answers
    // have to reach the bar's own card, and the card and the field inside it stay
    // two grounds rather than one.
    menuOn(q('.plate--search'))
    await wait(520)
    // Every button in the bar's menu, not just the ones in a buttons row: the
    // ground row is one of those, and the row the bar answers for itself is
    // another, so asking for that class alone would miss whichever comes second.
    const barButtons = qa('.popover button')
    out.barFillChips = barButtons.map((el) => el.textContent.trim())
    const readBar = () => {
      const tileEl = q('.plate--search .plate__tile')
      const field = q('.plate--search .search')
      return tileEl
        ? {
            fill: tileEl.getAttribute('data-fill'),
            ground: style(tileEl).backgroundColor,
            backdrop: style(tileEl).backdropFilter,
            fieldFill: field ? field.getAttribute('data-field-fill') : null,
            fieldGround: field ? style(field).backgroundColor : null,
            inline: tileEl.getAttribute('style'),
          }
        : null
    }
    const barBefore = readBar()
    const barClear = barButtons.find((el) => /^(透明|Transparent)$/.test(el.textContent.trim()))
    if (barClear) {
      barClear.click()
      await wait(420)
    }
    const barAfter = readBar()
    const barCard = barButtons.find((el) => /^(默认颜色|The default colour)$/.test(el.textContent.trim()))
    if (barCard) {
      barCard.click()
      await wait(420)
    }
    out.barFill = { before: barBefore, clear: barAfter, back: readBar() }
    // Which rules in the sheet speak about a tile's fill at all, in the order the
    // cascade reads them: a bar that keeps its card with the answer set to
    // none at all is a rule further down the sheet taking the background back.
    out.barFillRules = (() => {
      const found = []
      for (const sheet of Array.from(document.styleSheets)) {
        let rules = null
        try {
          rules = sheet.cssRules
        } catch {
          continue
        }
        for (const rule of Array.from(rules || [])) {
          if (rule.selectorText && /data-fill/.test(rule.selectorText)) {
            found.push(rule.selectorText + ' {' + rule.style.cssText.slice(0, 90) + '}')
          }
        }
      }
      return found
    })()
    out.barTakesGround = Boolean(barBefore && barAfter && barAfter.fill === 'none' && barAfter.ground !== barBefore.ground)
    out.barFillRestored = Boolean(barBefore && out.barFill.back && out.barFill.back.ground === barBefore.ground)

    // The colour inside the bar, which is the setting the user meant by the
    // background: the field's own ground, chosen separately from the card's.
    const chipButtons = qa('.popover .buttons button')
    const fillNow = () => {
      const field = q('.plate--search .search')
      return field ? { attr: field.getAttribute('data-field-fill'), colour: style(field).backgroundColor } : null
    }
    out.fieldChips = chipButtons.map((el) => el.textContent.trim())
    out.fieldAuto = fillNow()
    const noneChip = chipButtons.find((el) => /^(透明|Transparent)$/.test(el.textContent.trim()))
    if (noneChip) {
      noneChip.click()
      await wait(420)
      out.fieldNone = fillNow()
      out.fieldNoneWorks = Boolean(out.fieldAuto && out.fieldNone && out.fieldNone.attr === 'none' && out.fieldNone.colour !== out.fieldAuto.colour)
    }
    const customChip = chipButtons.find((el) => /^(自定义|Custom)$/.test(el.textContent.trim()))
    if (customChip) {
      customChip.click()
      await wait(420)
      out.fieldCustom = fillNow()
      out.fieldCustomHasColour = Boolean(q('.popover input[type="color"]'))
    }
    key('keydown', { key: 'Escape' })
    await wait(320)
  }
  // Headless virtual time paints no frames, and the app draws everything it is
  // carrying on an animation frame — so a walk that does not stand in for one
  // sees a board where nothing ever moves. A frame is a timer here.
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16)
  out.rafShimmed = true
  // Transitions are put down for the same reason: a headless clock does not
  // advance them, so a plate that is drawn somewhere new measures as if it had
  // never left. What is being asked is where it was drawn, not how it got there.
  const freeze = document.createElement('style')
  freeze.textContent = '*,*::before,*::after{transition:none !important;animation:none !important}'
  document.head.appendChild(freeze)
  out.frozen = true

  // Filling the tile must not be a way of losing part of the mark. cover cut
  // what arrived down to the tile's shape, so a square mark in a wide tile was
  // missing its top and bottom — and resizing the tile only changed which part
  // went missing.
  const seam = qa('.plate--tile').find((el) => el.querySelector('.plate__icon') && el.getBoundingClientRect().width > 60)
  if (seam) {
    const id = seam.getAttribute('data-plate')
    const seat = seam.getBoundingClientRect()
    seam.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: seat.left + 30, clientY: seat.top + 14 }))
    await wait(520)
    const row = qa('.popover .field-row--check').find((el) => /填满磁贴|fills the tile/.test(el.textContent))
    const tick = row ? row.querySelector('input[type="checkbox"]') : null
    out.seamRow = Boolean(tick)
    if (tick) {
      if (!tick.checked) tick.click()
      await wait(520)
      const holder = elementOf(id)
      const tile = holder ? holder.querySelector('.plate__tile') : null
      const icon = holder ? holder.querySelector('.plate__icon') : null
      const boxOf = (el) => (el ? el.getBoundingClientRect() : null)
      out.seamMarked = Boolean(holder && holder.classList.contains('plate--seamless'))
      out.seamFit = icon ? style(icon).objectFit : null
      // What the mark is actually being told to be, down to the declarations
      // that decide it: a mark taller than its tile is being clipped.
      if (icon) {
        const rules = style(icon)
        out.seamMarkRules = {
          width: rules.width,
          height: rules.height,
          maxWidth: rules.maxWidth,
          maxHeight: rules.maxHeight,
          aspectRatio: rules.aspectRatio,
          inline: icon.getAttribute('style'),
          natural: [icon.naturalWidth, icon.naturalHeight],
          tile: tile ? [Math.round(tile.getBoundingClientRect().width), Math.round(tile.getBoundingClientRect().height)] : null,
          mark: [Math.round(icon.getBoundingClientRect().width), Math.round(icon.getBoundingClientRect().height)],
          seamlessOnTile: tile ? tile.className.toString().slice(0, 60) : null,
          plateClass: holder ? holder.className.toString().slice(0, 80) : null,
        }
      }
      // A chip that is certainly not the size the tile is: the shape of the box
      // says which one it wears, and a chip of the same shape would be a no-op.
      const whole = boxOf(tile)
      const mark = boxOf(icon)
      // Filling is not the mark grown to the tile: it is the mark's own edge
      // colour spread under it as the tile's ground, with the mark left at the
      // size the board gave it. So the bed is what has to answer for the tile —
      // the same box, all four sides — and the mark has to stay inside it.
      const bed = holder ? holder.querySelector('.plate__bed--mark') : null
      const bedBox = boxOf(bed)
      out.seamBed = bed
        ? {
            size: style(bed).backgroundSize,
            filter: style(bed).filter,
            box: bedBox ? [Math.round(bedBox.width), Math.round(bedBox.height)] : null,
          }
        : null
      // Filling is not the mark grown to the tile: the mark keeps its size and the
      // file under it is spread across the opening, so what has to be checked is
      // that the bed *covers* the tile and the mark itself does not spill out.
      out.seamFills = Boolean(
        whole &&
          bedBox &&
          bedBox.width >= whole.width - 1 &&
          bedBox.height >= whole.height - 1 &&
          mark &&
          mark.width <= whole.width + 1 &&
          mark.height <= whole.height + 1,
      )
      // A size that is certainly not the one it wears now, so the resize is real.
      const wide = whole && whole.width > whole.height + 8
      const tall = whole && whole.height > whole.width + 8
      const wore = wide ? '1×2' : tall ? '2×1' : '2×1'
      const chip = qa('.popover .span-choice').find((el) => el.textContent.trim() === wore)
      out.seamChips = qa('.popover .span-choice').map((el) => el.textContent.trim())
      out.seamChipPicked = chip ? chip.textContent.trim() : null
      out.seamResized = false
      if (chip) {
        chip.click()
        await wait(560)
        const after = elementOf(id)
        const afterTile = boxOf(after ? after.querySelector('.plate__tile') : null)
        const afterIcon = boxOf(after ? after.querySelector('.plate__icon') : null)
        const afterBed = boxOf(after ? after.querySelector('.plate__bed--mark') : null)
        out.seamSizeThen = whole ? [Math.round(whole.width), Math.round(whole.height)] : null
        out.seamSizeAfter = afterTile ? [Math.round(afterTile.width), Math.round(afterTile.height)] : null
        out.seamMarkAfter = afterIcon ? [Math.round(afterIcon.width), Math.round(afterIcon.height)] : null
        out.seamBedAfter = afterBed ? [Math.round(afterBed.width), Math.round(afterBed.height)] : null
        out.seamFillAfterResize = Boolean(
          afterTile &&
            afterBed &&
            afterBed.width >= afterTile.width - 1 &&
            afterBed.height >= afterTile.height - 1,
        )
        out.seamResized = Boolean(afterTile && whole && (Math.abs(afterTile.width - whole.width) > 4 || Math.abs(afterTile.height - whole.height) > 4))
      }
      // The corners of a filled mark are still the tile's to set: the slider for
      // them used to be inert here, because the filled rule pinned the radius to
      // zero and the tile behind it was transparent either way.
      const radiusRow = qa('.popover input[type="range"]').find((el) => {
        const row = el.closest('.field-row') || el.parentElement
        return row && /圆角|corner|radius/i.test(row.textContent || '')
      })
      out.seamRadiusRow = Boolean(radiusRow)
      if (radiusRow) {
        out.seamRadiusBefore = style(icon).borderRadius
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(radiusRow, '40')
        radiusRow.dispatchEvent(new Event('input', { bubbles: true }))
        radiusRow.dispatchEvent(new Event('change', { bubbles: true }))
        await wait(520)
        const after = elementOf(id)
        const afterIcon = after ? after.querySelector('.plate__icon') : null
        out.seamRadiusAfter = afterIcon ? style(afterIcon).borderRadius : null
        out.seamRadiusWorks = Boolean(afterIcon && parseFloat(style(afterIcon).borderRadius) > 2)
      }
      // Where the mark stands on the tile, and that the mark keeps its size while
      // it moves: the placement is a share of the mark itself, so a mark made
      // larger afterwards keeps the place it was given.
      const rowFor = (pattern) =>
        qa('.popover input[type="range"]').find((el) => {
          const row = el.closest('.field-row') || el.parentElement
          return row && pattern.test(row.textContent || '')
        })
      const acrossRow = rowFor(/左右位置|Icon across/)
      const downRow = rowFor(/上下位置|Icon up and down/)
      out.offsetRows = { across: Boolean(acrossRow), down: Boolean(downRow) }
      const markCentre = () => {
        const holder = elementOf(id)
        const icon = holder ? holder.querySelector('.plate__icon') : null
        const tile = holder ? holder.querySelector('.plate__tile') : null
        if (!icon || !tile) return null
        const box = icon.getBoundingClientRect()
        const seat = tile.getBoundingClientRect()
        return {
          w: Math.round(box.width),
          h: Math.round(box.height),
          dx: Math.round(box.left + box.width / 2 - (seat.left + seat.width / 2)),
          dy: Math.round(box.top + box.height / 2 - (seat.top + seat.height / 2)),
        }
      }
      const drag = async (row, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(row, String(value))
        row.dispatchEvent(new Event('input', { bubbles: true }))
        row.dispatchEvent(new Event('change', { bubbles: true }))
        await wait(420)
      }
      out.offsetBefore = markCentre()
      if (acrossRow && downRow) {
        await drag(acrossRow, 40)
        out.offsetAcross = markCentre()
        await drag(downRow, -40)
        out.offsetDown = markCentre()
        out.offsetMovesMark = Boolean(
          out.offsetBefore &&
            out.offsetAcross &&
            out.offsetDown &&
            out.offsetAcross.dx - out.offsetBefore.dx > 4 &&
            out.offsetDown.dy - out.offsetBefore.dy < -4,
        )
        // Four tenths of a mark along each axis, in the order the two were asked
        // for: the mark moved by the share, not by a number of cells.
        out.offsetShareOfMark = Boolean(
          out.offsetBefore &&
            out.offsetAcross &&
            Math.abs(out.offsetAcross.dx - out.offsetBefore.dx - out.offsetBefore.w * 0.4) <= 3,
        )
        out.offsetKeepsSize = Boolean(
          out.offsetBefore && out.offsetAcross && out.offsetBefore.w === out.offsetAcross.w && out.offsetBefore.h === out.offsetAcross.h,
        )
        // And the size is still its own answer: the placement is a share of the
        // mark, so a mark made smaller afterwards stands the same share away —
        // which is exactly what "keeps its place after the size changes" means.
        const sizeRow = rowFor(/图标大小|Icon size/)
        if (sizeRow) {
          const before = markCentre()
          await drag(sizeRow, 30)
          const grown = markCentre()
          out.offsetShrunkWithSize = Boolean(before && grown && grown.w < before.w)
          out.offsetShareHeld = Boolean(
            before &&
              grown &&
              before.w > 0 &&
              grown.w > 0 &&
              Math.abs(grown.dx / grown.w - before.dx / before.w) <= 0.06,
          )
        }
      }
    }
    key('keydown', { key: 'Escape' })
    await wait(320)
  }

  // A selection on the move. Two things are being asked of it: that it follow
  // the hand exactly (the complaint was that it drifted), and that it say where
  // it will land.
  const board = q('.canvas')
  const groupTiles = qa('.plate--tile')
    .filter((el) => {
      const w = el.getBoundingClientRect().width
      return w > 60 && w < 130 && el.querySelector('.plate__icon')
    })
    .slice(0, 3)
  if (board && groupTiles.length === 3) {
    const boxes = groupTiles.map((el) => el.getBoundingClientRect())
    const left = Math.min.apply(null, boxes.map((b) => b.left)) - 14
    const top = Math.min.apply(null, boxes.map((b) => b.top)) - 14
    const right = Math.max.apply(null, boxes.map((b) => b.right)) + 14
    const bottom = Math.max.apply(null, boxes.map((b) => b.bottom)) + 14
    board.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: left, clientY: top, button: 0, buttons: 1, pointerId: 91 }))
    await wait(160)
    globalThis.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: right, clientY: bottom, buttons: 1, pointerId: 91 }))
    await wait(220)
    globalThis.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: right, clientY: bottom, pointerId: 91 }))
    await wait(320)
    const placed = () =>
      qa('.plate--selected').map((el) => [
        el.getAttribute('data-plate'),
        Math.round(el.getBoundingClientRect().left),
        Math.round(el.getBoundingClientRect().top),
      ])
    out.groupSelected = qa('.plate--selected').length
    const pick = q('.plate--selected') || groupTiles[0]
    const spot = pick.getBoundingClientRect()
    const heldAt = { clientX: Math.round(spot.left + spot.width / 2), clientY: Math.round(spot.top + spot.height / 2) }
    const armBy = { x: 190, y: 120 }
    const before = placed()
    // One plate read three ways: the box it is in, the offset it is drawn at,
    // and the transform on it. If a carried plate looks still, one of these
    // will say which of them did not change.
    const shapeOf = () => {
      const one = q('.plate--selected')
      if (!one) return null
      return {
        left: Math.round(one.getBoundingClientRect().left),
        offset: one.style.left,
        transform: one.style.transform,
        cls: String(one.className).slice(0, 70),
      }
    }
    const wasShape = shapeOf()
    pick.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, ...heldAt, button: 0, buttons: 1, pointerId: 92 }))
    await wait(140)
    globalThis.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: heldAt.clientX + armBy.x, clientY: heldAt.clientY + armBy.y, buttons: 1, pointerId: 92 }),
    )
    await wait(340)
    const after = placed()
    out.groupFollowed =
      before.length > 1 &&
      before.every((row, index) => Boolean(after[index]) && Math.abs(after[index][1] - row[1] - armBy.x) <= 6 && Math.abs(after[index][2] - row[2] - armBy.y) <= 6)
    out.groupMoved = before.length > 1 && before.some((row, index) => Boolean(after[index]) && (after[index][1] !== row[1] || after[index][2] !== row[2]))
    out.groupHints = qa('.drop-target--group').length
    out.groupShape = { before: wasShape, after: shapeOf() }
    // A move with nowhere to go still lifts, and says so in grey rather than in
    // the accent: one shadow per plate either way.
    out.groupRefusedHints = qa('.drop-target--refused').length
    globalThis.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: heldAt.clientX + armBy.x, clientY: heldAt.clientY + armBy.y, pointerId: 92 }))
    await wait(420)
    out.groupAfterDrop = placed()
  }
} catch (error) {
  // One section throwing must not cost the others their evidence.
  out.quickError = String((error && error.message) || error)
}

await wait(300)
out.errors = errors
document.title = 'probe-done'
document.body.setAttribute('data-probe', JSON.stringify(out))
`

/**
 * The same board, opened a second time from an older record.
 *
 * The walk above never reloads, so it cannot see what survives a reopen, nor
 * what a record written by an earlier build turns into. This seeds one and asks
 * for the board to reflect it: a folded bar back as a bar, a hidden bar still
 * hidden, a mark size carried over, a tile's own fill and name kept, and a
 * folder showing what is filed inside it.
 */
const SEED_SCRIPT = HELPERS + `
await until(() => qa('.plate').length > 0)
out.booted = qa('.plate').length > 0
out.seedBars = qa('.plate--search').length
// Folding is gone, so no plate may come back in that form.
out.seedFolded = qa('.plate--folded').length
out.seedBarRepaired = (() => {
  const node = q('.plate--search')
  if (!node) return null
  const rect = node.getBoundingClientRect()
  return rect.width > rect.height ? 'wide' : Math.round(rect.width) + 'x' + Math.round(rect.height)
})()
// The record as the board rewrote it, not the one it was handed: the store
// writes back on a delay, so this waits past it before reading. Anything still
// named here that the board no longer has was left behind by the migration.
await wait(900)
const saved = globalThis.__shim
  ? (globalThis.__shim.store.state ?? null)
  : (() => { try { return JSON.parse(localStorage.getItem('tabula:state') ?? 'null') } catch { return null } })()
out.seedSavedSettings = saved ? Object.keys(saved.settings).sort() : null
// Names from earlier builds: a folded plate's form, a tile's own material, and the
// "grows with the tile" answer at the board's level or the tile's. The migration
// takes each of them off the record rather than leaving it there for the next
// version to trip over — an answer nothing asks for is worse than no answer.
out.seedRetiredKeys = saved
  ? [
      ...Object.keys(saved.settings).filter((name) => /^(material|iconFollow|iconScale)$/.test(name)),
      ...(saved.board.plates || []).flatMap((plate) =>
        Object.keys(plate).filter((name) => /^(form|foldSpan|material|iconFollow)$/.test(name)),
      ),
    ]
  : null
// A multiplier from the old format becomes a fraction of the tile, and the
// service the old version shipped with gives way to the new default.
out.seedIconSize = style(document.documentElement).getPropertyValue('--icon-size').trim()
out.seedIconProvider = saved ? saved.settings.iconProvider : null
out.seedIconRadius = style(document.documentElement).getPropertyValue('--icon-radius').trim()
out.seedPlates = qa('[data-plate]').map((el) => {
  const rect = el.getBoundingClientRect()
  return {
    id: el.getAttribute('data-plate'),
    label: el.getAttribute('aria-label'),
    cls: el.className,
    w: Math.round(rect.width),
    name: Boolean(el.querySelector(':scope > .plate__name')),
  }
})
// One tile asked for its name while the board said no names: the tile wins.
out.seedNames = qa('.plate__name').length
out.seedFills = qa('.plate__tile[data-fill]').map((el) => el.getAttribute('data-fill'))
out.seedFillColour = (() => {
  const node = q('.plate__tile[data-fill="custom"]')
  return node ? style(node).backgroundColor : null
})()
// A folder draws what it holds, and says how many there are.
out.seedWords = (() => {
  const node = q('.plate .prose')
  if (!node) return null
  const box = style(node)
  return {
    text: node.textContent.trim(),
    font: node.dataset.font,
    align: node.dataset.align,
    size: box.fontSize,
    weight: box.fontWeight,
  }
})()
out.seedSavedWords = saved
  ? ((saved.board.plates || []).find((plate) => plate.id === 'seeded-words') || {}).text ?? null
  : null
out.seedFolderMarks = qa('.plate--folder .folder__cell').length
// Where the marks stand after a reopen: the board's pair on every tile, and the
// one tile's own pair where it named one — the two have to stay apart.
out.seedOffsets = qa('[data-plate]').map((el) => ({
  id: el.getAttribute('data-plate'),
  x: el.style.getPropertyValue('--mark-x'),
  y: el.style.getPropertyValue('--mark-y'),
}))
out.seedSavedOffset = saved ? saved.settings.markOffset ?? null : null
// And the tile that placed its own mark is drawn there, not where the board put
// it: one mark, moved four tenths of itself along the tile.
out.seedOwnPlacement = (() => {
  const holder = q('[data-plate="seeded-link"]')
  const icon = holder ? holder.querySelector('.plate__icon') : null
  const tile = holder ? holder.querySelector('.plate__tile') : null
  if (!icon || !tile) return null
  const box = icon.getBoundingClientRect()
  const seat = tile.getBoundingClientRect()
  return {
    w: Math.round(box.width),
    dx: Math.round(box.left + box.width / 2 - (seat.left + seat.width / 2)),
    dy: Math.round(box.top + box.height / 2 - (seat.top + seat.height / 2)),
  }
})()
out.seedOwnPlacementHeld = Boolean(
  out.seedOwnPlacement && out.seedOwnPlacement.w > 0 && Math.abs(out.seedOwnPlacement.dx - out.seedOwnPlacement.w * 0.4) <= 3,
)
out.seedBoardPlacement = (() => {
  const holder = qa('[data-plate]').find((el) => el.querySelector('.plate__icon') && el.getAttribute('data-plate') !== 'seeded-link')
  const icon = holder ? holder.querySelector('.plate__icon') : null
  const tile = holder ? holder.querySelector('.plate__tile') : null
  if (!icon || !tile) return null
  const box = icon.getBoundingClientRect()
  const seat = tile.getBoundingClientRect()
  return {
    w: Math.round(box.width),
    dx: Math.round(box.left + box.width / 2 - (seat.left + seat.width / 2)),
    dy: Math.round(box.top + box.height / 2 - (seat.top + seat.height / 2)),
  }
})()
out.seedBoardPlacementHeld = Boolean(
  out.seedBoardPlacement &&
    Math.abs(out.seedBoardPlacement.dx - out.seedBoardPlacement.w * -0.25) <= 3 &&
    Math.abs(out.seedBoardPlacement.dy - out.seedBoardPlacement.w * 0.3) <= 4,
)
out.seedFolderLabel = (() => {
  const node = q('.plate--folder')
  return node ? node.getAttribute('aria-label') : null
})()
// The keys are still read off the board: the focus key was moved, so this is
// the key that has to put the caret in the field.
key('keydown', { key: '/' })
await wait(300)
out.seedInputAfterSlash = Boolean(q('.plate--search .search__input'))
out.focusTarget = document.activeElement ? (document.activeElement.className || document.activeElement.tagName).toString() : 'none'
out.errors = errors
document.title = 'probe-done'
document.body.setAttribute('data-probe', JSON.stringify(out))
`

/**
 * A Firefox-shaped extension API, installed before the bundle runs so the
 * platform layer detects it. Everything it is asked for is written down, so the
 * report can say which calls the interface actually made.
 */
const FIREFOX_SHIM = `
(function () {
  var calls = []
  // A saved record put there ahead of the bundle is what this backend is
  // holding, so the reopen walk can run against the real code path too.
  var store = globalThis.__seedState ? { state: globalThis.__seedState } : {}
  function note(name, payload) {
    calls.push(name + ' ' + JSON.stringify(payload === undefined ? null : payload))
  }
  var now = Date.now()
  var browser = {
    runtime: {
      id: 'tabula@probe',
      getURL: function (path) { return 'moz-extension://probe/' + path },
    },
    storage: {
      local: {
        get: function () { note('storage.local.get', null); return Promise.resolve(Object.assign({}, store)) },
        set: function (items) { Object.assign(store, items); note('storage.local.set', Object.keys(items)); return Promise.resolve() },
        remove: function (keys) { keys.forEach(function (k) { delete store[k] }); note('storage.local.remove', keys); return Promise.resolve() },
      },
    },
    bookmarks: {
      getTree: function () {
        note('bookmarks.getTree', null)
        return Promise.resolve([{
          id: 'root________', title: '',
          children: [
            { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [
              { id: 'b1', type: 'bookmark', title: 'DeepSeek', url: 'https://chat.deepseek.com/', dateAdded: now },
              { id: 'b2', type: 'bookmark', title: 'GitHub', url: 'https://github.com/', dateAdded: now },
            ] },
            { id: 'unfiled_____', title: 'Other Bookmarks', children: [
              { id: 'b3', type: 'bookmark', title: 'Plywood', url: 'https://en.wikipedia.org/wiki/Plywood', dateAdded: now },
            ] },
          ],
        }])
      },
    },
    history: {
      search: function (query) {
        note('history.search', { text: query.text, maxResults: query.maxResults })
        return Promise.resolve([
          { id: 'h1', url: 'https://en.wikipedia.org/wiki/Plywood', title: 'Plywood', lastVisitTime: now - 90000, visitCount: 3 },
          { id: 'h2', url: 'https://github.com/', title: 'GitHub — pointer events', lastVisitTime: now - 400000, visitCount: 1 },
          { id: 'h3', url: 'https://news.ycombinator.com/', title: 'Hacker News', lastVisitTime: now - 90000000, visitCount: 2 },
        ])
      },
    },
    tabs: {
      create: function (props) { note('tabs.create', props); return Promise.resolve({ id: 7 }) },
    },
  }
  globalThis.__shim = { calls: calls, store: store }
  globalThis.browser = browser
})()
`

function pickBrowser() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
  if (!found) throw new Error('no chrome or edge found to run the probe in')
  return found
}

/**
 * A record saved by an older build, for the reopen walk.
 *
 * It holds every shape the format has moved away from: a bar saved in the
 * folded form that no longer exists, a bar saved hidden, a mark size saved as a
 * multiplier, a tile with its own fill, a tile that overrode names, and a
 * folder with something filed inside it.
 */
const SEED = {
  schema: 1,
  board: {
    version: 1,
    pages: [{ id: 'bay-1', name: 'Seeded', tint: 'blue' }],
    plates: [
      {
        id: 'seeded-folded',
        pageId: 'bay-1',
        kind: 'search',
        shape: 'tile',
        w: 1,
        h: 1,
        x: 0,
        y: 0,
        form: 'icon',
        foldSpan: { w: 8, h: 1 },
        engineId: 'bing',
      },
      {
        id: 'seeded-hidden',
        pageId: 'bay-1',
        kind: 'search',
        shape: 'tile',
        w: 8,
        h: 1,
        x: 0,
        y: 2,
        form: 'bar',
        hidden: true,
      },
      {
        id: 'seeded-link',
        pageId: 'bay-1',
        kind: 'link',
        shape: 'tile',
        // Wide enough for a name, so the tile that asks for one while the board
        // says no names is something the check can actually see.
        w: 2,
        h: 1,
        x: 6,
        y: 4,
        title: 'Seeded link',
        url: 'https://example.com/',
        fill: { kind: 'none' },
        showName: true,
        // A tile that placed its own mark, while the board placed every other.
        markOffset: { x: 40, y: 0 },
      },
      {
        id: 'seeded-quiet',
        pageId: 'bay-1',
        kind: 'link',
        shape: 'tile',
        w: 1,
        h: 1,
        x: 8,
        y: 4,
        title: 'Seeded quiet',
        url: 'https://example.org/',
        // A tile that still names what it was made of, from when tiles had
        // materials of their own. What it was standing on has to come across; the
        // name for it has to go.
        material: { kind: 'custom', colour: '#205030' },
        showName: false,
        // A tile that used to be able to stop following its tile. Nothing asks
        // that any more, and the answer is dropped rather than kept: a record
        // holding one would keep a mark small with no control left to say so.
        iconFollow: 0,
      },
      {
        id: 'seeded-words',
        pageId: 'bay-1',
        kind: 'widget',
        shape: 'tile',
        w: 3,
        h: 2,
        x: 0,
        y: 3,
        widget: 'text',
        // Values no current board would write: a face it does not have, a size
        // past its range, a weight off its list, an alignment that is not one of
        // its three. Coming back repaired is what makes the range a guarantee
        // rather than a limit on the controls alone.
        text: { body: 'Seeded words', font: 'comic', size: 400, weight: 900, align: 'middle', tint: 'auto' },
      },
      {
        id: 'seeded-folder',
        pageId: 'bay-1',
        kind: 'folder',
        shape: 'tile',
        w: 2,
        h: 2,
        x: 11,
        y: 0,
        title: 'Seeded folder',
      },
      {
        id: 'seeded-folder-a',
        pageId: 'bay-1',
        kind: 'link',
        shape: 'tile',
        w: 1,
        h: 1,
        x: 13,
        y: 3,
        title: 'Filed one',
        url: 'https://one.example/',
        folderId: 'seeded-folder',
      },
      {
        id: 'seeded-folder-b',
        pageId: 'bay-1',
        kind: 'link',
        shape: 'tile',
        w: 1,
        h: 1,
        x: 14,
        y: 3,
        title: 'Filed two',
        url: 'https://two.example/',
        folderId: 'seeded-folder',
      },
    ],
  },
  settings: {
    tileFill: { kind: 'custom', colour: '#123456' },
    // And the same name at the board's level, next to the word that replaced it:
    // the migration has to take the old one off the record even when both are
    // there, or the next version keeps reading a question nothing asks.
    material: { kind: 'frosted' },
    showNames: false,
    focusKey: '/',
    // Where the board places its marks, for the tiles that did not place their
    // own. It has to come back on the reopen as the same pair of numbers.
    markOffset: { x: -25, y: 30 },
    iconScale: 1.5,
    // Same story at the board's level: a record that held this would be keeping
    // an answer the interface no longer asks for.
    iconFollow: 1,
    // The service the previous version shipped with. A record that still names
    // it should come back following the new default instead.
    iconProvider: 'cccyun',
  },
}

function extract(dom) {
  const match = dom.match(/data-probe="([^"]*)"/)
  if (!match) return null
  const json = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  return JSON.parse(json)
}

/**
 * A module script will not load over `file:`, so the build has to be served
 * even for a one-off check. This is the smallest thing that will do it.
 */
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
}

/** The last section the page said it was starting, for a walk that stalls. */
let lastStage = null

function serveDist() {
  return new Promise((ready) => {
    const server = createServer(async (request, response) => {
      const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname)).replace(/^[/\\]+/, '')
      if (path.startsWith('__stage/')) {
        lastStage = path.slice('__stage/'.length)
        response.writeHead(204).end()
        return
      }
      try {
        const body = await readFile(join(dist, path || 'index.html'))
        response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
        response.end(body)
      } catch {
        response.writeHead(404).end('no')
      }
    })
    server.listen(0, '127.0.0.1', () => ready({ server, port: server.address().port }))
  })
}

/**
 * Chrome's virtual clock stops while something is outstanding, and the budget
 * that is supposed to end the run stops with it — a walk can therefore wait
 * forever. Real time is the only thing left that always moves, so the child is
 * given a wall-clock leash as well.
 */
function run(browser, args, leash = 240000) {
  return new Promise((done) => {
    const child = spawn(browser, args, { windowsHide: true })
    let out = ''
    let err = ''
    let stalled = false
    const timer = setTimeout(() => {
      stalled = true
      try {
        child.kill('SIGKILL')
      } catch {
        /* it may already be gone */
      }
    }, leash)
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (err += chunk))
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ code, out, err, stalled })
    })
  })
}

const index = await readFile(join(dist, 'index.html'), 'utf8')
const useFirefox = process.argv.includes('--firefox')
/**
 * A board made of one material, for looking at rather than asserting about.
 *
 * `--mat=<kind>` draws the sample board in that material — the same board the
 * ordinary shot shows, so two shots differ in the one thing being asked about.
 * `--own=<kind>` then gives the bar and one tile their own answer, `--wall=`
 * says what is behind them (glass over a flat fill and glass over a photograph
 * are different claims, and only a picture tells them apart), and `--theme=`
 * draws the other side of the palette. `--mark=<kind>` is the pane the marks
 * stand on, which is a setting of its own, and `--markown=<kind>` is one tile
 * answering for its own marks through its menu. The record is deliberately
 * partial: what it does not name comes from the board's own defaults.
 */
const matArg = process.argv.find((arg) => arg.startsWith('--mat='))
const matKind = matArg ? matArg.slice('--mat='.length) : null
// `--mark=<kind>` is the other half of the same question: what the marks stand
// on, which is a setting of its own rather than a part of the tile's. `--markown=`
// is one tile answering for its own marks through its menu, which is the claim
// that the two can be set apart.
const markArg = process.argv.find((arg) => arg.startsWith('--mark='))
const markKind = markArg ? markArg.slice('--mark='.length) : null
const markOwnArg = process.argv.find((arg) => arg.startsWith('--markown='))
const markOwnKind = markOwnArg ? markOwnArg.slice('--markown='.length) : null
// `--round` turns one tile round through its own menu, because a round tile holds
// a round chip and that is a picture rather than a sentence.
const round = process.argv.includes('--round')
// `--shelf` puts a few wallpapers on the user's own shelf, which is what the
// previews, the removal buttons and the rule for taking turns are drawn for.
const shelfWanted = process.argv.includes('--shelf')
// `--ground=<none|auto|custom>` is the *colour* the background layer is coloured
// with, which is a different question from its material.
const groundArg = process.argv.find((arg) => arg.startsWith('--ground='))
const groundKind = groundArg ? groundArg.slice('--ground='.length) : null
// `--engines=both` draws a bar that has both ways of changing engines at once.
const enginesArg = process.argv.find((arg) => arg.startsWith('--engines='))
const enginesWant = enginesArg ? enginesArg.slice('--engines='.length) : null
// A temporary look at why a shot looks the way it does: the numbers go into the
// picture, where a screenshot can be read.
const why = process.argv.includes('--why')
const ownArg = process.argv.find((arg) => arg.startsWith('--own='))
const ownKind = ownArg ? ownArg.slice('--own='.length) : null
const wallArg = process.argv.find((arg) => arg.startsWith('--wall='))
const wallSpec = wallArg ? wallArg.slice('--wall='.length) : 'flat:mist'
// `--wallmat=<kind>` is what the wallpaper itself is made of, and `--wallblur=<px>`
// how far out of focus it is left. They belong to the wall rather than to any tile,
// which is why they are asked for here and not through a tile's menu.
const wallMatArg = process.argv.find((arg) => arg.startsWith('--wallmat='))
const wallMatKind = wallMatArg ? wallMatArg.slice('--wallmat='.length) : null
const wallBlurArg = process.argv.find((arg) => arg.startsWith('--wallblur='))
const wallBlurPx = wallBlurArg ? Number(wallBlurArg.slice('--wallblur='.length)) || 0 : null
// `--rail=<h|v>-<edge>-<align>` is where the page rail is asked to sit: written
// as a word rather than as flags because a rail is three answers at once and the
// question only makes sense as a whole. `h-top-end` is along the top edge, right.
const railArg = process.argv.find((arg) => arg.startsWith('--rail='))
const railSpec = railArg ? railArg.slice('--rail='.length).split('-') : null
const railWanted = railSpec
  ? {
      // The record's own words: a rail is either a row along the top or the
      // bottom, or a column down the left or the right.
      orientation: railSpec[0] === 'v' ? 'column' : 'row',
      edge: railSpec[1],
      align: railSpec[2],
    }
  : null
// `--say=<text>` is what the search bar asks for before anything is typed in it.
const sayArg = process.argv.find((arg) => arg.startsWith('--say='))
const sayText = sayArg ? sayArg.slice('--say='.length) : null
const themeArg = process.argv.find((arg) => arg.startsWith('--theme='))
const themeName = themeArg ? themeArg.slice('--theme='.length) : null
// `--size=<percent>` is the board's mark size, and `--fill` turns on filling
// through a tile's own menu. They are apart because the whole question of a
// filled tile is what the size control does to it, and that is only visible with
// one of them held still while the other moves.
const sizeArg = process.argv.find((arg) => arg.startsWith('--size='))
const sizeName = sizeArg ? sizeArg.slice('--size='.length) : null
const sizePercent = sizeName ? Number(sizeName) || 0 : null
const fill = process.argv.includes('--fill')
// `--stretch=<percent>` fills a tile and then says how far the mark may be
// stretched to do it — the slider that asks the question the fill leaves open, so
// a shot of a filled tile is a shot of an answer rather than of the default.
const stretchArg = process.argv.find((arg) => arg.startsWith('--stretch='))
const stretchPercent = stretchArg ? Number(stretchArg.slice('--stretch='.length)) || 0 : null
// `--shot` draws the plain build instead of walking it, which is what to reach
// for when a change needs looking at rather than asserting about.
const shot = process.argv.includes('--shot') || Boolean(matKind) || Boolean(markKind) || Boolean(markOwnKind) || Boolean(wallMatKind) || wallBlurPx !== null || round || fill || process.argv.includes('--shift') || sizePercent !== null || process.argv.includes('--cover') || process.argv.includes('--picture') || stretchPercent !== null
const shotSettings = process.argv.includes('--settings')
// `--quick` runs one short section of the walk and dumps it. The full walk is
// long enough that a single stalled fetch can hold the whole thing up; when all
// that is wanted is one behaviour, this gets it in seconds.
const quick = process.argv.includes('--quick')
// `--budget=<ms>` shortens the virtual clock, which is how a walk that never
// finishes is pinned down: the dump that comes back names the stage it was in.
const budgetArg = process.argv.find((arg) => arg.startsWith('--budget='))
const budget = budgetArg ? Number(budgetArg.slice('--budget='.length)) || 0 : null
// `--offline` resolves every host but the local server to nothing. Chrome's
// virtual clock pauses while a fetch is outstanding, and a site icon that never
// answers therefore stops the budget from ever running out — the walk waits
// forever on a picture it does not need. Offline, the fetches fail at once.
const offline = process.argv.includes('--offline')
// `--keep` leaves the driven page behind, for when the walk has to be read
// rather than re-run.
const keep = process.argv.includes('--keep')
// `--seed` opens the board a second time from a saved record instead of fresh.
const useSeed = process.argv.includes('--seed') || Boolean(matKind) || Boolean(markKind) || Boolean(markOwnKind) || Boolean(groundKind) || Boolean(wallMatKind) || wallBlurPx !== null || round || fill || sizePercent !== null || process.argv.includes('--picture') || Boolean(railWanted) || Boolean(sayText) || shelfWanted || Boolean(enginesWant)
// `--view` gives the seeded page over to the bookmarks view, which is what a
// page of that kind looks like when it is switched to.
const seedView = process.argv.includes('--view')
// A shot of something that has to be opened first: the picture of a folder's
// sheet or of a pick is worth more than a sentence claiming it exists.
const shotPicked = process.argv.includes('--picked')
const shotFolder = process.argv.includes('--folder')
const shotText = process.argv.includes('--text')
// A folder's cover, given through the folder's own menu: the file picker is the
// one control a driven page cannot reach, so the shot takes the other path a user
// has — an address — and the picture it names is served from the build itself,
// which is the same trick the wallpaper shot uses for its photograph.
const shotCover = process.argv.includes('--cover')
// And a board with a photograph on it, because the sample board has none: what a
// picture is made of is a question a board of logos and folders cannot answer,
// and the picture is the one thing on a tile that is opaque and edge to edge.
const shotPicture = process.argv.includes('--picture')
// A plate held in the air: the grid comes up, and the tile under the pointer is
// the one that is being carried.
const shotDrag = process.argv.includes('--drag')
// A whole selection in the air, banded up first: what a group looks like while
// it is being carried, and where it says it will land.
const shotBatch = process.argv.includes('--batch')
// A tile that has been told to fill itself, beside tiles that have not.
const shotFit = process.argv.includes('--fit')
// Two marks placed by hand, each somewhere else, so one picture holds both the
// placement and the fact that it is per tile.
const shotShift = process.argv.includes('--shift')
// The board's own settings, which is where the sizes and the engine mark live.
// How far down the settings drawer a shot is taken.
const atArg = process.argv.find((arg) => arg.startsWith('--at='))
const settingsAt = atArg ? Number(atArg.slice('--at='.length)) || 0 : 0.46
// What the record and the menus have already said, in the file name: a shot of
// one material at one size is only useful if the next one is not confused for it.
const shotState =
  matKind || markKind || markOwnKind || wallMatKind || wallBlurPx !== null || round || fill || sizePercent !== null || stretchPercent !== null || railWanted || sayText
    ? [
        matKind ? `mat-${matKind}` : 'board',
        markKind ? `mark-${markKind}` : null,
        markOwnKind ? `markown-${markOwnKind}` : null,
        ownKind ? `own-${ownKind}` : null,
        wallMatKind ? `wallmat-${wallMatKind}` : null,
        wallBlurPx !== null ? `blur${wallBlurPx}` : null,
        round ? 'round' : null,
        fill ? 'fill' : null,
        stretchPercent !== null ? `stretch${stretchPercent}` : null,
        railWanted ? `rail-${railSpec.join('-')}` : null,
        sayText ? 'say' : null,
        sizePercent !== null ? `size${sizePercent}` : null,
        shotCover ? 'cover' : null,
        shotPicture ? 'picture' : null,
        wallSpec.replace(':', ''),
        themeName,
      ]
        .filter(Boolean)
        .join('-')
    : null
const shotPath = join(
  root,
  shotState
    ? `.probe-${shotState}.png`
    : shotPicked
    ? '.probe-picked.png'
    : shotCover
      ? '.probe-cover.png'
      : shotPicture
        ? '.probe-picture.png'
        : shotFolder
      ? '.probe-folder.png'
      : shotText
        ? '.probe-text.png'
        : shotDrag
          ? '.probe-drag.png'
          : shotBatch
            ? '.probe-batch.png'
            : shotFit
              ? '.probe-fit.png'
              : shotShift
                ? '.probe-shift.png'
                : shotSettings
              ? '.probe-settings.png'
              : '.probe-shot.png',
)
const shotAction = matKind || markKind || markOwnKind || round || fill || stretchPercent !== null
  ? // The record has already said what the board is made of and how big its
    // marks are. What is added here is what a tile answers for itself — pressed
    // through its own menu, because a shot of a value written straight into the
    // DOM would be a picture of the test rather than of the board.
    'const pickOn = async (node, pattern) => {\n' +
    '  if (!node) return false\n' +
    '  const r = node.getBoundingClientRect()\n' +
    "  node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 16 }))\n" +
    '  await wait(520)\n' +
    '  const chip = [...document.querySelectorAll(".popover button")].find((el) => pattern.test(el.textContent.trim()))\n' +
    '  if (chip) { chip.click(); await wait(520) }\n' +
    "  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))\n" +
    '  await wait(420)\n' +
    '  return Boolean(chip)\n' +
    '}\n' +
    // A tile's corner is the tile's own answer, asked from its own menu: the row
    // says 磁贴圆角 and the only slider under that heading is the one wanted.
    'const setTileCorner = async (node, value) => {\n' +
    '  if (!node) return false\n' +
    '  const r = node.getBoundingClientRect()\n' +
    "  node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 16 }))\n" +
    '  await wait(520)\n' +
    '  const row = [...document.querySelectorAll(".popover .field-row")].find((el) => /磁贴圆角|Tile corners/.test(el.textContent))\n' +
    '  const input = row ? row.querySelector("input[type=range]") : null\n' +
    '  if (input) {\n' +
    '    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set\n' +
    '    setter.call(input, String(value))\n' +
    '    input.dispatchEvent(new Event("input", { bubbles: true }))\n' +
    '    input.dispatchEvent(new Event("change", { bubbles: true }))\n' +
    '    await wait(520)\n' +
    '  }\n' +
    "  globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))\n" +
    '  await wait(420)\n' +
    '  return Boolean(input)\n' +
    '}\n' +
    // A tile carries two material rows, and both of them are five buttons with
    // the same five words on them — so the row is chosen by its heading first,
    // and the chip out of that row rather than out of the whole popover.
    'const pickUnder = async (node, label, pattern) => {\n' +
    '  if (!node) return false\n' +
    '  const r = node.getBoundingClientRect()\n' +
    "  node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 16 }))\n" +
    '  await wait(520)\n' +
    '  const head = [...document.querySelectorAll(".popover .menu-label")].find((el) => label.test(el.textContent.trim()))\n' +
    '  const row = head ? head.nextElementSibling : null\n' +
    '  const chip = row ? [...row.querySelectorAll("button")].find((el) => pattern.test(el.textContent.trim())) : null\n' +
    '  if (chip) { chip.click(); await wait(520) }\n' +
    "  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))\n" +
    '  await wait(420)\n' +
    '  return Boolean(chip)\n' +
    '}\n' +
    (markOwnKind
      ? 'const ownMark = ' +
        JSON.stringify(
          { solid: '实心', acrylic: '亚克力', frosted: '毛玻璃', none: '透明' }[markOwnKind] ?? '',
        ) +
        '\n' +
        "await pickUnder([...document.querySelectorAll('.plate--tile')].find((el) => el.querySelector('.plate__icon')), /^图标材质$|^Icon material$/, new RegExp('^' + ownMark + '$'))\n"
      : '') +
    (ownKind
      ? 'const own = ' +
        JSON.stringify(
          { auto: '默认颜色', none: '透明', custom: '自定义颜色' }[ownKind] ?? '',
        ) +
        '\n' +
        "await pickOn(document.querySelector('.plate--search'), new RegExp('^' + own + '$'))\n" +
        "await pickOn([...document.querySelectorAll('.plate--tile')].find((el) => el.querySelector('.plate__icon')), new RegExp('^' + own + '$'))\n"
      : '') +
    // A round tile is asked for last, on the tile that was given its own answer if
    // there is one, so that one picture shows both the override and the shape the
    // tile takes when its corner is at the top of the range — a square tile at
    // fifty per cent of itself is a circle.
    (round
      ? "const roundMe = [...document.querySelectorAll('.plate--tile')].find((el) => el.querySelector('.plate__icon'))\n" +
        'await setTileCorner(roundMe, 50)\n'
      : '') +
    // Two marks placed by hand, each somewhere else: the placement is the tile's
    // own answer, and it is read as a share of the mark, so one picture shows the
    // control and the fact that it is per tile.
    (shotShift
      ? 'const placeOn = async (node, x, y) => {\n' +
        '  if (!node) return false\n' +
        '  const r = node.getBoundingClientRect()\n' +
        "  node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 16 }))\n" +
        '  await wait(520)\n' +
        '  const rowFor = (re) => [...document.querySelectorAll(".popover input[type=range]")].find((el) => re.test(((el.closest(".field-row") || el.parentElement).textContent) || ""))\n' +
        '  const set = (row, value) => {\n' +
        '    if (!row) return\n' +
        '    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set\n' +
        '    setter.call(row, String(value))\n' +
        '    row.dispatchEvent(new Event("input", { bubbles: true }))\n' +
        '    row.dispatchEvent(new Event("change", { bubbles: true }))\n' +
        '  }\n' +
        '  set(rowFor(/左右位置|Icon across/), x)\n' +
        '  set(rowFor(/上下位置|Icon up and down/), y)\n' +
        '  await wait(560)\n' +
        "  globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))\n" +
        '  await wait(460)\n' +
        '  return true\n' +
        '}\n' +
        "const placeable = [...document.querySelectorAll('.plate--tile')].filter((el) => el.querySelector('.plate__icon')).slice(0, 4)\n" +
        'await placeOn(placeable[0], -30, -30)\n' +
        'await placeOn(placeable[1], 30, -30)\n' +
        'await placeOn(placeable[2], -30, 30)\n' +
        'await placeOn(placeable[3], 30, 30)\n'
      : '') +
    // Filled tiles are picked as a group — a square mark and a round one among
    // them — because what a filled tile is made of is the whole question here, and
    // the switch for it is a tick rather than a chip.
    (fill || stretchPercent !== null
      ? 'const fillOn = async (node) => {\n' +
        '  if (!node) return false\n' +
        '  const r = node.getBoundingClientRect()\n' +
        "  node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + 16 }))\n" +
        '  await wait(520)\n' +
        '  const row = [...document.querySelectorAll(".popover .field-row--check")].find((el) => /填满磁贴|fills the tile/.test(el.textContent))\n' +
        '  const tick = row ? row.querySelector("input[type=checkbox]") : null\n' +
        '  if (tick && !tick.checked) tick.click()\n' +
        '  await wait(460)\n' +
        // The stretch slider only exists once the tile has been told to fill, so
        // it is looked for after the tick rather than beside it.
        (stretchPercent !== null
          ? '  const stretch = [...document.querySelectorAll(".popover input[type=range]")].find((el) => /拉伸|stretch/i.test((el.closest(".field-row") || el.parentElement).textContent || ""))\n' +
            '  if (stretch) {\n' +
            '    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set\n' +
            '    setter.call(stretch, "' +
            stretchPercent +
            '")\n' +
            '    stretch.dispatchEvent(new Event("input", { bubbles: true }))\n' +
            '    await wait(300)\n' +
            '  }\n'
          : '') +
        "  globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))\n" +
        '  await wait(420)\n' +
        '  return Boolean(tick)\n' +
        '}\n' +
        "const withMarks = [...document.querySelectorAll('.plate--tile')].filter((el) => el.querySelector('.plate__icon')).slice(0, 10)\n" +
        'for (const node of withMarks) await fillOn(node)\n' +
        // The last menu can outlive its tile's turn: two escapes leave the board
        // bare, so the shot shows the board rather than a popover over it.
        "globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))\n" +
        'await wait(300)\n' +
        "globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))\n" +
        'await wait(300)\n'
      : '') +
    (why
      ? "const beds = [...document.querySelectorAll('.plate__bed')]\n" +
        "const tiles = [...document.querySelectorAll('.plate--seamless .plate__tile')]\n" +
        "const one = beds[0] || null\n" +
        "const line = (label, value) => (document.getElementById('why').textContent += label + ': ' + value + '\\n')\n" +
        "const box = document.createElement('div')\n" +
        "box.id = 'why'\n" +
        "box.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;color:#000;font:12px monospace;white-space:pre;padding:8px;max-width:760px'\n" +
        'document.body.appendChild(box)\n' +
        "line('seamless tiles', tiles.length)\n" +
        "line('beds', beds.length)\n" +
        "line('bed class', one ? one.className : '-')\n" +
        "if (one) {\n" +
        "  const b = getComputedStyle(one)\n" +
        "  line('bed box', [one.getBoundingClientRect().width, one.getBoundingClientRect().height].join('x'))\n" +
        "  line('bed size', b.backgroundSize)\n" +
        "  line('bed image', b.backgroundImage.slice(0, 90))\n" +
        "  line('bed filter', b.filter)\n" +
        "  line('bed position', [b.position, b.inset].join(' '))\n" +
        "  line('bed opacity/display', [b.opacity, b.display].join(' '))\n" +
        '}\n' +
        "const t = tiles[0]\n" +
        "if (t) {\n" +
        "  const s = getComputedStyle(t)\n" +
        "  line('tile background', s.backgroundColor)\n" +
        "  line('tile --mark', s.getPropertyValue('--mark'))\n" +
        "  line('tile overflow/place', [s.overflow, s.placeItems].join(' '))\n" +
        '}\n' +
        "const icon = document.querySelector('.plate--seamless .plate__icon')\n" +
        "if (icon) {\n" +
        "  const i = getComputedStyle(icon)\n" +
        "  line('icon box', [icon.getBoundingClientRect().width, icon.getBoundingClientRect().height].join('x'))\n" +
        "  line('icon object-fit/filter', [i.objectFit, i.filter.slice(0, 60)].join(' | '))\n" +
        '}\n'
      : '') + +

    'await wait(700)'
  : shotPicked
  ? 'const key = (k, mods) => globalThis.dispatchEvent(new KeyboardEvent(\'keydown\', Object.assign({ key: k, bubbles: true }, mods || {})))\n' +
    "key('Control', { ctrlKey: true })\nkey('1', { ctrlKey: true })\nkey('2', { ctrlKey: true })\nawait wait(600)"
  : shotFolder
    ? "const folder = document.querySelector('.plate--folder')\nif (folder) { folder.click(); await wait(900) }"
    : shotDrag
      ? "const tile = [...document.querySelectorAll('.plate--tile')].find((el) => { const w = el.getBoundingClientRect().width; return w > 60 && w < 120 })\n" +
        'if (tile) {\n' +
        '  const canvas = document.querySelector(".canvas")\n' +
        '  const pitch = parseFloat(getComputedStyle(canvas).getPropertyValue("--pitch-x")) || 82\n' +
        '  const rect = tile.getBoundingClientRect()\n' +
        '  const cx = rect.left + rect.width / 2\n' +
        '  const cy = rect.top + rect.height / 2\n' +
        '  tile.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 61 }))\n' +
        '  await wait(260)\n' +
        '  globalThis.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: cx + pitch, clientY: cy + pitch * 0.4, buttons: 1, pointerId: 61 }))\n' +
        '  await wait(700)\n' +
        '}'
      : shotBatch
        ? // Band up a few tiles, then take hold of the selection and hold it in
          // the air: what a group looks like while it is carried, and what it
          // says about where it will land.
          "const tiles = [...document.querySelectorAll('.plate--tile')].filter((el) => { const w = el.getBoundingClientRect().width; return w > 60 && w < 130 && el.querySelector('.plate__icon') }).slice(0, 3)\n" +
          'const stage = document.querySelector(".canvas")\n' +
          'if (tiles.length === 3 && stage) {\n' +
          '  const boxes = tiles.map((el) => el.getBoundingClientRect())\n' +
          '  const left = Math.min.apply(null, boxes.map((b) => b.left)) - 14\n' +
          '  const top = Math.min.apply(null, boxes.map((b) => b.top)) - 14\n' +
          '  const right = Math.max.apply(null, boxes.map((b) => b.right)) + 14\n' +
          '  const bottom = Math.max.apply(null, boxes.map((b) => b.bottom)) + 14\n' +
          '  stage.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: left, clientY: top, button: 0, buttons: 1, pointerId: 91 }))\n' +
          '  await wait(180)\n' +
          '  globalThis.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: right, clientY: bottom, buttons: 1, pointerId: 91 }))\n' +
          '  await wait(240)\n' +
          '  globalThis.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: right, clientY: bottom, pointerId: 91 }))\n' +
          '  await wait(340)\n' +
          '  const chosen = document.querySelectorAll(".plate--selected")\n' +
          '  const pick = chosen[0] || tiles[0]\n' +
          '  const spot = pick.getBoundingClientRect()\n' +
          '  const held = { clientX: spot.left + spot.width / 2, clientY: spot.top + spot.height / 2 }\n' +
          '  pick.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: held.clientX, clientY: held.clientY, button: 0, buttons: 1, pointerId: 92 }))\n' +
          '  await wait(180)\n' +
          '  globalThis.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: held.clientX + 190, clientY: held.clientY + 130, buttons: 1, pointerId: 92 }))\n' +
          '  await wait(800)\n' +
          '}'
        : shotFit
          ? // A tile that has been told to fill itself, left on the board beside
            // tiles that have not: the mark should be the tile, corners and all.
            "const pick = [...document.querySelectorAll('.plate--tile')].find((el) => { const b = el.getBoundingClientRect(); return b.width > 120 && b.width < 200 && el.querySelector('.plate__icon') })\n" +
            'if (pick) {\n' +
            '  const seat = pick.getBoundingClientRect()\n' +
            '  pick.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: seat.left + 30, clientY: seat.top + 14 }))\n' +
            '  await wait(560)\n' +
            '  const row = [...document.querySelectorAll(".popover .field-row--check")].find((el) => /填满磁贴|fills the tile/.test(el.textContent))\n' +
            '  const tick = row ? row.querySelector("input[type=checkbox]") : null\n' +
            '  if (tick && !tick.checked) { tick.click() }\n' +
            '  await wait(460)\n' +
            '  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))\n' +
            '  await wait(520)\n' +
            '}'
        : shotSettings
        ? "const open = [...document.querySelectorAll('button')].find((el) => /设置|Settings/.test(el.textContent))\n" +
          'if (open) {\n' +
          '  open.click()\n' +
          '  await wait(700)\n' +
          '  const body = document.querySelector(".drawer__body") || document.querySelector(".drawer__scroll")\n' +
          // The drawer is longer than the window: `--at=<share>` says where along it
          // the shot is taken, because a row below the fold is a row unlooked at.
          `  if (body) body.scrollTop = body.scrollHeight * ${settingsAt}\n` +
          '  await wait(400)\n' +
          '}'
        : shotText
          ? "const words = [...document.querySelectorAll('.plate')].find((el) => el.querySelector('.prose'))\n" +
        'if (words) {\n' +
        '  const rect = words.getBoundingClientRect()\n' +
        '  words.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: rect.left + 30, clientY: rect.top + 14 }))\n' +
        '  await wait(900)\n' +
        '}'
      : 'await wait(200)'
// A folder given a cover by address, through the folder's own menu — the same
// path a user takes, and the only one a driven page can take: a file dialog is
// not something a screenshot can open. Kept apart from the action above so a
// cover can be shot over a material as well as on its own.
const coverAction = shotCover
  ? 'const cnote = []\n' +
    "const cqa = (sel) => [...document.querySelectorAll(sel)]\n" +
    "const folder = document.querySelector('.plate--folder')\n" +
    'cnote.push("folders " + cqa(".plate--folder").length)\n' +
    'if (folder) {\n' +
    '  const seat = folder.getBoundingClientRect()\n' +
    '  folder.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: seat.left + 24, clientY: seat.top + 14 }))\n' +
    '  await wait(700)\n' +
    '  cnote.push("menus " + cqa(".popover").length + " rows " + cqa(".popover input.input").length)\n' +
    '  const field = cqa(".popover input.input").find((el) => /封面|cover/i.test((el.closest(".field-row") || el.parentElement).textContent || ""))\n' +
    '  cnote.push("field " + Boolean(field))\n' +
    '  if (field) {\n' +
    '    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set\n' +
    '    setter.call(field, "/__cover.jpg")\n' +
    '    field.dispatchEvent(new Event("input", { bubbles: true }))\n' +
    '    await wait(160)\n' +
    '    cnote.push("typed " + field.value)\n' +
    '    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))\n' +
    '    await wait(700)\n' +
    '  }\n' +
    '  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))\n' +
    '  await wait(700)\n' +
    '}\n' +
    "const saved = JSON.parse(localStorage.getItem('tabula:state') || '{}')\n" +
    "cnote.push('saved ' + ((saved.board && saved.board.plates) || []).map((p) => p.coverUrl || '-').join(','))\n" +
    "cnote.push('drawn ' + Boolean(document.querySelector('.folder__cover')) + ' count ' + ((document.querySelector('.folder__count') || {}).textContent || '-'))\n" +
    'globalThis.__coverNote = cnote.join(" | ")\n'
  : ''
// The cover is a picture, so a shot of it is the check; when one is wrong, the
// facts behind it are worth more than the picture, and they go where a screenshot
// can be read — the same bargain `--why` strikes for the beds.
const coverWhy =
  why && shotCover
    ? "const cbox = document.createElement('div')\n" +
      "cbox.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99999;background:#fff;color:#000;font:12px monospace;white-space:pre;padding:8px;max-width:900px'\n" +
      'cbox.textContent = String(globalThis.__coverNote)\n' +
      'document.body.appendChild(cbox)\n'
    : ''
const shotTail =
  '<script type="module">\n' +
  'const wait = (ms) => new Promise((done) => setTimeout(done, ms))\n' +
  // Frames are timers in a headless window, or a shot of anything the app draws
  // while it is being carried would show nothing being carried — and neither do
  // transitions advance, so they are put down as well: the picture wants to show
  // where the plates are, not how they are getting there.
  'globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16)\n' +
  'const freeze = document.createElement("style")\n' +
  'freeze.textContent = "*,*::before,*::after{transition:none !important;animation:none !important}"\n' +
  'document.head.appendChild(freeze)\n' +
  'for (let i = 0; i < 60 && !document.querySelector(".plate"); i += 1) await wait(80)\n' +
  'await wait(400)\n' +
  shotAction +
  '\n' +
  coverAction +
  '\n' +
  coverWhy +
  '\n</script>'
// The shim is a classic script placed ahead of the bundle, because the platform
// layer decides which backend it is talking to the moment it is imported.
const withShim = useFirefox
  ? index.replace(/(<script)/, `<script>${FIREFOX_SHIM}</script>\n    $1`)
  : index
// A photograph to hang the board on, when one is asked for. The wall is part of
// the claim a material makes — glass over a flat fill is one thing, glass over a
// picture is the thing it was added for — so the shot needs a real one, and the
// machine's own wallpaper folder has one that is served from the same place as
// the build rather than fetched from somewhere that may not answer.
const WALL_PHOTOS = [
  'C:\\Windows\\Web\\Wallpaper\\Theme1\\img1.jpg',
  'C:\\Windows\\Web\\Wallpaper\\Theme1\\img2.jpg',
  'C:\\Windows\\Web\\Wallpaper\\Windows\\img0.jpg',
  'C:\\Windows\\Web\\Wallpaper\\Windows\\img1.jpg',
]
const wallPhoto = wallSpec === 'photo' ? WALL_PHOTOS.find((path) => existsSync(path)) ?? null : null
const wallFile = join(dist, '__wall.jpg')
if (wallPhoto) await copyFile(wallPhoto, wallFile)
if (wallSpec === 'photo' && !wallPhoto) {
  console.log('note: no wallpaper photo found; --wall=photo fell back to a flat fill')
}
// A backdrop with something in it to be seen through. Glass is judged by what it
// does to what is behind it, and the wallpaper photo's own sky sits at the top of
// the frame, exactly where the tiles are: a pale film over a pale sky is a pale
// chip whichever material was asked for, and the shot says nothing about either
// one. This is drawn rather than found — a dark ground, a bright band across the
// middle, and small hard-edged shapes — so that a blur has an edge to soften, a
// film has a colour to shift, and both ask the same question on every machine.
if (wallSpec === 'dark') {
  await writeFile(
    join(dist, '__wall-dark.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000">' +
      '<defs><linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#05070d"/><stop offset="0.55" stop-color="#101a2e"/><stop offset="1" stop-color="#03040a"/>' +
      '</linearGradient></defs>' +
      '<rect width="1600" height="1000" fill="url(#ground)"/>' +
      '<circle cx="1180" cy="240" r="150" fill="#f4f7ff" opacity="0.9"/>' +
      '<rect x="0" y="620" width="1600" height="8" fill="#ff7a45"/>' +
      '<rect x="0" y="700" width="1600" height="6" fill="#45d6ff" opacity="0.8"/>' +
      '<g fill="#0b0f1a">' +
      '<rect x="80" y="760" width="180" height="240"/><rect x="360" y="700" width="120" height="300"/>' +
      '<rect x="640" y="800" width="220" height="200"/><rect x="1000" y="740" width="150" height="260"/>' +
      '</g>' +
      '<g fill="#f8f0d0">' +
      '<rect x="120" y="120" width="40" height="40"/><rect x="300" y="60" width="26" height="26"/>' +
      '<rect x="700" y="150" width="52" height="52"/><rect x="900" y="420" width="30" height="30"/>' +
      '</g></svg>',
  )
}
// And a picture to wear as a folder's cover, for the same reason: a cover shot
// whose picture came off the network would be a shot of a broken frame on a
// machine with no route to it. Same photographs, served from the same place.
const coverPhoto = shotCover || shotPicture ? WALL_PHOTOS.find((path) => existsSync(path)) ?? null : null
if (coverPhoto) {
  await copyFile(coverPhoto, join(dist, '__cover.jpg'))
} else if (shotCover || shotPicture) {
  console.log('note: no photograph found; the shot has no picture to hang or to wear')
}
const wallpaperOf = (spec) => {
  if (spec === 'none') return { kind: 'none' }
  if (spec === 'photo') return wallPhoto ? { kind: 'url', url: '/__wall.jpg' } : { kind: 'flat', id: 'mist' }
  if (spec === 'dark') return { kind: 'url', url: '/__wall-dark.svg' }
  const [kind, id] = spec.split(':')
  return kind === 'flat' ? { kind: 'flat', id: id || 'mist' } : { kind: 'none' }
}
/**
 * Only what the shot is about: what the background layer is made of and what it is
 * coloured with, the pane the marks stand on, the wall behind both, and the side of
 * the palette. Everything else is left out so that it comes from the board's own
 * defaults — a partial record merges, so this draws the sample board itself.
 *
 * A tile is two layers and each is made of something, so there are two flags:
 * `--mat=` is the background layer's material and `--mark=` the icon layer's.
 * `--ground=` is the *colour* the background layer is coloured with — the theme's
 * card, a colour of the user's, or nothing — which is a different question from
 * what that colour is made of.
 */
const groundOf = (kind) =>
  kind === 'none' ? { kind: 'none' } : kind === 'custom' ? { kind: 'custom', colour: '#2f3a5c' } : { kind: 'auto' }
const matRecord = matKind || markKind || groundKind || shelfWanted || enginesWant || wallMatKind || wallBlurPx !== null || sizePercent !== null || shotPicture || railWanted || sayText
  ? {
      schema: 1,
      settings: {
        ...(matKind ? { backgroundMaterial: { kind: matKind } } : {}),
        ...(markKind ? { iconMaterial: { kind: markKind } } : {}),
        ...(groundKind ? { tileFill: groundOf(groundKind) } : {}),
        ...(enginesWant ? { engineMenu: enginesWant !== 'strip', engineStrip: enginesWant !== 'menu' } : {}),
        ...(shelfWanted
          ? {
              wallpapers: [
                { kind: 'url', url: '/__wall.jpg' },
                { kind: 'flat', id: 'ink' },
                { kind: 'flat', id: 'mist' },
              ],
              wallRotation: { mode: 'interval', every: 30, at: [{ time: '08:00', index: 0 }, { time: '20:00', index: 1 }] },
            }
          : {}),
        // A mark's size is a share of the tile, so a shot asks for it in percent.
        ...(sizePercent !== null ? { iconSize: sizePercent / 100 } : {}),
        ...(railWanted ? { rail: railWanted } : {}),
        ...(sayText ? { searchPlaceholder: sayText } : {}),
        ...(wallMatKind || wallBlurPx !== null
          ? {
              wall: {
                ...(wallMatKind ? { kind: wallMatKind } : {}),
                ...(wallBlurPx !== null ? { blur: wallBlurPx } : {}),
              },
            }
          : {}),
        wallpaper: wallpaperOf(wallSpec),
        showNames: true,
        ...(themeName ? { theme: themeName } : {}),
      },
      // Two photographs, one big enough to be a wall and one the size of a mark,
      // because what a material does to a picture is asked of both the picture and
      // the pane it stands in.
      ...(shotPicture
        ? {
            board: {
              version: 1,
              pages: [{ id: 'bay-1', name: 'Pictures', tint: 'blue' }],
              plates: [
                {
                  id: 'shot-photo',
                  pageId: 'bay-1',
                  kind: 'image',
                  shape: 'tile',
                  w: 3,
                  h: 3,
                  x: 1,
                  y: 0,
                  imageUrl: '/__cover.jpg',
                  title: 'A picture',
                },
                {
                  id: 'shot-photo-small',
                  pageId: 'bay-1',
                  kind: 'image',
                  shape: 'tile',
                  w: 2,
                  h: 2,
                  x: 5,
                  y: 0,
                  imageUrl: '/__cover.jpg',
                  showName: false,
                },
                // A picture worn as an icon on a tile that is not the picture's
                // own shape, already filling it: the slider that says how far a
                // mark may stretch is only legible against a mark that would
                // otherwise have to be letterboxed — and this tile is three times
                // as wide as it is tall, which is room to give.
                {
                  id: 'shot-wide',
                  pageId: 'bay-1',
                  kind: 'link',
                  shape: 'tile',
                  w: 3,
                  h: 1,
                  x: 8,
                  y: 0,
                  title: 'Wide',
                  url: 'https://example.com/',
                  iconUrl: '/__cover.jpg',
                  bleed: true,
                  showName: false,
                },
                // The same picture on a tile that has been told to fill it, which
                // is the state where its size control used to go dead: the size is
                // the crop, and a crop has to keep working once the picture is the
                // tile.
                {
                  id: 'shot-photo-fill',
                  pageId: 'bay-1',
                  kind: 'image',
                  shape: 'tile',
                  w: 2,
                  h: 2,
                  x: 1,
                  y: 3,
                  imageUrl: '/__cover.jpg',
                  bleed: true,
                  showName: false,
                },
              ],
            },
          }
        : {}),
    }
  : null
// The standalone views read the same record out of storage, so the seed has to
// be there before anything loads — and the shim hands it back the same way.
const seedRecord = seedView
  ? { ...SEED, board: { ...SEED.board, pages: [{ ...SEED.board.pages[0], view: 'bookmarks' }] } }
  : matRecord ?? SEED
const seeded = useSeed
  ? withShim.replace(
      /(<script)/,
      `<script>globalThis.__seedState = ${JSON.stringify(seedRecord)}; try { localStorage.setItem('tabula:state', JSON.stringify(globalThis.__seedState)) } catch {}</script>\n    $1`,
    )
  : withShim
const page = shot
  ? seeded.replace('</body>', `${shotTail}</body>`)
  : seeded.replace(
      '</body>',
      `<script type="module">${useSeed ? SEED_SCRIPT : quick ? QUICK_SCRIPT : SCRIPT}</script></body>`,
    )
await writeFile(probeFile, page, 'utf8')

const browser = pickBrowser()
const profile = join(root, '.probe-profile')
const { server, port } = await serveDist()
// The leash is wall-clock: virtual time is what the walk is measured in, and a
// stalled fetch can stop that clock for good. The whole walk gets longer than
// the sections, because it is a long walk and a slow machine is not a stall.
const leashArg = process.argv.find((arg) => arg.startsWith('--leash='))
const leash = leashArg ? Number(leashArg.slice('--leash='.length)) || 0 : shot || quick ? 120000 : 300000
const result = await run(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  // The same window for every mode: a headless default is 800x600, which clamps
  // the grid to its smallest tile and hides the things that only happen at a
  // size the board is actually used at.
  '--window-size=1440,920',
  ...(shot ? [`--screenshot=${shotPath}`] : ['--dump-dom']),
  // The walk is timed in waits, and virtual time is what the budget counts, so
  // this is the ceiling on how long the whole probe may take — not real time.
  // The walk waits on the interface at every step, and the waits are virtual
  // time: the budget has to cover the whole walk or it dies mid-sentence.
  // `--budget=` lowers it on purpose: a walk that never gets past a stage is
  // found by stopping the clock early and reading which stage it stopped at.
  `--virtual-time-budget=${budget ?? (shot ? 14000 : quick ? 22000 : 240000)}`,
  ...(offline ? ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'] : []),
  `http://127.0.0.1:${port}/__probe.html`,
], leash)
server.close()

if (shot) {
  console.log(`shot: ${shotPath} (exit ${result.code})`)
  if (result.err.trim()) console.log(result.err.slice(-800))
}

const report = shot ? null : extract(result.out)
// The page tells the server which section it is in as it goes; on a finished
// run that is simply the last one, and its presence is what proves the channel
// works well enough to trust when a run does not finish.
if (report) report.stagesSeen = lastStage
if (report) console.log(JSON.stringify(report, null, 2))
else if (!shot) {
  console.log(
    result.stalled
      ? 'probe stalled: the clock stopped moving, so the run was cut off'
      : `probe never finished (exit ${result.code}, dom ${result.out.length} bytes)`,
  )
  // The walk marks each section it starts, so a stopped walk can say where —
  // and when it stalled there is no dump to read it from, only the server's
  // own record of what the page last said it was doing.
  const stage = /data-stage="([a-z]+)"/.exec(result.out)
  console.log(`last stage reached: ${(stage && stage[1]) || lastStage || 'none'}`)
  if (result.stalled) console.log('note: a stalled run leaves no dom; the stage above came from the page itself')
  if (!/type="module">/.test(result.out)) console.log('note: the injected script is not in the dumped dom')
  if (result.err.trim()) console.log(result.err.slice(-1500))
  // Keep the dump itself, not just its tail: a walk that stops says where only
  // if the page it left behind can be read as a whole.
  await writeFile(domFile, result.out, 'utf8')
  console.log(`dom written to ${domFile}`)
  const tail = result.out.slice(-600)
  if (tail.trim()) console.log(`dom tail:\n${tail}`)
}

if (!keep) await rm(probeFile, { force: true })
if (wallPhoto) await rm(wallFile, { force: true })
await rm(profile, { recursive: true, force: true })
process.exit(shot ? result.code : report ? 0 : 1)