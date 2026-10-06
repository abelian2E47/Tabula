/**
 * The board itself.
 *
 * Owns the three things that need the whole canvas at once: where the openings
 * are, which opening the pointer is currently asking for, and what the keyboard
 * is doing. What a single plate looks like lives in `Plate`; everything that is
 * not the canvas lives in `Chrome`.
 *
 * A position is expressed in openings, so the only thing this component ever
 * measures is the box the openings have to fit into. One measurement per resize
 * and every position on the canvas follows from it.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useT } from '../i18n'
import {
  boxToPx,
  computeField,
  findOpening,
  isFree,
  keysFor,
  launchOrder,
  pointToBox,
  type Box,
  type Field,
} from '../layout/grid'
import { useImageSource, useMeasuredSize, usePrefersReducedMotion, useTurn } from '../lib/hooks'
import { Collection } from '../collection/Collection'
import { flatWallpaper } from '../model/defaults'
import { sameWallpaper } from '../model/wallpaper'
import { materialVars } from '../model/material'
import { useStore } from '../model/store'
import { PERFORMANCE, modifierHeld, modifierKeysOf, widgetView, type Plate, type TintToken } from '../model/types'
import { surface } from '../platform/browser'
import { AddPopover, FolderPanel, PageMenu, PlateMenu, SettingsDrawer, WallMenu, type AddDraft } from './Chrome'
import { PlateView, engineOf, type PlateActions } from './Plate'

export const TINT: Record<TintToken, string> = {
  slate: '#7c848f',
  blue: '#3b82f6',
  green: '#22a06b',
  amber: '#d98a1f',
  rose: '#e5484d',
  violet: '#8b5cf6',
}

/** How long a press is held before the canvas admits it is being arranged. */
const ARRANGE_AFTER_MS = 260

/** Movement below this is a click that wobbled, not a drag. */
const DRAG_SLOP = 4

/**
 * How long a search bar must be held before it can be carried.
 *
 * A bar is nearly all field, and a press on it is aimed at the field far more often
 * than at the bar: grabbing on the press meant a click that missed the text by a few
 * pixels could drag the bar off its row. A hold says the difference out loud — hold
 * the bar and it comes with you, tap it and nothing moves.
 */
const SEARCH_HOLD_MS = 1500

/**
 * How far the pointer may shake while a search bar is being held.
 *
 * More room than a drag's own slop, because this is a wait rather than a gesture:
 * nothing is being measured until it is armed, and a hand resting on a button is not
 * as still as a hand drawing a line.
 */
const SEARCH_HOLD_SLOP = 8

/** Held inside a range, for the numbers the appearance is worked out from. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * Eat the click the browser dispatches when a drag ends.
 *
 * A press and a release is a click whatever happened in between, so every drag
 * ends with one — aimed at the plate that was carried, or at whatever control
 * the pointer came to rest on. Captured at the very top so it dies before it
 * reaches a handler, and disarmed on the next click or shortly after either
 * way, because a listener that outlives its gesture is a board that ignores
 * the next honest press.
 */
function swallowNextClick(): void {
  const eat = (event: Event) => {
    event.stopPropagation()
    event.preventDefault()
    globalThis.removeEventListener('click', eat, true)
  }
  globalThis.addEventListener('click', eat, true)
  globalThis.setTimeout(() => globalThis.removeEventListener('click', eat, true), 500)
}

/** A band narrower than this in either direction is a press on the wall. */
const BAND_MIN = 12

interface Point {
  x: number
  y: number
}

interface DragState {
  id: string
  /** Where the plate is being held, in canvas pixels — free, unsnapped. */
  left: number
  top: number
  /** The opening it would take if the pointer were released now. */
  box: Box
  /** False when nothing fits anywhere near the pointer. */
  fits: boolean
  /** The folder the pointer is over, if any: dropping there files the plate. */
  onto?: string
}

interface BatchMove {
  ids: string[]
  /** How far the whole selection is being carried, in cells. */
  dx: number
  dy: number
  /** The same carry in pixels, which is what the selection is drawn at: it
   *  floats under the pointer and only rounds to cells when released. */
  px: number
  py: number
  /** Whether every plate in the selection has room where it would land. */
  ok: boolean
  boxes: Array<Point & { id: string }>
}

export function Board() {
  const t = useT()
  const {
    ready,
    board,
    settings,
    bays,
    bayId,
    goToBay,
    addBay,
    removeBay,
    patchBay,
    addPlate,
    patchPlate,
    patchPlates,
    patchSettings,
    groupPlates,
    removePlate,
  } = useStore()

  const [hostRef, size] = useMeasuredSize<HTMLDivElement>()
  const [drag, setDrag] = useState<DragState | null>(null)
  /**
   * A move of a whole selection: the plates keep their shape and their spacing
   * and go exactly this far, in whole cells. `ok` is false when the move would
   * land on something, in which case nothing moves at all — half a move is
   * worse than none, because it silently rearranges what you gathered.
   */
  const [batch, setBatch] = useState<BatchMove | null>(null)
  /** A band drawn across empty canvas, in canvas pixels. */
  const [band, setBand] = useState<{ from: Point; to: Point } | null>(null)
  const [forcedGrid, setForcedGrid] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [mods, setMods] = useState({ pick: false, reveal: false })
  const [menu, setMenu] = useState<{
    plate: Plate
    at: { x: number; y: number }
    /** The pick a right press was made inside, when it was made inside one. */
    targets: string[]
  } | null>(null)
  /**
   * The settings a pick is owed, waiting for Ctrl to be let go.
   *
   * A right press under Ctrl gathers and asks nothing: what it did mean is that the
   * settings for the whole of it should open when the key that gathered them comes
   * up, and the anchor has to be kept until then because the press is long over.
   */
  const owedMenu = useRef<{ plate: Plate; at: { x: number; y: number }; targets: string[] } | null>(null)
  const [addAt, setAddAt] = useState<{ x: number; y: number; into?: string } | null>(null)
  /**
   * The board's own menu, from a right press that missed every tile.
   *
   * It is kept apart from the add popover because the two answer different
   * questions: this one is about the board — make a place, change the picture
   * behind it, start again — and the add popover is about what goes *in* a place,
   * which is a question a tile asks rather than the wallpaper.
   */
  const [wallAt, setWallAt] = useState<{ x: number; y: number; cell: { x: number; y: number } } | null>(null)
  const [drawer, setDrawer] = useState(false)
  /** The folder whose contents are currently spread open. */
  // A folder opens as a sheet across the wall rather than a menu beside it, so

  // it needs the folder and nothing about where it was pressed.

  const [folder, setFolder] = useState<Plate | null>(null)
  /** The rail tag whose menu is open. */
  const [pageMenu, setPageMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null)

  const canvasRef = useRef<HTMLDivElement | null>(null)
  const addButtonRef = useRef<HTMLButtonElement | null>(null)
  const cancelDrag = useRef<(() => void) | null>(null)

  /* ---------------------------------------------------------------- */
  /* Wallpaper                                                         */
  /* ---------------------------------------------------------------- */

  /*
   * What is hanging on the wall.
   *
   * The shelf the user filled decides this only while it is *taking turns*. A rule
   * that is off means the picture that was chosen stays, and the shelf is what it can
   * be changed through — by the switch on the board, by the menu, by the drawer.
   * Reading the shelf as a sequence whenever it is not empty would pin the wall to
   * its first entry and make every other way of changing it do nothing.
   *
   * With a rule of some kind the answer is worked out from the clock, so a board
   * opened at eleven in the evening shows the evening's wallpaper rather than the one
   * that was hanging when it was last closed; the record is then kept in step with
   * what is shown, which is what lets a hand-press move on from the picture in front
   * of the reader.
   */
  const turning = settings.wallRotation.mode !== 'off' && settings.wallpapers.length > 1
  const turn = useTurn(settings.wallRotation, settings.wallpapers.length)
  const wallpaper = turning ? settings.wallpapers[turn] ?? settings.wallpaper : settings.wallpaper
  useEffect(() => {
    if (!turning) return
    if (sameWallpaper(wallpaper, settings.wallpaper)) return
    patchSettings({ wallpaper })
  }, [patchSettings, settings.wallpaper, turning, wallpaper])
  const photo = useImageSource(
    wallpaper.kind === 'upload' ? wallpaper.key : null,
    wallpaper.kind === 'url' ? wallpaper.url : null,
  )
  const flat = wallpaper.kind === 'flat' ? flatWallpaper(wallpaper.id) : undefined
  // What the wallpaper is made of. The layers are named by the stylesheet, one
  // set per material, and stacked here rather than there because the picture is
  // the last layer and only this much of the stack is the board's to know: the
  // stylesheet says what a sheet of acrylic looks like, and the board says what
  // is under it.
  const wall = settings.wall
  /*
   * How much of the machine the board may spend, and what it buys.
   *
   * One answer with two readings, because they are the same question asked about
   * two different costs. `motion` is how long a thing takes to arrive — an
   * animation nobody asked for is a heavy luxury on a slow machine and a cheap
   * pleasure on a fast one. `fx` is what the materials may cost: glass is bought
   * with a diffusion the compositor has to run over every pane on the board, and
   * a wallpaper under it with a second one over the whole window.
   *
   * The reader's own request for less movement outranks the setting — it is a
   * request, not a preference — so it stops the movement outright while leaving
   * the materials where the user put them. Someone who asked their system for
   * stillness did not thereby ask for a card instead of glass.
   */
  const reduced = usePrefersReducedMotion()
  const performance = settings.performance
  const { motion: wanted, fx } = PERFORMANCE[performance] ?? PERFORMANCE.high
  const motion = reduced ? 0 : wanted
  const wallStyle: CSSProperties = {
    ...(photo
      ? { backgroundImage: `var(--wall-layers, none), url("${photo}")` }
      : flat
        ? { background: flat.colour, backgroundImage: 'var(--wall-layers, none)' }
        : { backgroundImage: 'var(--wall-layers, none)' }),
    // A blurred layer softens its own edges into whatever is behind it, so the
    // wall is grown by the blur it is wearing and the window keeps the fringe
    // outside itself. Twice the blur is past the last pixel it can reach.
    ['--wall-blur' as string]: `${wall.blur}px`,
    ['--wall-bleed' as string]: `${wall.blur * 2}px`,
    ...(wall.kind === 'custom' ? { ['--wall-tint' as string]: wall.colour ?? 'transparent' } : null),
  }

  /* ---------------------------------------------------------------- */
  /* Geometry                                                          */
  /* ---------------------------------------------------------------- */

  const field: Field = useMemo(() => {
    // A little breath inside the stage's own padding, so the outermost
    // openings never sit against the edge of the window.
    const inset = 4
    return computeField(
      Math.max(0, size.width - inset * 2),
      Math.max(0, size.height - inset * 2),
      settings.cols,
      settings.rows,
    )
  }, [size.width, size.height, settings.cols, settings.rows])

  const plates = useMemo(
    // What a folder holds is not on the grid: it is reached by opening the
    // folder, so it is drawn there and takes no room here.
    () => board.plates.filter((plate) => plate.pageId === bayId && !plate.hidden && !plate.folderId),
    [board.plates, bayId],
  )
  const keys = useMemo(() => keysFor(board.plates, bayId), [board.plates, bayId])
  const order = useMemo(() => launchOrder(board.plates, bayId), [board.plates, bayId])
  /** The bar a press on the focus key should land in. */
  const primarySearch = useMemo(() => plates.find((plate) => plate.kind === 'search'), [plates])

  /* ---------------------------------------------------------------- */
  /* Appearance written onto the document                              */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = settings.theme
    // Whether the marks sit on a picture, on a pale fill or on a dark one is
    // what decides between dark ink and light ink with a shadow. A photograph
    // is always treated as dark, because a name has to survive the worst part
    // of the picture, not its average — and a wall under ground glass is the
    // exception to that, because most of what is left of the picture is the
    // veil, and the veil is the theme's own colour.
    const glassed = settings.wall.kind === 'frosted'
    root.dataset.wall = glassed ? settings.theme : photo ? 'photo' : (flat?.theme ?? settings.theme)
    root.dataset.names = settings.showNames ? 'on' : 'off'
    // How much of the machine this board may spend, as an attribute, so a rule
    // that should be dropped outright can say so rather than being softened into
    // something that still costs the same. Grain is the one that is dropped: it
    // is a blended raster over every pane, and a pane of frost without it is
    // still a pane of frost.
    root.dataset.fx = performance
    root.style.setProperty('--mat-texture', fx < 0.5 ? 'none' : 'var(--glass-grain)')
    root.style.setProperty('--motion', String(motion))
    // The tile's corner, as the *share* it is set in. The plate turns it into a
    // length once it has measured itself: a share of a box that is not square is a
    // different curve on the top edge from the one down the side, and one length
    // taken from the narrow side is the same curve all the way round.
    root.style.setProperty('--tile-radius-share', String(settings.tileRadius))
    root.style.setProperty('--image-radius', `${settings.imageRadius}%`)
    // A bar's own corner, which is a length for the reason the tile's is a share:
    // a bar is long and short at once, and a share of it is an ellipse. It is the
    // chrome's `--radius` that this takes over for search bars alone.
    root.style.setProperty('--bar-radius', `${settings.barRadius}px`)
    root.style.setProperty('--wall-margin', `${settings.wallMargin}vw`)
    root.style.setProperty('--icon-size', String(settings.iconSize))
    root.style.setProperty('--name-size', `${settings.nameSize}px`)
    // Where marks stand on their tiles, in per cent of a mark's own size. A plate
    // writes its own pair over these when it was given one.
    root.style.setProperty('--mark-x', String(settings.markOffset.x))
    root.style.setProperty('--mark-y', String(settings.markOffset.y))
    // The two details a mark carries are read by the plate rather than by the
    // board, because a tile may answer for itself and a tile is where the
    // material — and so the ink the edge is drawn in — is known.
    root.style.setProperty('--image-blur', `${settings.imageBlur}px`)
    root.style.setProperty('--engine-mark', `${settings.engineMark}px`)

    /*
     * How much of each material there is, written once per layer.
     *
     * The board's own answer, on the root element. Every material rule in the
     * stylesheet reads these, so a plate that was given a strength of its own does
     * not need a rule of its own either: it writes the same set over itself and the
     * rules under it go on reading names. See `materialVars`.
     *
     * The background layer is written with the transparency's share of the
     * wallpaper's own veil applied to it, which is the one place the two sheets
     * touch: a background at a hundred is meant to be the wall, and the wall may
     * itself be under glass.
     */
    for (const [name, value] of Object.entries(
      materialVars(
        settings.backgroundMaterial.strength,
        settings.backgroundMaterial.transparency,
        performance,
        'background',
      ),
    )) {
      root.style.setProperty(name, value)
    }
    for (const [name, value] of Object.entries(
      materialVars(settings.iconMaterial.strength, settings.iconMaterial.transparency, performance, 'mark'),
    )) {
      root.style.setProperty(name, value)
    }

    // And the wall's own three numbers, which are not a pane's: a film that reads
    // as glass across seventy pixels is invisible across a window.
    const wallShare = clamp(settings.wall.strength / 100, 0, 1)
    root.style.setProperty('--wall-acrylic-mix', `${(3 + 18 * wallShare).toFixed(1)}%`)
    root.style.setProperty('--wall-frost-mix', `${(14 + 38 * wallShare).toFixed(1)}%`)
    root.style.setProperty('--wall-liquid-mix', `${(6 + 30 * wallShare).toFixed(1)}%`)
    root.style.setProperty('--wall-frost-diffuse', `${((4 + 22 * wallShare) * (0.6 + 0.4 * fx)).toFixed(1)}px`)
    root.lang = settings.locale === 'zh' ? 'zh-CN' : 'en'
  }, [
    settings.theme,
    settings.tileRadius,
    settings.imageRadius,
    settings.barRadius,
    settings.wallMargin,
    settings.locale,
    settings.showNames,
    settings.iconSize,
    settings.nameSize,
    settings.backgroundMaterial,
    settings.iconMaterial,
    settings.wall.kind,
    settings.wall.strength,
    settings.imageBlur,
    settings.engineMark,
    performance,
    motion,
    fx,
    photo,
    flat,
  ])

  /*
   * Where the light is.
   *
   * Every material on this board is lit, and all of them are lit from the same
   * place — that is most of what makes a wall of glass read as a wall of glass
   * rather than as a set of separately decorated tiles. So the light is one thing
   * on the page and not a fact about each sheet: its position is written once, here,
   * as a direction, and every sheen, every catch along a cut and every refraction
   * follows it.
   *
   * It follows the pointer, which is the one moving thing in the room, and it is
   * written as an offset from the middle of the window rather than as a coordinate:
   * a sheet in the corner of the page and a sheet in the middle both catch the
   * light on the same side, which is what a single lamp over a desk does. Nothing
   * is written when the board is asked not to move.
   */
  useEffect(() => {
    const root = document.documentElement
    if (motion < 0.5) {
      root.style.setProperty('--light-dx', '0')
      root.style.setProperty('--light-dy', '0')
      return
    }
    let frame = 0
    let nextX = 0
    let nextY = 0
    const write = () => {
      frame = 0
      root.style.setProperty('--light-dx', nextX.toFixed(3))
      root.style.setProperty('--light-dy', nextY.toFixed(3))
    }
    const onMove = (event: PointerEvent) => {
      nextX = clamp((event.clientX / window.innerWidth - 0.5) * 2, -1, 1)
      nextY = clamp((event.clientY / window.innerHeight - 0.5) * 2, -1, 1)
      if (!frame) frame = requestAnimationFrame(write)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [motion])

  /* ---------------------------------------------------------------- */
  /* Relocation: when the grid shrinks, nothing may fall off it         */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!ready) return
    const bounds = { cols: settings.cols, rows: settings.rows }
    // Later placements have to see earlier ones, or two displaced plates can
    // be sent to the same opening.
    const working = board.plates.map((plate) => ({ ...plate }))
    const updates: Array<{ id: string; x: number; y: number }> = []

    for (const plate of working) {
      if (plate.pageId !== bayId || plate.folderId) continue
      const box: Box = { x: plate.x, y: plate.y, w: plate.w, h: plate.h }
      if (isFree(working, bayId, box, bounds, plate.id)) continue
      const spot = findOpening(working, bayId, bounds, plate.w, plate.h, plate.x, plate.y, plate.id) ?? {
        // Nothing fits: hold the plate inside the field anyway, because a plate
        // drawn off the canvas is worse than two plates overlapping.
        x: Math.max(0, Math.min(plate.x, Math.max(0, settings.cols - plate.w))),
        y: Math.max(0, Math.min(plate.y, Math.max(0, settings.rows - plate.h))),
      }
      plate.x = spot.x
      plate.y = spot.y
      updates.push({ id: plate.id, ...spot })
    }

    if (updates.length > 0) patchPlates(updates)
  }, [ready, bayId, board.plates, settings.cols, settings.rows, patchPlates])

  /* ---------------------------------------------------------------- */
  /* Activation                                                        */
  /* ---------------------------------------------------------------- */

  /** Where a plate is on screen, so a panel can be hung off it. */
  const anchorOf = useCallback((id: string, gap: number): { x: number; y: number } => {
    const rect = canvasRef.current?.querySelector(`[data-plate="${id}"]`)?.getBoundingClientRect()
    return rect ? { x: rect.left, y: rect.bottom + gap } : { x: 48, y: 64 }
  }, [])

  const activate = useCallback(
    (plate?: Plate) => {
      if (!plate) return
      if (plate.kind === 'link' && plate.url) {
        void surface.openUrl(plate.url, true)
        return
      }
      // A folder opens the same way, for the same reason.
      if (plate.kind === 'folder') {
        setFolder(plate)
        return
      }
      // A widget hands the tab over to its own full view: the board is a window
      // onto it, and the window is not the point.
      const view = plate.kind === 'widget' ? widgetView(plate.widget) : null
      if (view) void surface.openView(view)
    },
    [anchorOf],
  )

  /* ---------------------------------------------------------------- */
  /* Keyboard                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Key → the plate it launches. Built once from the launch order rather than
   * searched per keystroke, because this runs on every key of every press.
   */
  const byKey = useMemo(() => {
    const map = new Map<string, Plate>()
    for (const plate of order) {
      const key = keys.get(plate.id)
      if (key) map.set(key, plate)
    }
    return map
  }, [order, keys])

  /** The selection, readable from a listener that must not re-subscribe. */
  const selectedRef = useRef<string[]>([])
  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  const focusSearch = useCallback(() => {
    const plate = primarySearch
    if (!plate) return
    canvasRef.current?.querySelector(`[data-plate="${plate.id}"]`)?.querySelector('input')?.focus()
  }, [primarySearch])

  useEffect(() => {
    // Which keys are held, and which keys those are: both readings come from the two
    // settings, so changing them needs nothing else to know.
    const held = (event: KeyboardEvent) => ({
      pick: modifierHeld(settings.pickModifier, event),
      reveal: modifierHeld(settings.revealModifier, event),
    })
    const sync = (event: KeyboardEvent) => {
      const now = held(event)
      setMods((current) => (current.pick === now.pick && current.reveal === now.reveal ? current : now))
    }
    const clear = () => setMods({ pick: false, reveal: false })

    const onKeyDown = (event: KeyboardEvent) => {
      sync(event)
      const target = event.target
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      if (event.key === 'Escape') {
        cancelDrag.current?.()
        setSelected([])
        setMenu(null)
        setAddAt(null)
        setFolder(null)
        setPageMenu(null)
        setBand(null)
        setBatch(null)
        return
      }
      if (typing) return

      const { pick, reveal } = held(event)

      // Space (or whatever it has been changed to) jumps to the search bar.
      if (event.key === settings.focusKey && !pick && !reveal) {
        if (primarySearch) {
          event.preventDefault()
          focusSearch()
        }
        return
      }

      // Enter or Delete throws away whatever is picked. It is the keyboard's
      // way of saying "take it down", and it does nothing at all when nothing is
      // picked — which is what keeps a stray Enter in the middle of the board
      // from removing something by accident.
      if ((event.key === 'Enter' || event.key === 'Delete' || event.key === 'Backspace') && !pick && !reveal) {
        const current = selectedRef.current
        if (current.length === 0) return
        event.preventDefault()
        if (event.repeat) return
        setSelected([])
        for (const id of current) removePlate(id)
        return
      }

      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key

      // The reveal key launches, and both keys at once read as it rather than as a
      // third gesture: there is no revealing-and-gathering command to confuse it with.
      if (reveal) {
        const plate = byKey.get(key)
        if (!plate) return
        event.preventDefault()
        if (event.repeat) return
        activate(plate)
        return
      }

      // The pick key gathers. What it gathered opens when it is let go.
      if (pick) {
        const plate = byKey.get(key)
        if (!plate) return
        event.preventDefault()
        setSelected((current) =>
          current.includes(plate.id) ? current.filter((id) => id !== plate.id) : [...current, plate.id],
        )
        return
      }

      // An unmodified digit flips to that page.
      if (/^[1-9]$/.test(key)) {
        const page = bays[Number(key) - 1]
        if (!page) return
        event.preventDefault()
        goToBay(page.id)
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      sync(event)
      // Letting the pick key go is the commit. What it commits to depends on the
      // button that did the gathering: a right press was about settings, so the
      // settings open — once, for the pick — and a left press or the keys were about
      // the things themselves, so they open.
      if (modifierKeysOf(settings.pickModifier).includes(event.key)) {
        const owed = owedMenu.current
        if (owed) {
          owedMenu.current = null
          setMenu(owed)
          return
        }
        const current = selectedRef.current
        if (current.length === 0) return
        setSelected([])
        for (const id of current) activate(board.plates.find((candidate) => candidate.id === id))
      }
    }

    globalThis.addEventListener('keydown', onKeyDown)
    globalThis.addEventListener('keyup', onKeyUp)
    globalThis.addEventListener('blur', clear)
    return () => {
      globalThis.removeEventListener('keydown', onKeyDown)
      globalThis.removeEventListener('keyup', onKeyUp)
      globalThis.removeEventListener('blur', clear)
    }
  }, [
    byKey,
    activate,
    bays,
    goToBay,
    board.plates,
    primarySearch,
    focusSearch,
    removePlate,
    settings.focusKey,
  ])

  /* ---------------------------------------------------------------- */
  /* Dragging                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Carry the whole selection a whole number of cells.
   *
   * The selection moves as one thing — it keeps its shape and its spacing — and
   * it either fits where it is going or it does not move at all. Settling it
   * plate by plate would rearrange the arrangement the user just gathered,
   * which is the opposite of what gathering it was for.
   */
  const startBatchMove = useCallback(
    (startX: number, startY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const pitchX = field.tile + field.gapX
      const pitchY = field.tile + field.gapY
      const bounds = { cols: settings.cols, rows: settings.rows }
      const ids = [...selected]
      const moving = board.plates.filter((candidate) => ids.includes(candidate.id))
      const resting = board.plates.filter((candidate) => !ids.includes(candidate.id))

      let live = true
      let moved = false
      /** The pointer, kept outside the frame loop for the same reason as a
       *  single plate's: the frame that drew the last preview took it with it. */
      const last = { x: startX, y: startY }

      const resolve = (clientX: number, clientY: number): BatchMove => {
        // The selection is drawn where the pointer is and rounds to cells only
        // at the end, so a whole row of plates can be nudged across the board
        // without every plate jumping a cell at a time on the way.
        const px = clientX - startX
        const py = clientY - startY
        const dx = Math.round(px / pitchX)
        const dy = Math.round(py / pitchY)
        const boxes = moving.map((candidate) => ({ id: candidate.id, x: candidate.x + dx, y: candidate.y + dy }))
        const ok =
          (dx !== 0 || dy !== 0) &&
          moving.every((candidate, index) => {
            const box = boxes[index]
            if (
              box.x < 0 ||
              box.y < 0 ||
              box.x + candidate.w > bounds.cols ||
              box.y + candidate.h > bounds.rows
            ) {
              return false
            }
            return isFree(resting, bayId, { x: box.x, y: box.y, w: candidate.w, h: candidate.h }, bounds, candidate.id)
          })
        return { ids, dx, dy, px, py, ok, boxes }
      }

      let frame = 0
      let pending: { x: number; y: number } | null = null
      const flush = () => {
        frame = 0
        if (!pending || !live) return
        const next = resolve(pending.x, pending.y)
        pending = null
        setBatch(next)
      }

      const onMove = (moveEvent: PointerEvent) => {
        if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > DRAG_SLOP) {
          moved = true
        }
        last.x = moveEvent.clientX
        last.y = moveEvent.clientY
        pending = { x: last.x, y: last.y }
        if (frame === 0) frame = globalThis.requestAnimationFrame(flush)
      }

      const finish = (commit: boolean) => {
        if (!live) return
        live = false
        if (frame) globalThis.cancelAnimationFrame(frame)
        globalThis.removeEventListener('pointermove', onMove)
        globalThis.removeEventListener('pointerup', up)
        globalThis.removeEventListener('pointercancel', cancel)
        cancelDrag.current = null

        if (moved) swallowNextClick()

        // Same as a single plate: the last pointer position is the drop, and
        // the whole selection goes to it or none of it does.
        const settled = moved ? resolve(last.x, last.y) : null
        pending = null
        if (commit && settled && settled.ok) {
          patchPlates(settled.boxes.map((box) => ({ id: box.id, x: box.x, y: box.y })))
        }
        setBatch(null)
      }

      const up = () => finish(true)
      const cancel = () => finish(false)
      cancelDrag.current = cancel

      globalThis.addEventListener('pointermove', onMove)
      globalThis.addEventListener('pointerup', up)
      globalThis.addEventListener('pointercancel', cancel)
    },
    [bayId, board.plates, field, patchPlates, selected, settings.cols, settings.rows],
  )

  /**
   * Draw a band across the canvas to gather whatever it covers.
   *
   * The band needs no modifier: a press on empty wall that drags is
   * unambiguous, because nothing else on the board answers to it.
   */
  const startBand = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      if ((event.target as HTMLElement).closest('[data-plate]')) return
      const canvas = canvasRef.current
      if (!canvas) return

      const canvasRect = canvas.getBoundingClientRect()
      const at = (clientX: number, clientY: number): Point => ({
        x: clientX - canvasRect.left,
        y: clientY - canvasRect.top,
      })
      const from = at(event.clientX, event.clientY)
      let latest = from
      setSelected([])
      setBand({ from, to: from })

      /** Whatever the band covers between two corners, by the field's own boxes. */
      const hitsFor = (point: Point): string[] => {
        const left = Math.min(from.x, point.x)
        const top = Math.min(from.y, point.y)
        const right = Math.max(from.x, point.x)
        const bottom = Math.max(from.y, point.y)
        // A band that barely moved is a press on the wall, not a selection.
        if (right - left < BAND_MIN || bottom - top < BAND_MIN) return []
        return plates
          .filter((plate) => {
            const box = boxToPx(field, plate)
            return box.left < right && box.left + box.width > left && box.top < bottom && box.top + box.height > top
          })
          .map((plate) => plate.id)
      }

      let live = true
      let frame = 0
      const flush = () => {
        frame = 0
        if (!live) return
        setBand({ from, to: latest })
        // Marked while the band is still being drawn, not once it is let go: a
        // sweeping rectangle tells the person holding the mouse what it covers
        // and nobody else, and the point of picking things is to see what you
        // picked before you commit to it.
        setSelected(hitsFor(latest))
      }
      const onMove = (moveEvent: PointerEvent) => {
        latest = at(moveEvent.clientX, moveEvent.clientY)
        if (frame === 0) frame = globalThis.requestAnimationFrame(flush)
      }
      const finish = () => {
        if (!live) return
        live = false
        if (frame) globalThis.cancelAnimationFrame(frame)
        globalThis.removeEventListener('pointermove', onMove)
        globalThis.removeEventListener('pointerup', finish)
        globalThis.removeEventListener('pointercancel', finish)
        setBand(null)
        setSelected(hitsFor(latest))
      }

      globalThis.addEventListener('pointermove', onMove)
      globalThis.addEventListener('pointerup', finish)
      globalThis.addEventListener('pointercancel', finish)
    },
    [field, plates],
  )

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, plate: Plate) => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement
      // Text fields keep their own pointer behaviour, and so does an open list
      // of engines: a press there is aimed at a row. Everything else on a plate
      // carries it — including the marks and the buttons, because a search bar
      // is nearly all field and has to be grabbable by what is left of it. A
      // press that moves is a drag and the click it would have been is eaten, so
      // a press that does not move still reaches the control underneath.
      if (target.closest('input, select, textarea, .engines')) return
      // Named rather than reached for again inside the drag: the drag is armed
      // later than this press, and a board that has been replaced in between is not
      // a board this gesture is about.
      const stage = canvasRef.current
      if (!stage) return
      // Taken once, at the press: the whole gesture is measured against the board as
      // it stood when the finger went down, and a bar that is picked up a second and
      // a half later is still carried in that frame.
      const canvasRect = stage.getBoundingClientRect()

      // Pressing anything that is part of a selection moves the whole of it.
      // That is what makes a band useful: gather a row, then put the row
      // somewhere else in one gesture.
      const carry = () => {
        if (selected.length > 1 && selected.includes(plate.id)) startBatchMove(event.clientX, event.clientY)
        else beginDrag(event.clientX, event.clientY)
      }

      /*
       * A search bar is picked up deliberately, or not at all.
       *
       * A bar is nearly all field, so a press on the part of it that is not the field
       * is a press that was aiming at the field most of the time — and grabbing the
       * bar on that press meant a click into the field could carry the bar off its row
       * before the person had finished deciding where to type. So a bar waits: a
       * second and a half with the pointer held still, and then it can be carried;
       * a press that is let go, or that moves, before then was aimed at the field and
       * leaves the bar where it is. Everything *inside* the bar keeps its own press —
       * the field, the engine mark, the strip — which is why the wait is asked for
       * here, around the whole plate, rather than anywhere near them.
       */
      if (plate.kind !== 'search') {
        carry()
        return
      }
      const armed = globalThis.setTimeout(() => {
        release()
        carry()
      }, SEARCH_HOLD_MS)
      const from = { x: event.clientX, y: event.clientY }
      const drift = (move: PointerEvent) => {
        /*
         * A hand is not a machine.
         *
         * The wait used to end on the first `pointermove` at all, which meant a
         * deliberate hold was cancelled by the very hand doing the holding: a pixel
         * of shake and the bar was never picked up, while the press effect made it
         * look as though it had been. What ends the wait is a *move* — a few pixels
         * away from where the finger went down, which is the same thing the board
         * calls a drag everywhere else, with a little more room because this press
         * is not a drag until it has been armed.
         */
        if (Math.hypot(move.clientX - from.x, move.clientY - from.y) > SEARCH_HOLD_SLOP) release()
      }
      const release = () => {
        globalThis.clearTimeout(armed)
        globalThis.removeEventListener('pointerup', release)
        globalThis.removeEventListener('pointermove', drift)
      }
      globalThis.addEventListener('pointerup', release, { once: true })
      globalThis.addEventListener('pointermove', drift)

      /**
       * And the drag itself, armed above either at once or after the wait.
       *
       * A hoisted declaration rather than a `const`, and given the press's position
       * rather than the event: a bar is carried from the press that started the
       * wait, which is a second and a half earlier than the call, and the event is
       * long over by then. Everything else about the gesture — the grab, the slop,
       * the landing, the click the browser would have sent — is unchanged.
       */
      function beginDrag(startX: number, startY: number) {
        const rect = boxToPx(field, plate)
        const grabX = startX - (canvasRect.left + rect.left)
        const grabY = startY - (canvasRect.top + rect.top)
      /**
       * Where the pointer is, kept outside the frame loop.
       *
       * The preview is redrawn on animation frames, which means the frame that
       * drew the last one has already taken the position with it. Reading the
       * drop out of that variable drops from wherever the pointer happened to
       * be a frame ago — and when the pointer settles against the edge of the
       * grid, no further frames come at all, so the plate was shown landing on
       * the line and then went back to where it started.
       */
      const last = { x: startX, y: startY }

      let live = true
      let moved = false
      const gridTimer = globalThis.setTimeout(() => setForcedGrid(true), ARRANGE_AFTER_MS)

      const resolve = (clientX: number, clientY: number): DragState => {
        // The plate is held where the pointer is, and nothing pulls it towards a
        // cell while the finger is down: the cells are only entered on release,
        // when the drop rounds to the opening underneath. An earlier version
        // aimed at an opening all through the drag, which made a slow drag feel
        // like it was sticking to the grid and then springing back off it.
        const left = clientX - grabX - canvasRect.left
        const top = clientY - grabY - canvasRect.top
        const wanted = pointToBox(field, left, top)
        // Over a folder, the drop means "into this folder" rather than "on this
        // cell", so the landing spot stops mattering while the pointer is there.
        const hit = pointToBox(field, left + rect.width / 2, top + rect.height / 2)
        const over =
          plate.kind === 'folder'
            ? undefined
            : plates.find(
                (candidate) =>
                  candidate.kind === 'folder' &&
                  hit.x >= candidate.x &&
                  hit.x < candidate.x + candidate.w &&
                  hit.y >= candidate.y &&
                  hit.y < candidate.y + candidate.h,
              )?.id
        if (over) return { id: plate.id, left, top, box: { x: plate.x, y: plate.y, w: plate.w, h: plate.h }, fits: true, onto: over }
        const box: Box = { x: wanted.x, y: wanted.y, w: plate.w, h: plate.h }
        if (isFree(board.plates, bayId, box, field, plate.id)) return { id: plate.id, left, top, box, fits: true }
        const spot = findOpening(board.plates, bayId, field, plate.w, plate.h, wanted.x, wanted.y, plate.id)
        return spot
          ? { id: plate.id, left, top, box: { ...spot, w: plate.w, h: plate.h }, fits: true }
          : { id: plate.id, left, top, box, fits: false }
      }

      setDrag(resolve(startX, startY))

      let frame = 0
      let pending: { x: number; y: number } | null = null

      const flush = () => {
        frame = 0
        if (!pending || !live) return
        const next = resolve(pending.x, pending.y)
        pending = null
        setDrag(next)
      }

      const onMove = (moveEvent: PointerEvent) => {
        if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > DRAG_SLOP) {
          moved = true
        }
        last.x = moveEvent.clientX
        last.y = moveEvent.clientY
        pending = { x: last.x, y: last.y }
        if (frame === 0) frame = globalThis.requestAnimationFrame(flush)
      }

      const finish = (commit: boolean) => {
        if (!live) return
        live = false
        globalThis.clearTimeout(gridTimer)
        if (frame) globalThis.cancelAnimationFrame(frame)
        globalThis.removeEventListener('pointermove', onMove)
        globalThis.removeEventListener('pointerup', up)
        globalThis.removeEventListener('pointercancel', cancel)
        setForcedGrid(false)
        cancelDrag.current = null

        // A press that moved is a move, and the click the browser dispatches
        // after it belongs to the gesture that just ended, not to whatever
        // control happens to sit under the pointer. Swallowed in the capture
        // phase so it cannot reach a button inside a plate either — dragging a
        // search bar by its engine mark must not also open the engine panel.
        if (moved) swallowNextClick()

        // Where it lands is decided by where the pointer last was, not by
        // whether a frame got drawn: the preview rides on animation frames, and
        // a frame that never came must not turn a drop into a snap-back.
        const settled = moved ? resolve(last.x, last.y) : null
        pending = null
        if (commit && settled) {
          // Filing keeps the plate's place on the grid, because taking it back
          // out should put it where it was rather than somewhere it fits.
          if (settled.onto && settled.onto !== plate.folderId) patchPlate(settled.id, { folderId: settled.onto })
          else if (settled.fits && (settled.box.x !== plate.x || settled.box.y !== plate.y))
            patchPlate(settled.id, { x: settled.box.x, y: settled.box.y })
        }
        setDrag(null)
      }

      const up = () => finish(true)
      const cancel = () => finish(false)
      cancelDrag.current = cancel

      globalThis.addEventListener('pointermove', onMove)
      globalThis.addEventListener('pointerup', up)
      globalThis.addEventListener('pointercancel', cancel)
      }
    },
    [board.plates, bayId, field, patchPlate, plates, selected, startBatchMove],
  )

  /* ---------------------------------------------------------------- */
  /* Adding                                                            */
  /* ---------------------------------------------------------------- */

  const place = useCallback(
    (draft: AddDraft) => {
      const bounds = { cols: settings.cols, rows: settings.rows }
      // A new tile goes where the eye is looking: the middle of the top row, which
      // is where an unfurnished board has room and where the add button's own press
      // is pointing.
      const spot =
        findOpening(board.plates, bayId, bounds, draft.w, draft.h, Math.floor(settings.cols / 2), 0) ??
        findOpening(board.plates, bayId, bounds, draft.w, draft.h, 0, 0) ?? { x: 0, y: 0 }
      addPlate({ ...draft, pageId: bayId, ...spot })
    },
    [addPlate, bayId, board.plates, settings.cols, settings.rows],
  )

  /**
   * What goes into an empty tile, and where that is asked from.
   *
   * An empty tile is a place that has been made but not furnished: what it holds is
   * decided by right-pressing *it*, which is where the add menu opens for one. There
   * is one field a blank tile has to work out for itself, and that is which shape it
   * is: a bar is not one cell wide, so the draft's own span is honoured when the
   * board has room for it and the tile keeps its place either way. An empty tile is
   * small, so a bar put into one grows to the width a bar needs and lands on the row
   * the tile was standing on.
   */
  const fill = useCallback(
    (id: string, draft: AddDraft) => {
      const plate = board.plates.find((candidate) => candidate.id === id)
      if (!plate) return
      const bounds = { cols: settings.cols, rows: settings.rows }
      const room = { ...plate, w: draft.w, h: draft.h }
      const spot = isFree(board.plates, bayId, room, bounds, id)
        ? null
        : findOpening(board.plates, bayId, bounds, draft.w, draft.h, plate.x, plate.y, id)
      patchPlate(id, { ...draft, ...(spot ?? {}) })
    },
    [board.plates, bayId, patchPlate, settings.cols, settings.rows],
  )

  /** A place made for something, before anything has been decided about it. */
  const addBlankTile = useCallback(
    (cell: { x: number; y: number }) => {
      const bounds = { cols: settings.cols, rows: settings.rows }
      const spot = findOpening(board.plates, bayId, bounds, 1, 1, cell.x, cell.y)
      if (!spot) return
      addPlate({ kind: 'blank', shape: 'tile', w: 1, h: 1, pageId: bayId, ...spot })
    },
    [addPlate, bayId, board.plates, settings.cols, settings.rows],
  )

  /**
   * A different wallpaper, out of the shelf the user filled.
   *
   * "Different" rather than "any": a random change that lands on the picture already
   * hanging is a button that did nothing, and the shelf is small enough that one
   * exclusion is worth it.
   */
  const shuffleWallpaper = useCallback(() => {
    const shelf = settings.wallpapers
    if (shelf.length < 2) return
    const now = shelf.findIndex((one) => sameWallpaper(one, settings.wallpaper))
    const other = shelf.filter((_, index) => index !== now)
    patchSettings({ wallpaper: other[Math.floor(Math.random() * other.length)] ?? shelf[0] })
  }, [patchSettings, settings.wallpaper, settings.wallpapers])

  /*
   * What a press on a tile does.
   *
   * Held down, Ctrl turns the press into a pick rather than a launch — the same
   * pick the keys make, made with the hand. The tile is added to the selection and
   * nothing opens: what was gathered opens when Ctrl is let go, all at once, which
   * is the one moment that can mean "all of these" rather than "this one, now".
   * Without Ctrl a press is a launch, which is what a tile has always been.
   *
   * Ctrl is read from the press rather than from the tile, because the modifier is
   * held on the keyboard and the press is what carries it: a click that lands while
   * Ctrl is down is a pick, and one that lands after it has been let go is a launch.
   */
  const pressPlate = useCallback(
    (plate: Plate, withCtrl: boolean) => {
      if (!withCtrl) {
        activate(plate)
        return
      }
      setSelected((current) =>
        current.includes(plate.id) ? current.filter((id) => id !== plate.id) : [...current, plate.id],
      )
    },
    [activate],
  )

  const actions: PlateActions = useMemo(
    () => ({
      onPointerDown,
      onActivate: (plate, gathering) => pressPlate(plate, gathering),
      onContextMenu: (event, plate) => {
        event.preventDefault()
        /*
         * An empty tile asks what goes in it.
         *
         * It holds nothing, so there is nothing about it to configure: the only
         * question it raises is what it is for, and that question is the add menu —
         * opened here, on the tile, where the answer will land. Ctrl is not read
         * here: gathering empty tiles is not a thing anybody does, and a pick of
         * them would have no answers to give.
         */
        if (plate.kind === 'blank') {
          setAddAt({ x: event.clientX + 4, y: event.clientY + 4, into: plate.id })
          return
        }
        const gathering = Boolean(event.pickHeld)
        /*
         * A right press asks about a tile — unless the pick key is down, in which
         * case it only gathers.
         *
         * Held, the pick key turns both buttons into the same act: a press under it
         * gathers rather than commands, and the command is what happens to everything
         * gathered once the key is let go. That is the one moment that can mean "all
         * of these": with the left button it opens them, and with the right one it
         * opens the settings that reach the whole of them. Nothing opens per tile in
         * between, because a menu per tile is exactly what a pick is not.
         *
         * The set is worked out here rather than read back off the selection, because
         * the menu opens in the same turn as the press and a selection that has not
         * been rendered yet cannot say what was just gathered.
         */
        if (!gathering) {
          setMenu({
            plate,
            at: { x: event.clientX + 4, y: event.clientY + 4 },
            targets: selected.includes(plate.id) && selected.length > 1 ? selected : [],
          })
          return
        }
        const gathered = selected.includes(plate.id) ? selected : [...selected, plate.id]
        setSelected(gathered)
        const owed = { plate, at: { x: event.clientX + 4, y: event.clientY + 4 }, targets: gathered }
        // Ctrl already let go before the button came up — the pick is the commit,
        // and there is no release left to wait for.
        if (event.pickNow === false) setMenu(owed)
        else owedMenu.current = owed
      },      onSearch: (plate, query) => {
        const engine = engineOf(plate, settings)
        // Something with a dot in it is an address, not a query: typing a host
        // and pressing enter should go there rather than search for it.
        const asUrl = /^https?:\/\//i.test(query)
        const looksLikeHost = /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(query)
        const href = asUrl ? query : looksLikeHost ? `https://${query}` : null
        if (href) {
          void surface.openUrl(href, false)
          return
        }
        if (!engine) return
        void surface.openUrl(engine.urlTemplate.replace('%s', encodeURIComponent(query)), false)
      },
      onPickEngine: (plate, engineId) => patchPlate(plate.id, { engineId }),
    }),
    [onPointerDown, pressPlate, settings.pickModifier, selected, setSelected, settings, patchPlate],
  )

  /* ---------------------------------------------------------------- */

  const gridded = settings.grid === 'always' || forcedGrid || drag !== null || batch !== null || band !== null
  const canvasStyle: CSSProperties = {
    width: field.width,
    height: field.height,
    ['--tile' as string]: `${field.tile}px`,
    /* The 1×1 opening, which is the size a mark is measured against when it is
       told not to follow the tile it is standing in. */
    ['--cell' as string]: `${field.tile}px`,
    ['--pitch-x' as string]: `${field.tile + field.gapX}px`,
    ['--pitch-y' as string]: `${field.tile + field.gapY}px`,
  }

  if (!ready) return <div className="surface" aria-busy="true" />

  const page = bays.find((candidate) => candidate.id === bayId)
  /** Both modifiers reveal the keys; either one on its own is enough. */
  // Either key reveals the numbers: whoever is holding one of them is asking to see
  // what is launchable, and the two are the same question asked by two hands.
  const revealed = mods.reveal || mods.pick
  // What a folder holds, so the folder can show it and say how much of it there
  // is. Only folders ask, and only their own contents are passed down.
  const contentsOf = (plate: Plate): Plate[] | undefined =>
    plate.kind === 'folder' ? board.plates.filter((candidate) => candidate.folderId === plate.id) : undefined
  // A move that fits is shown as the move itself. One that does not is shown as
  // the opening it wanted, so the refusal is visible rather than silent.
  const batchShift = batch && batch.ok ? batch : null
  const batchBlocked = batch && !batch.ok ? batch : null

  return (
    <div className="surface">
      <div className="surface__wall" data-material={settings.wall.kind} style={wallStyle} />
      {photo ? <div className="surface__veil" /> : null}

      {/*
       * The spread a filled tile paints its mark with: the mark's own edge pixels
       * carried outward to the tile's edges, so that a tile filled with a logo goes
       * the colour the logo ends in rather than wearing a magnified logo.
       *
       * A filter is an element and not a value, so it is written once for the board
       * and asked for by name — every filled tile is asking the same question, and
       * one answer serves them all. It is a dilation (which alone among the
       * operations adds no colour the file does not have) softened by a small blur,
       * so the spread does not draw a rim of its own where it stops.
       *
       * The reach is set by the tile rather than by the mark: the mark is centred and
       * can be a tenth of the tile or larger than it, so the spread has to be able to
       * cross half of the widest tile the board draws from the smallest mark. The
       * region is widened with it, or the spread would be cut off by the filter's own
       * box rather than by the tile.
       *
       * A mark drawn as a cut-out — a solid disc with the logo punched out of it, and
       * nothing but transparency outside — would come out as a filled disc the colour
       * of the mark with no logo on it at all, since an enlargement cannot tell the
       * hole from the outside. Closing the mark's alpha fills its holes, and taking
       * the mark back out of that leaves nothing but the holes, which are then taken
       * out of the spread: the negative space of the mark stays open, showing what the
       * tile itself is made of, exactly as it did before the tile was filled.
       */}
      <svg className="spread" aria-hidden="true" focusable="false">
        <defs>
          <filter id="mark-spread" x="-100%" y="-100%" width="300%" height="300%" colorInterpolationFilters="sRGB">
            <feMorphology in="SourceGraphic" operator="dilate" radius="80" result="spread" />
            <feMorphology in="SourceAlpha" operator="dilate" radius="30" result="thick" />
            <feMorphology in="thick" operator="erode" radius="30" result="closed" />
            <feComposite in="closed" in2="SourceAlpha" operator="out" result="holes" />
            <feComposite in="spread" in2="holes" operator="out" result="filled" />
            <feGaussianBlur in="filled" stdDeviation="3" />
          </filter>

          {/*
           * What liquid glass bends.
           *
           * A pane of glass laid on a surface is neutral in the middle and bends
           * what is behind it at the rim, which is where the surface turns from
           * underneath the sheet into the wall beside it. So the map that drives
           * the displacement is flat grey in the middle and pulls to one side at
           * the edge: nothing moves under the middle of the sheet, and the wall
           * leans a little where it meets the cut.
           *
           * The direction is the light's, not the element's, so it agrees with
           * the sheen every material here is lit by — the light comes from the
           * upper left of the page and every sheet is drawn as though it did.
           *
           * It is one filter for the board for the same reason the spread is: a
           * filter is an element, not a value, and every liquid sheet is asking
           * the same question. It is asked only where the machine can afford a
           * second pass — see `--liquid-filter` in `materialVars`.
           */}
          <filter id="lg-refract" x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
            <feImage
              href={
                'data:image/svg+xml,' +
                encodeURIComponent(
                  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>" +
                    "<radialGradient id='m' cx='50%' cy='50%' r='70%'>" +
                    "<stop offset='52%' stop-color='#808080'/>" +
                    "<stop offset='100%' stop-color='#ff6f5e'/>" +
                    '</radialGradient>' +
                    "<rect width='100' height='100' fill='url(#m)'/>" +
                    '</svg>',
                )
              }
              preserveAspectRatio="none"
              result="map"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale="18"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      <div className="stage" data-rail={settings.rail.edge}>
        {page?.view ? (
          <div className="board-view">
            <Collection source={page.view} embedded />
          </div>
        ) : (
        <div className="canvas-host" ref={hostRef}>
          <div
            className={`canvas${gridded ? ' canvas--gridded' : ''}${selected.length ? ' canvas--picking' : ''}`}
            ref={canvasRef}
            style={canvasStyle}
            onPointerDown={startBand}
            onContextMenu={(event) => {
              /*
               * A right press on the board itself: the board's own menu, at the
               * pointer, remembering which opening it was over.
               *
               * The press only reaches here when it missed every plate and every
               * folder cover, so "here" is an empty opening. What that opening is
               * wanted for is decided next — a place to put something, a different
               * wallpaper, or a fresh start — and the opening is worked out now,
               * while the press still knows where it was.
               */
              event.preventDefault()
              const rect = canvasRef.current?.getBoundingClientRect()
              setWallAt({
                x: event.clientX + 4,
                y: event.clientY + 4,
                cell: rect ? pointToBox(field, event.clientX - rect.left, event.clientY - rect.top) : { x: 0, y: 0 },
              })
            }}
          >
            <div className="canvas__grid" />

            {batchBlocked
              ? batchBlocked.boxes.map((box) => {
                  const source = plates.find((plate) => plate.id === box.id)
                  if (!source) return null
                  const rect = boxToPx(field, { ...source, x: box.x, y: box.y })
                  return (
                    <span
                      key={box.id}
                      className="drop-target drop-target--refused"
                      style={{ ...rect, left: rect.left + batchBlocked.px, top: rect.top + batchBlocked.py }}
                      aria-hidden="true"
                    />
                  )
                })
              : null}

            {/* Where the tile would land if it were let go right now. It is
                drawn as a shadow on the floor rather than as a copy of the
                tile, and it slides between cells instead of jumping, so the eye
                can follow the one thing that is about to happen. A drop with
                nowhere to go is shown the same way, greyed out. */}
            {drag && !drag.onto ? (
              <span
                className={`drop-target${drag.fits ? '' : ' drop-target--refused'}`}
                style={boxToPx(field, drag.box)}
                aria-hidden="true"
              />
            ) : null}

            {/* A selection gets the same shadow, one per plate: the group lands
                together, so the whole group's landing is shown at once. It is
                drawn quieter than a single tile's, because it is a plan rather
                than a place. */}
            {batchShift
              ? batchShift.boxes.map((box) => {
                  const source = plates.find((plate) => plate.id === box.id)
                  if (!source) return null
                  return (
                    <span
                      key={`hint-${box.id}`}
                      className="drop-target drop-target--group"
                      style={boxToPx(field, { ...source, x: box.x, y: box.y })}
                      aria-hidden="true"
                    />
                  )
                })
              : null}

            {band ? (
              <span
                className="band"
                style={{
                  left: Math.min(band.from.x, band.to.x),
                  top: Math.min(band.from.y, band.to.y),
                  width: Math.abs(band.to.x - band.from.x),
                  height: Math.abs(band.to.y - band.from.y),
                }}
                aria-hidden="true"
              />
            ) : null}

            {plates.map((plate) => {
              const moving = drag?.id === plate.id
              // Carried is the whole selection, legal move or not: what is in
              // the hand follows the hand. Whether the place it is over can take
              // it is what the shadows underneath are for — a group that only
              // lifted once the move happened to fit was a group that sat still
              // while the hand went on without it.
              const carried = batch && batch.ids.includes(plate.id) ? batch : null
              const shift = carried ? carried.boxes.find((box) => box.id === plate.id) : null
              // A plate on the move is drawn where the pointer is, not on the
              // cell it would land in: it floats, and the grid it snaps to on
              // release is drawn underneath rather than pulling it around.
              //
              // What it floats *from* is where it is now, plus the whole carry —
              // not where it will land plus the carry. Adding the arm to the
              // landing spot counted the snapped part of the move twice, which
              // is what made a selection drift away from the hand.
              const own = boxToPx(field, plate)
              const rect =
                moving && drag
                  ? { ...own, left: drag.left, top: drag.top }
                  : carried
                    ? { ...own, left: own.left + carried.px, top: own.top + carried.py }
                    : boxToPx(field, shift ? { ...plate, x: shift.x, y: shift.y } : plate)
              return (
                <PlateView
                  key={plate.id}
                  plate={plate}
                  rect={rect}
                  settings={settings}
                  actions={actions}
                  keyLabel={keys.get(plate.id)}
                  revealed={revealed}
                  selected={selected.includes(plate.id)}
                  dragging={moving}
                  contents={contentsOf(plate)}
                  dropInto={drag?.onto === plate.id}
                />
              )
            })}

            {plates.length === 0 ? (
              <div className="empty">
                <span className="empty__title">{t('empty.title')}</span>
                <span className="empty__body">{t('empty.body')}</span>
                <button
                  type="button"
                  className="button button--primary empty__cta"
                  onClick={(event) => {
                    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
                    setAddAt({ x: rect.left, y: rect.bottom + 8 })
                  }}
                >
                  {t('empty.cta')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        )}

        <nav
          className="rail"
          data-orientation={settings.rail.orientation}
          data-edge={settings.rail.edge}
          data-align={settings.rail.align}
          aria-label={t('nav.bay')}
        >
          {bays.map((bay, index) => (
            <button
              type="button"
              key={bay.id}
              className={`rail__tag${bay.id === bayId ? ' rail__tag--current' : ''}${
                bay.view ? ' rail__tag--view' : ''
              }`}
              style={{ ['--tag-tint' as string]: TINT[bay.tint] }}
              onClick={() => goToBay(bay.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                setPageMenu({ id: bay.id, at: { x: event.clientX + 4, y: event.clientY - 8 } })
              }}
              aria-current={bay.id === bayId}
              title={t('page.menu')}
            >
              <span className="rail__chip" />
              {bay.view ? t(bay.view === 'bookmarks' ? 'nav.bookmarks' : 'nav.history') : bay.name?.trim() || t('page.name', { n: index + 1 })}
            </button>
          ))}
          <button type="button" className="rail__add" onClick={addBay} title={t('page.add')}>
            ＋
          </button>
          {bays.length > 1 ? (
            <button type="button" className="rail__add" onClick={() => removeBay(bayId)} title={t('page.remove')}>
              －
            </button>
          ) : null}

          <span className="rail__spacer" />
          <span className="rail__note">
            {selected.length > 0
              ? t('keys.multiActive', { n: selected.length })
              : `${t('keys.launch')} · ${t('keys.multi')} · ${t('keys.pages')} · ${t('keys.band')}`}
          </span>
        </nav>
      </div>

      {selected.length > 0 ? (
        <div className="marks">
          <span className="marks__count">{selected.length}</span>
          {t('keys.selection')}
          {selected.length > 1 ? <span className="marks__hint">{t('keys.release')}</span> : null}
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              for (const id of selected) activate(board.plates.find((candidate) => candidate.id === id))
              setSelected([])
            }}
          >
            {t('keys.launchAll')}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              // A folder holds what is not a folder. One folder inside another
              // is a place things go to be forgotten.
              const pickable = selected.filter(
                (id) => board.plates.find((plate) => plate.id === id)?.kind !== 'folder',
              )
              if (pickable.length === 0) return
              groupPlates(pickable)
              setSelected([])
            }}
          >
            {t('keys.group')}
          </button>
          <button type="button" className="button" onClick={() => setSelected([])}>
            {t('keys.clearSelection')}
          </button>
        </div>
      ) : null}

      <div className="chrome chrome--top">
        <button
          type="button"
          className="chip"
          ref={addButtonRef}
          onClick={() => {
            const rect = addButtonRef.current?.getBoundingClientRect()
            setAddAt(rect ? { x: rect.left, y: rect.bottom + 8 } : { x: 40, y: 56 })
          }}
        >
          ＋ {t('add.title')}
        </button>
        <button type="button" className={`chip${drawer ? ' chip--on' : ''}`} onClick={() => setDrawer((open) => !open)}>
          {t('nav.settings')}
        </button>
      </div>

      {revealed ? (
        <div className="chrome chrome--bottom">
          <span className="chip chip--accent">{t('keys.reveal')}</span>
        </div>
      ) : null}

      <SettingsDrawer open={drawer} onClose={() => setDrawer(false)} />
      {wallAt ? (
        <WallMenu
          anchor={wallAt}
          count={settings.wallpapers.length}
          onClose={() => setWallAt(null)}
          onNewTile={() => addBlankTile(wallAt.cell)}
          onRandomWallpaper={shuffleWallpaper}
          onRefresh={() => globalThis.location.reload()}
          onSettings={() => setDrawer(true)}
        />
      ) : null}
      {addAt ? (
        <AddPopover
          anchor={addAt}
          into={Boolean(addAt.into)}
          onClose={() => setAddAt(null)}
          onAdd={(draft) => {
            if (addAt.into) fill(addAt.into, draft)
            else place(draft)
          }}
        />
      ) : null}
      {menu ? (
        <PlateMenu
          plate={menu.plate}
          anchor={menu.at}
          field={field}
          // The set the press was made inside, worked out at the moment of the
          // press: a right click inside a pick configures the pick, and one under
          // Ctrl configures the pick it has just joined.
          targets={menu.targets.length > 1 ? menu.targets : undefined}
          onClose={() => setMenu(null)}
          onMove={(next) => {
            const spot = findOpening(
              board.plates.filter((candidate) => candidate.id !== next.id),
              bayId,
              { cols: settings.cols, rows: settings.rows },
              next.w,
              next.h,
              next.x,
              next.y,
              next.id,
            )
            if (spot) patchPlate(next.id, spot)
          }}
        />
      ) : null}
      {folder ? (
        <FolderPanel
          plate={folder}
          contents={contentsOf(folder) ?? []}
          onClose={() => setFolder(null)}
          onOpen={(item) => {
            if (item.url) {
              void surface.openUrl(item.url, true)
              return
            }
            // A widget in a folder is still a widget: it opens its own page.
            const view = item.kind === 'widget' ? widgetView(item.widget) : null
            if (view) void surface.openView(view)
          }}
          onOpenAll={() => {
            for (const item of contentsOf(folder) ?? []) {
              if (item.url) void surface.openUrl(item.url, true)
            }
            setFolder(null)
          }}
          onUnfile={(id) => patchPlate(id, { folderId: undefined })}
        />
      ) : null}
      {pageMenu ? (
        <PageMenu
          page={bays.find((candidate) => candidate.id === pageMenu.id)}
          anchor={pageMenu.at}
          onClose={() => setPageMenu(null)}
          onPatch={(patch) => {
            patchBay(pageMenu.id, patch)
            // Giving a page over to a view and staying where you are looks like
            // nothing happened. Going there shows what was just asked for. A
            // name or a tag changes something you can already see, so those
            // leave the page you are on alone.
            if ('view' in patch) goToBay(pageMenu.id)
          }}
          onRemove={() => removeBay(pageMenu.id)}
          canRemove={bays.length > 1}
        />
      ) : null}

      {surface.origin === 'mock' ? <span className="dev-badge">dev preview · mock data</span> : null}
    </div>
  )
}
