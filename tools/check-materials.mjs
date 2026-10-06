/**
 * What each of a tile's two layers is actually drawn from.
 *
 * A tile is a background and an icon, and each of them can be made of something.
 * The rules that give a layer its ground, its film, its inset lines and its filter
 * are spread across the stylesheet on purpose — one list of selectors per material,
 * shared by every kind of opening, overridden for the cases that mean something
 * different. Reading them back off the rendered page is the only way to know which
 * of them won, and whether the two layers really are separate: so this drives a
 * real browser, seeds the two materials, and prints the computed style of the tile,
 * the pane, the mark inside it and the root's own variables.
 *
 *   node tools/check-materials.mjs [background] [mark]
 *
 * Both arguments take a material kind — `solid`, `acrylic`, `frosted`, `liquid`,
 * `none` — and either may be left out, in which case `acrylic` is used. `dist` has
 * to be built.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

const background = process.argv[2] ?? 'acrylic'
const mark = process.argv[3] ?? 'acrylic'
const serverPort = Number(process.argv[4] ?? 5194)
// `--picture` seeds a board with one picture tile on it instead of the sample, so
// that what a picture's menu offers can be read back: a photograph cannot be picked
// in a headless window, and the menu is the same menu either way.
const pictureOnly = process.argv.includes('--picture')
// `--text` does the same for a greeting that holds two paragraphs.
const textOnly = process.argv.includes('--text')
// `--switch` seeds a board with the wallpaper switch on it and a shelf of three,
// which is the only way to see what the button does: it is a press, not a picture.
const switchOnly = process.argv.includes('--switch')
const debugPort = serverPort + 1
const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
if (!chrome) throw new Error('no chrome or edge found to drive')

const wait = (ms) => new Promise((done) => setTimeout(done, ms))

const LOOK = `(() => {
  const line = (name, node) => {
    if (!node) return '  ' + name + ': absent'
    const style = getComputedStyle(node)
    const box = node.getBoundingClientRect()
    return (
      '  ' + name +
      ' ' + Math.round(box.width) + 'x' + Math.round(box.height) +
      ' | ground ' + style.backgroundColor +
      ' | image ' + style.backgroundImage.slice(0, 70) +
      ' | radius ' + style.borderRadius +
      ' | shadow ' + style.boxShadow.slice(0, 130) +
      ' | filter ' + style.filter.slice(0, 80) +
      ' | backdrop ' + style.backdropFilter.slice(0, 80)
    )
  }
  const plate = [...document.querySelectorAll('.plate--tile')].find((el) => el.querySelector('.plate__icon, .plate__photo'))
  if (!plate) return 'no tile with a mark on the board'
  const tile = plate.querySelector('.plate__tile')
  const vars = (names) => names
    .map((name) => name + '=' + getComputedStyle(document.documentElement).getPropertyValue(name).trim())
    .join(' ')
  return [
    line('tile  ', tile),
    line('pane  ', plate.querySelector('.plate__mark-pane')),
    line('icon  ', plate.querySelector('.plate__icon')),
    line('photo ', plate.querySelector('.plate__photo')),
    line('initial', plate.querySelector('.plate__initial')),
    '  attrs ' + JSON.stringify({
      fill: tile.getAttribute('data-fill'),
      background: tile.getAttribute('data-background'),
      mark: tile.getAttribute('data-mark'),
    }),
    '  sheet ' + JSON.stringify({
      radius: getComputedStyle(document.documentElement).getPropertyValue('--tile-radius').trim(),
      chrome: getComputedStyle(document.documentElement).getPropertyValue('--radius').trim(),
    }),
    '  bg vars ' + vars(['--bg-solid-mix', '--bg-acrylic-mix', '--bg-glass-mix', '--bg-liquid-mix', '--bg-frost-filter', '--bg-sheet-shade']),
    '  mark vars ' + vars(['--mark-solid-mix', '--mark-acrylic-mix', '--mark-glass-mix', '--mark-liquid-mix', '--mark-frost-filter', '--mark-sheet-shade']),
  ].join('\\n')
})()`

async function connect(endpoint) {
  const socket = new WebSocket(endpoint)
  await new Promise((done, fail) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', () => fail(new Error('the page never answered')), { once: true })
  })
  let next = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const waiting = pending.get(message.id)
    if (!waiting) return
    pending.delete(message.id)
    if (message.error) waiting.fail(new Error(message.error.message))
    else waiting.done(message.result)
  })
  return (method, params) =>
    new Promise((done, fail) => {
      const id = next
      next += 1
      pending.set(id, { done, fail })
      socket.send(JSON.stringify({ id, method, params: params ?? {} }))
    })
}

/*
 * The board a picture run draws: one tile, holding two pictures, taking turns.
 *
 * The pictures are two addresses: nothing is fetched in this run, and a tile's list
 * is read from the record rather than from the pixels.
 */
const pictureBoard = pictureOnly
  ? JSON.stringify({
      version: 1,
      pages: [{ id: 'bay-1', tint: 'blue' }],
      plates: [
        {
          id: 'shot-1',
          pageId: 'bay-1',
          kind: 'image',
          shape: 'tile',
          w: 3,
          h: 2,
          x: 1,
          y: 1,
          title: 'Two pictures',
          imageVariants: [
            { url: '/__one.png', name: 'one.png' },
            { url: '/__two.png', name: 'two.png' },
          ],
          rotation: { mode: 'interval', every: 30, at: [] },
        },
      ],
    })
  : textOnly
    ? JSON.stringify({
        version: 1,
        pages: [{ id: 'bay-1', tint: 'blue' }],
        plates: [
          {
            id: 'shot-2',
            pageId: 'bay-1',
            kind: 'widget',
            widget: 'text',
            shape: 'tile',
            w: 3,
            h: 2,
            x: 1,
            y: 1,
            title: 'Two paragraphs',
            text: { body: '早上好' },
            textVariants: [{ body: '早上好' }, { body: '晚上好' }],
            rotation: { mode: 'clock', every: 60, at: [{ time: '20:00', index: 1 }] },
          },
        ],
      })
    : switchOnly
      ? JSON.stringify({
          version: 1,
          pages: [{ id: 'bay-1', tint: 'blue' }],
          plates: [
            {
              id: 'switch-1',
              pageId: 'bay-1',
              kind: 'widget',
              widget: 'wallpaper',
              shape: 'tile',
              w: 2,
              h: 2,
              x: 1,
              y: 1,
              showName: false,
            },
          ],
        })
      : 'null'

/*
 * The shelf a switch run needs: three wallpapers, one of them hanging. A switch with
 * nothing to switch between is a button that is off, which is the other state worth
 * being able to see.
 */
const shelfSettings = switchOnly
  ? `wallpapers: [
        { kind: 'flat', id: 'ink' },
        { kind: 'flat', id: 'mist' },
        { kind: 'flat', id: 'moss' },
      ],
      wallpaper: { kind: 'flat', id: 'ink' },`
  : ''

const server = spawn(process.execPath, ['tools/serve-dist.mjs', 'dist', String(serverPort)], {
  stdio: 'ignore',
  windowsHide: true,
})
const browser = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,860',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${join(tmpdir(), 'tabula-materials-' + String(Date.now()))}`,
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
)

let endpoint = null
for (let attempt = 0; attempt < 80 && !endpoint; attempt += 1) {
  await wait(250)
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
    const targets = await response.json()
    const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
    endpoint = page ? page.webSocketDebuggerUrl : null
  } catch {
    /* not listening yet */
  }
}
if (!endpoint) throw new Error('the browser never opened a page to drive')

const send = await connect(endpoint)
await send('Page.enable')
await send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/index.html` })
await wait(1800)

// The two materials are set through the store rather than through the drawer: the
// drawer is the probe's business, and what is being asked here is what a layer is
// made of. A hidden wallpaper is left alone — the board's own default is the flat
// one, and glass over a photograph and glass over a flat fill are two different
// claims that `probe-dist.mjs --wall=photo` is the tool for.
await send('Runtime.evaluate', {
  expression: `(() => {
    const raw = JSON.parse(localStorage.getItem('tabula:state') || '{}')
    raw.settings = Object.assign({}, raw.settings, {
      backgroundMaterial: { kind: '${background}', strength: 62, transparency: 0 },
      iconMaterial: { kind: '${mark}', strength: 66, transparency: 0 },
      ${shelfSettings}
    })
    /*
     * A board with one picture tile on it, holding two pictures.
     *
     * The picture is written rather than brought in, because what is being asked is
     * what a picture tile's menu offers — a photograph cannot be picked in a headless
     * window, and the menu is the same menu either way. The two entries are two
     * addresses: nothing is fetched in this run, and a tile's list is read from the
     * record rather than from the pixels.
     */
    raw.board = ${pictureBoard}
    localStorage.setItem('tabula:state', JSON.stringify(raw))
    return 'seeded'
  })()`,
  returnByValue: true,
})
await send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/index.html` })
await wait(2200)

const outcome = await send('Runtime.evaluate', { expression: LOOK, returnByValue: true })
console.log(`background ${background} · mark ${mark}`)
console.log(String((outcome.result && outcome.result.value) || JSON.stringify(outcome)))

// And, on a picture run, what that tile's menu actually offers — the labels, in the
// order they are drawn, which is the only way to say what a menu does and does not
// ask about a picture. A switch run presses the switch instead and says what changed.
if (pictureOnly || textOnly || switchOnly) {
  const MENU = `(async () => {
    const wait = (ms) => new Promise((done) => setTimeout(done, ms))
    const shelfOf = () => {
      try {
        return JSON.parse(localStorage.getItem('tabula:state') || '{}').settings?.wallpaper ?? null
      } catch {
        return null
      }
    }
    const sw = document.querySelector('.wallpaper-switch')
    if (sw) {
      const before = shelfOf()
      const on = !sw.disabled
      sw.click()
      await wait(700)
      return 'switch ' + (on ? 'pressable' : 'off') + ', ' + JSON.stringify(before) + ' -> ' + JSON.stringify(shelfOf())
    }
    const plate = document.querySelector('.plate--tile, .plate--still')
    if (!plate) return 'no tile'
    const r = plate.getBoundingClientRect()
    plate.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 30, clientY: r.top + 20 }))
    await wait(520)
    const labels = [...document.querySelectorAll('.popover .menu-label')].map((el) => el.textContent.trim())
    const rows = [...document.querySelectorAll('.popover .field-row')].map(
      (el) => (el.querySelector('.field-row__label') || el).textContent.trim().slice(0, 24),
    )
    const shelf = document.querySelectorAll('.popover .shelf__item').length
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return 'labels ' + JSON.stringify(labels) + ' | rows ' + JSON.stringify(rows) + ' | shelf ' + shelf
  })()`
  const menu = await send('Runtime.evaluate', { expression: MENU, returnByValue: true, awaitPromise: true })
  console.log('menu')
  console.log(String((menu.result && menu.result.value) || JSON.stringify(menu)))
}

/*
 * The two interactions that live on the same two layers, driven rather than
 * described: a held right button has to open the stack, and the stretch has to
 * reach a mark whether or not the mark was told to fill its tile. Both are read
 * back off the page, because both are the kind of thing a rule can promise and a
 * cascade can take away.
 */
const PEEK = `(async () => {
  const wait = (ms) => new Promise((done) => setTimeout(done, ms))
  const plate = [...document.querySelectorAll('.plate--tile')].find((el) => el.querySelector('.plate__icon'))
  if (!plate) return 'no tile with a mark on the board'
  const tile = () => plate.querySelector('.plate__tile')
  const pane = () => plate.querySelector('.plate__mark-pane')
  const read = () => ({
    separated: plate.classList.contains('plate--separated'),
    pane: pane() ? getComputedStyle(pane()).translate + ' / ' + getComputedStyle(pane()).scale : null,
    tile: getComputedStyle(tile()).transform,
  })
  const before = read()
  const box = plate.getBoundingClientRect()
  plate.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, button: 2, buttons: 2, clientX: box.left + 20, clientY: box.top + 20,
  }))
  await wait(420)
  const held = read()
  plate.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, button: 2, buttons: 0, clientX: box.left + 20, clientY: box.top + 20,
  }))
  await wait(560)
  const released = read()
  const menu = document.querySelector('.popover')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await wait(320)

  // And the left button, which lifts the same way: the peel is the press, and what
  // the button decides is what happens after it — a look first, then the tile.
  plate.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, clientX: box.left + 20, clientY: box.top + 20 }))
  await wait(360)
  const leftHeld = read()
  plate.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, buttons: 0, clientX: box.left + 20, clientY: box.top + 20 }))
  await wait(360)
  const leftReleased = read()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await wait(320)

  // And the stretch, on a mark that was never told to fill its tile: the sliders
  // were only read by the rules for a filled one, so this is the case that said
  // nothing at all.
  const plain = [...document.querySelectorAll('.plate--tile')].find(
    (el) => el.querySelector('.plate__icon') && !el.classList.contains('plate--seamless'),
  )
  const stretchOf = (node) => {
    const icon = node ? node.querySelector('.plate__icon') : null
    return icon ? getComputedStyle(icon).transform : null
  }
  const bare = stretchOf(plain)
  if (plain) {
    plain.style.setProperty('--icon-stretch-x', '1.5')
    plain.style.setProperty('--icon-stretch-y', '1.2')
  }
  await wait(220)
  const stretched = stretchOf(plain)

  // Ctrl turns a press into a pick, for both buttons: the left one gathers instead
  // of opening, and the right one gathers and then opens the settings for the whole
  // of it. The menu's own note is what says how many it reaches, so that is what is
  // read back.
  const pickable = [...document.querySelectorAll('.plate--tile')].filter((el) => el.querySelector('.plate__icon'))
  const boxOf = (node) => {
    const r = node.getBoundingClientRect()
    return { clientX: r.left + 20, clientY: r.top + 20 }
  }
  const tap = (node, ctrl) => {
    const at = boxOf(node)
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, ctrlKey: ctrl, ...at }))
    node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, buttons: 0, ctrlKey: ctrl, ...at }))
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: ctrl, ...at }))
  }
  let picked = null
  let reaches = null
  if (pickable.length >= 2) {
    tap(pickable[0], true)
    await wait(260)
    const one = document.querySelectorAll('.plate--selected').length
    tap(pickable[1], true)
    await wait(260)
    const two = document.querySelectorAll('.plate--selected').length
    // A right press under Ctrl gathers and asks nothing: a menu per tile is what a
    // pick is not. The settings for the whole of it arrive when Ctrl is let go.
    const at = boxOf(pickable[1])
    pickable[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2, buttons: 2, ctrlKey: true, ...at }))
    pickable[1].dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 2, buttons: 0, ctrlKey: true, ...at }))
    await wait(420)
    const early = document.querySelector('.popover') ? 'a menu opened on the press' : 'nothing yet'
    const three = document.querySelectorAll('.plate--selected').length
    globalThis.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true }))
    await wait(460)
    const popover = document.querySelector('.popover')
    const note = popover ? popover.querySelector('.popover__note') : null
    reaches = note ? note.textContent.trim() : 'no batch note'
    picked = one + '/' + two + '/' + three + ' picked, on the press ' + early
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait(300)
  }
  // A right press on the board itself, on an opening with nothing in it: the board's
  // own menu, opened where the press was. The free opening is found rather than
  // assumed, because which cells the sample board leaves empty is not this tool's
  // business — and a press that lands on a tile would be the tile's own menu.
  const canvas = document.querySelector('.canvas')
  const canvasBox = canvas ? canvas.getBoundingClientRect() : null
  const tiles = [...document.querySelectorAll('.plate')].map((el) => el.getBoundingClientRect())
  let free = null
  if (canvasBox) {
    for (let y = Math.round(canvasBox.top + 12); y < canvasBox.bottom - 12 && !free; y += 16) {
      for (let x = Math.round(canvasBox.left + 12); x < canvasBox.right - 12; x += 16) {
        if (!tiles.some((r) => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2)) {
          free = { x, y }
          break
        }
      }
    }
  }
  let onEmpty = 'no empty opening found'
  let blankTile = 'not tried'
  if (canvas && free) {
    canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: free.x, clientY: free.y }))
    await wait(520)
    const popover = document.querySelector('.popover')
    const items = popover ? [...popover.querySelectorAll('.menu-item')].map((el) => el.textContent.trim()) : []
    onEmpty = popover ? 'opened ' + JSON.stringify(items) : 'nothing opened'
    // The first line makes a place for something; the place is then asked what goes
    // in it, from its own menu.
    const before = document.querySelectorAll('.plate').length
    const make = popover ? [...popover.querySelectorAll('.menu-item')][0] : null
    if (make) {
      make.click()
      await wait(520)
      const blank = document.querySelector('.plate--blank')
      const after = document.querySelectorAll('.plate').length
      const box = blank ? blank.getBoundingClientRect() : null
      blankTile = blank
        ? 'made, ' + before + ' -> ' + after + ' plates, at ' + Math.round(box.left) + ',' + Math.round(box.top)
        : 'no blank tile was made'
      if (blank) {
        blank.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: box.left + 24, clientY: box.top + 20 }))
        await wait(520)
        const filler = document.querySelector('.popover')
        const head = filler ? filler.querySelector('.popover__title') : null
        blankTile += ', its menu says ' + (head ? JSON.stringify(head.textContent.trim()) : 'nothing')
      }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait(320)
  }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await wait(260)

  /*
   * And the bar: a press that moves must not carry it, and a press that is held must.
   *
   * The press is aimed at the end of the bar rather than at its field, because a
   * press on the field is the field's own and never reaches the plate — which is
   * exactly why the hold is needed for everything else on the bar.
   */
  const bar = document.querySelector('.plate--search')
  let barHold = 'no bar on the board'
  if (bar) {
    const barBox = bar.getBoundingClientRect()
    const edge = { clientX: barBox.right - 10, clientY: barBox.top + 10 }
    const press = () =>
      bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, ...edge }))
    const letGo = () =>
      globalThis.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, buttons: 0, ...edge }))
    const dragging = () => document.querySelectorAll('.plate--dragging').length
    press()
    globalThis.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: edge.clientX - 40, clientY: edge.clientY + 6 }),
    )
    await wait(320)
    const quick = dragging()
    letGo()
    await wait(240)
    press()
    await wait(1700)
    const held = dragging()
    // And a hold that is armed has to *carry*: the bar is followed through a move and
    // its drawn position is read before and after, because being picked up and being
    // carried are two different things and only the second one is useful.
    const where = () => Math.round(bar.getBoundingClientRect().left)
    const startAt = where()
    for (const step of [30, 70, 110]) {
      globalThis.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: edge.clientX - step, clientY: edge.clientY + 8 }),
      )
      await wait(90)
    }
    await wait(260)
    const movedTo = where()
    letGo()
    await wait(420)
    barHold =
      'moved at once dragging=' +
      quick +
      ', held dragging=' +
      held +
      ', carried ' +
      startAt +
      ' -> ' +
      movedTo
  }

  /*
   * And the corners: one length, taken from each tile's narrow side.
   *
   * A share of the box is a different curve on the top edge from the one down the
   * side of a tile that is not square, which is what a two-by-one tile used to look
   * bent by. The widest tile on the board is the case that shows it, so it and its
   * expected radius are both reported.
   */
  const share = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tile-radius-share')) || 0
  const shaped = [...document.querySelectorAll('.plate--tile')]
    // Bars are left out: a bar is rounded by its own length setting rather than by
    // the tile's share, which is the whole point of it having one.
    .filter((el) => !el.classList.contains('plate--search'))
    .map((el) => {
      const box = el.getBoundingClientRect()
      const tile = el.querySelector('.plate__tile')
      return {
        w: Math.round(box.width),
        h: Math.round(box.height),
        radius: tile ? getComputedStyle(tile).borderRadius : null,
        want: Math.round((share / 100) * Math.min(box.width, box.height) * 10) / 10,
      }
    })
    .filter((one) => one.radius)
  const widest = shaped.slice().sort((one, two) => two.w / two.h - one.w / one.h)[0]
  const corners = widest
    ? 'widest ' + widest.w + 'x' + widest.h + ' radius ' + widest.radius + ' (want ' + widest.want + 'px)'
    : 'no tile'

  return [
    '  before   ' + JSON.stringify(before),
    '  held     ' + JSON.stringify(held),
    '  released ' + JSON.stringify(released),
    '  menuOnRelease ' + Boolean(menu),
    '  leftHeld ' + JSON.stringify(leftHeld),
    '  leftReleased ' + JSON.stringify(leftReleased),
    '  plain mark ' + bare + ' -> ' + stretched,
    '  pressOnEmpty ' + onEmpty,
    '  blankTile ' + blankTile,
    '  corners ' + corners,
    '  ctrlPick ' + picked,
    '  ctrlReaches ' + reaches,
    '  searchBar ' + barHold,
  ].join('\\n')
})()`

const interactions = await send('Runtime.evaluate', { expression: PEEK, returnByValue: true, awaitPromise: true })
console.log('interactions')
console.log(String((interactions.result && interactions.result.value) || JSON.stringify(interactions)))

browser.kill('SIGKILL')
server.kill('SIGKILL')
process.exit(0)
