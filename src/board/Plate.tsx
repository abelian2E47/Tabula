/**
 * One thing on the canvas.
 *
 * Every kind shares the same body — a rounded surface with something on it and,
 * for the ones you look up by name, that name printed underneath. They differ
 * only in what that surface holds. A folder holds other plates, and is itself a
 * plate, so it is placed, sized and moved like everything else.
 *
 * The plate is a button when activating it means "open something", and a plain
 * box when it contains its own focusable control, which is the case for the
 * search plate.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useT } from '../i18n'
import { initialOf } from '../platform/favicon'
import { useImageSource, useMarkIcon, useMeasuredSize, useTurn } from '../lib/hooks'
import { materialVars } from '../model/material'
import type { Rect } from '../layout/grid'
import { modifierHeld, PHOTO_COVER_SHARE, widgetView, type FieldFill, type Material, type MaterialKind, type Plate, type SearchEngine, type Settings, type TileFill } from '../model/types'
import { EngineMark, brandOf } from './EngineMark'
import { WIDGET_LABELS, WidgetBody } from './Widgets'

export interface PlateActions {
  onPointerDown(event: ReactPointerEvent<HTMLElement>, plate: Plate): void
  /**
   * A press that means "open this", or — with the pick key held — "gather this".
   *
   * The modifier is handed over rather than read from the board, because it belongs
   * to the press that carried it: a click that landed while the key was down gathers
   * even if the key came up before the button did.
   */
  onActivate(plate: Plate, gathering: boolean): void
  /** Structural rather than a React event type, so any caller can hand over a
   *  position without a cast. */
  onContextMenu(
    event: {
      preventDefault(): void
      clientX: number
      clientY: number
      /** Whether the pick key was down when the button went down. */
      pickHeld?: boolean
      /** Whether it is still down now, which is a different question. */
      pickNow?: boolean
    },
    plate: Plate,
  ): void
  onSearch(plate: Plate, query: string): void
  /** The engine belongs to the bar, not to the application: two bars may sit
   *  side by side and search different places. */
  onPickEngine(plate: Plate, engineId: string): void
}

export interface PlateViewProps {
  plate: Plate
  rect: Rect
  settings: Settings
  actions: PlateActions
  /** The launch key this plate answers to, when it has one. */
  keyLabel?: string
  revealed?: boolean
  selected?: boolean
  dragging?: boolean
  /** A folder with a plate being dragged over it: the drop would file it here. */
  dropInto?: boolean
  /** What a folder holds, in the order it was put in. Only folders read this. */
  contents?: Plate[]
}

/** Below this the name is dropped and offered on hover instead. */
const NAME_MIN_WIDTH = 64

/** Held inside a range, for the two numbers the mark's own shape is worked out from. */
function clampNumber(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

export function engineOf(plate: Plate, settings: Settings): SearchEngine | undefined {
  const wanted = plate.engineId ?? settings.activeEngineId
  return settings.searchEngines.find((engine) => engine.id === wanted) ?? settings.searchEngines[0]
}

/**
 * Which way a ground the user picked leans, or nothing if it cannot be weighed.
 *
 * A colour from a picker is the one ground on the board the theme knows nothing
 * about — it may be nearly black in the light theme — so the words standing on
 * it cannot be read off the theme, only off the colour itself. This is WCAG's
 * relative luminance, cut at the middle: 0.179 is the luminance at which a white
 * and a black ground are equally far from a 4.5:1 contrast, so the side this
 * picks is the side whose ink can actually be read on the ground it was given.
 *
 * A value that is not a hex colour — a name, a colour an older record kept in
 * another notation — comes back as nothing rather than as a guess: the theme's
 * own ink is a better answer than the wrong one.
 */
function groundLeans(colour: string): 'light' | 'dark' | undefined {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim())
  if (!hex) return undefined
  const digits = hex[1].length === 3 ? hex[1].replace(/./g, (d) => d + d) : hex[1]
  const parts = [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16) / 255)
  const [r, g, b] = parts.map((n) => (n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? 'light' : 'dark'
}

export function PlateView({
  plate,
  rect,
  settings,
  actions,
  keyLabel,
  revealed = false,
  selected = false,
  dragging = false,
  dropInto = false,
  contents,
}: PlateViewProps) {
  const t = useT()
  const storedIcon = useImageSource(plate.iconKey)
  /*
   * Which picture this tile is showing.
   *
   * A picture tile may hold several, and which one is in front is worked out from
   * the clock — the same rule the wall and a stack of paragraphs take their turns
   * by, because it is the same question. A tile with one picture, which is most of
   * them, has no rule and no list, and the single answer it has always had is what
   * is drawn.
   */
  const stills = plate.kind === 'image' ? plate.imageVariants ?? [] : []
  const stillTurn = useTurn(plate.rotation, stills.length)
  const still = stills.length ? stills[stillTurn] : undefined
  const photo = useImageSource(still?.key ?? plate.imageKey, still?.url ?? plate.imageUrl)

  const title =
    plate.title?.trim() ||
    (plate.url ? plate.url : plate.kind === 'widget' ? t(WIDGET_LABEL[plate.widget ?? 'clock']) : '')
  // A tile can speak for itself about its name, because the reason to hide one
  // name is almost never a reason to hide all of them.
  const showName = plate.showName ?? settings.showNames
  // A widget that prints a list names itself inside it, so naming the tile as
  // well would say it twice. Drawn as a mark it has no list to name it, and the
  // name under the mark is what makes it read as one of the tiles. A blank tile is
  // not named at all: it has no name to print, and 「未命名」 under an empty tile is
  // a name for nothing being there.
  const selfNamed = (plate.kind !== 'widget' || plate.widgetStyle === 'icon') && plate.kind !== 'blank'
  // A name that has been made larger needs a wider tile before it fits, so the
  // threshold moves with the size rather than being one number for both: at the
  // board's own twelve points it is the sixty-four it always was.
  const named =
    showName &&
    selfNamed &&
    plate.kind !== 'search' &&
    rect.width >= NAME_MIN_WIDTH * Math.max(1, settings.nameSize / 12)
  // A tile can carry its own ground for the same reason: a colour behind one tile
  // is not a reason to repaint the whole board. This is the *background colour* of
  // the tile's background layer, which is a different question from what that layer
  // is made of — see the two materials below.
  const fill: TileFill = plate.fill ?? settings.tileFill
  const tileGround = fill.kind === 'custom' ? fill.colour : undefined
  /*
   * A tile is two layers, and each of them is made of something.
   *
   * The background is the sheet the tile itself is cut from. The icon is the mark
   * standing on that sheet and the pane the mark is given. They are asked apart
   * because they are different surfaces — one the size of the opening, one the size
   * of a chip, and the same amount of frost across the two is not the same amount
   * of frost — and because they are looked at for different things: a background
   * for its colour and its weight, a mark for its edge and its gloss.
   *
   * Each layer takes the tile's own answer when the tile named one and the board's
   * otherwise, and a layer whose switch is off is made of nothing rather than being
   * hidden: the record keeps the answer, so putting the switch back returns the
   * sheet the user had instead of a default.
   */
  const background: Material = {
    kind: settings.backgroundMaterialEnabled
      ? plate.backgroundMaterial?.kind ?? settings.backgroundMaterial.kind
      : 'none',
    strength: plate.backgroundMaterial?.strength ?? settings.backgroundMaterial.strength,
    transparency: plate.backgroundMaterial?.transparency ?? settings.backgroundMaterial.transparency,
  }
  const icon: Material = {
    kind: settings.iconMaterialEnabled ? plate.iconMaterial?.kind ?? settings.iconMaterial.kind : 'none',
    strength: plate.iconMaterial?.strength ?? settings.iconMaterial.strength,
    transparency: plate.iconMaterial?.transparency ?? settings.iconMaterial.transparency,
  }
  /*
   * A folder is not a mark, and it is not asked to be one.
   *
   * What a folder shows is its contents — up to four cells, a glyph, or a cover —
   * so the material that reaches those boxes is the folder's own, and the icon
   * layer is left to the marks that stand on ordinary tiles. One answer for both
   * meant a board of glass marks had glass folders as well, with nothing to say
   * otherwise.
   */
  const folder: Material = {
    kind: plate.folderMaterial?.kind ?? settings.folderMaterial.kind,
    strength: plate.folderMaterial?.strength ?? settings.folderMaterial.strength,
    transparency: plate.folderMaterial?.transparency ?? settings.folderMaterial.transparency,
  }
  /** The sheet this plate's second layer is made of: a folder's, or an icon's. */
  const sheet = plate.kind === 'folder' ? folder : icon
  // A ground out of a picker is the one ground the theme cannot vouch for, so it
  // is weighed and the ink follows it rather than the theme. A tile that is
  // nothing at all takes the wall's ink instead, which the stylesheet answers for.
  const leans = tileGround ? groundLeans(tileGround) : undefined
  // A tile may answer for its own mark — its size, its corners, the edge it is
  // given and the shadow it drops — because the tile that wants a bigger logo is
  // one tile, and a board-wide answer to that question would be the wrong answer
  // for the rest.
  const markSize = plate.iconSize ?? settings.iconSize
  const tileRadius = plate.radius ?? settings.tileRadius
  // The peek: the icon lifting off its background while a button is held, so that
  // both layers can be looked at one at a time. Kept as state rather than as a
  // class on the element because the release has to be heard wherever the pointer
  // has got to by then, and because the menu opens on that release.
  const [lift, setLift] = useState(false)
  const menuAt = useRef<{ clientX: number; clientY: number; pickHeld: boolean } | null>(null)
  const from = useRef<{ x: number; y: number; button: number } | null>(null)
  useEffect(() => {
    if (!lift) return
    // The button may be let go anywhere: over another tile, over the drawer, off
    // the window entirely. All three end the peel, and so does losing the window —
    // and each of them clears the anchor as well, so a press that was let go
    // somewhere else cannot leave the next menu waiting for a release that already
    // happened.
    const end = () => {
      menuAt.current = null
      from.current = null
      setLift(false)
    }
    /*
     * A press that starts to move is not a press any more.
     *
     * The left button both looks and carries: held still it peels the tile, and
     * moved it drags it — and the drag has a lift of its own, so the peel has to
     * give way rather than stack on top of it. Four pixels is the same slop the
     * board itself calls a drag, so the two agree about the moment the gesture
     * changed. The right button is left alone: a right click that wobbles is still
     * a right click, and a menu is owed at the end of it.
     */
    const drift = (move: PointerEvent) => {
      const start = from.current
      if (!start || start.button !== 0) return
      if (Math.hypot(move.clientX - start.x, move.clientY - start.y) > 4) end()
    }
    globalThis.addEventListener('pointermove', drift)
    globalThis.addEventListener('pointerup', end)
    globalThis.addEventListener('pointercancel', end)
    globalThis.addEventListener('blur', end)
    globalThis.addEventListener('contextmenu', end)
    return () => {
      globalThis.removeEventListener('pointermove', drift)
      globalThis.removeEventListener('pointerup', end)
      globalThis.removeEventListener('pointercancel', end)
      globalThis.removeEventListener('blur', end)
      globalThis.removeEventListener('contextmenu', end)
    }
  }, [lift])
  // Where the mark stands in the tile. A tile that was given its own place keeps
  // it; every other tile takes the board's, which is the middle unless moved.
  const markOffset = plate.markOffset ?? settings.markOffset
  const picture = plate.kind === 'link' || plate.kind === 'image'

  /*
   * The mark's size, measured rather than asked of the tile's narrow side.
   *
   * A mark is a share of the opening it stands in, and the opening it stands in
   * is the one the user just dragged: a tile grown from one square to two should
   * carry a bigger mark, and a mark measured off the *shorter* side does not grow
   * at all when the tile is stretched along its other axis, which is what the
   * `cqmin` in the stylesheet did. So the share is taken of the tile's area
   * instead — the geometric mean of its two sides, which moves when either does —
   * and held back from the tile's narrow side so that a tile stretched past about
   * four to one cannot push its mark out through its own edge.
   *
   * The tile is measured rather than read off the grid because the grid's cells
   * are not square: the same three-by-two opening is a different shape at every
   * window size. Until the first measurement arrives the stylesheet's own
   * `cqmin` answer stands, which is why nothing here has to be right on the very
   * first paint.
   */
  const [measureTile, tile] = useMeasuredSize<HTMLSpanElement>()
  const side = Math.min(tile.width, tile.height)
  const markPx =
    side > 0 ? Math.min(markSize * Math.sqrt(tile.width * tile.height), side * 0.94) : null

  /*
   * And how far the mark is allowed to come out to meet the tile.
   *
   * A mark drawn edge to edge had to be deformed to get there, and deforming it
   * costs the shape of the logo — a two-to-one tile used to stretch a round mark
   * into an oval, at a slider that said nothing about how much. The honest reading
   * of "fill it" is not one number but two: the mark grows to meet the tile along
   * whichever axis has room to give, and only as far as the user asked. At nought
   * it keeps its own shape at its own size and the tile's remaining room is the
   * mark's own colour, spread underneath it; at a hundred it reaches the edges.
   * Everything between is a mark that has been given some of its own width back,
   * which is what the control is for.
   *
   * Both factors are worked out from the tile's measured shape, so the axis the
   * room is on is the axis that moves — a tile stretched sideways deforms its
   * mark sideways and nowhere else.
   */
  const stretchX = 1 + clampNumber((plate.iconStretchX ?? 0) / 100, 0, 1)
  const stretchY = 1 + clampNumber((plate.iconStretchY ?? 0) / 100, 0, 1)

  /*
   * How far a picture is showing, which is the one thing its size can
   * honestly mean.
   *
   * A logo's size is the share of its tile it takes, and the tile's colour shows
   * around whatever the logo does not reach. A picture has no such colour: it is
   * the tile's whole surface, so its size is read as a zoom about the point where
   * it covers the tile — the size the board has always drawn a picture at. Below
   * that it fits inside the tile and the tile's own ground shows around it; above
   * it, it is magnified and the tile crops what overflows, which is how the
   * middle of a photograph is brought to the middle of a tile. A larger number is
   * a larger picture either way, whether or not the picture was asked to fill the
   * tile — the filled picture is the one that used to lose the control entirely.
   */
  const photoScale = plate.kind === 'image' ? clampNumber(markSize / PHOTO_COVER_SHARE, 0.1, 6) : 1
  // Whether a picture wears a sheet of glass. The two glasses are sheets and go
  // over the photograph, which is what they are for: frosted glass frosts the
  // picture and acrylic grades it. `solid` is not a sheet but a card, and a card
  // goes under the picture it carries, so it is not glazing; `none` leaves the
  // picture, and the tile's own ground, exactly as they were.
  const glazed = plate.kind === 'image' && (icon.kind === 'acrylic' || icon.kind === 'frosted')

  const style: CSSProperties = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    ['--stagger' as string]: keyLabel ? (keyLabel.charCodeAt(0) % 10) * 36 : 0,
    ['--icon-size' as string]: String(markSize),
    // The name's own size and ink, which a plate may answer for itself: a widget
    // that says what it holds wants a different line under it from a row of logos.
    ...(plate.nameSize !== undefined ? { ['--name-size' as string]: `${plate.nameSize}px` } : null),
    ...(plate.nameColour ? { ['--name-ink' as string]: plate.nameColour } : null),
    // The corner as a length, taken from the *narrow* side of the tile the plate
    // measured itself as: a share of the box would be a long shallow curve along
    // the top of a wide tile and a tight one down its side, which is a tile that
    // looks bent. The share goes with it, because a chip's own corner is a small
    // square box and a share of that is the shape at any size.
    ['--tile-radius-share' as string]: String(tileRadius),
    ...(side > 0 ? { ['--tile-radius' as string]: `${((tileRadius / 100) * side).toFixed(1)}px` } : null),
    ['--mark-x' as string]: String(markOffset.x),
    ['--mark-y' as string]: String(markOffset.y),
    ['--image-blur' as string]: `${settings.imageBlur}px`,
    ['--icon-stretch-x' as string]: String(stretchX),
    ['--icon-stretch-y' as string]: String(stretchY),
    ['--photo-scale' as string]: String(photoScale),
    ...(markPx ? { ['--mark' as string]: `${markPx.toFixed(1)}px` } : null),
    ...(tileGround ? { ['--tile-fill' as string]: tileGround } : null),
    // A plate that was given amounts of its own writes the material's whole set
    // over itself, one layer at a time. Nothing else has to know: every material
    // rule reads these names, so the sheets this plate draws are the ones it asked
    // for and the plates beside it are not touched.
    ...(plate.backgroundMaterial
      ? materialVars(background.strength, background.transparency, settings.performance, 'background')
      : null),
    ...(plate.iconMaterial
      ? materialVars(icon.strength, icon.transparency, settings.performance, 'mark')
      : null),
    ...(plate.kind === 'folder' && plate.folderMaterial
      ? materialVars(folder.strength, folder.transparency, settings.performance, 'mark')
      : null),
  }

  const className = [
    'plate',
    'plate--tile',
    plate.kind === 'image' ? 'plate--photo' : '',
    // A picture that is the tile, with no paper between the two.
    picture && plate.bleed ? 'plate--seamless' : '',
    plate.kind === 'folder' ? 'plate--folder' : '',
    plate.kind === 'widget' || plate.kind === 'search' ? 'plate--still' : '',
    plate.kind === 'search' ? 'plate--search' : '',
    plate.kind === 'blank' ? 'plate--blank' : '',
    named ? '' : 'plate--tight',
    // Numbered means "there is a key here". A clock or a search bar has none,
    // and saying otherwise would print a badge for a key that does not exist.
    revealed && keyLabel ? 'plate--numbered' : '',
    selected ? 'plate--selected' : '',
    dragging ? 'plate--dragging' : '',
    dropInto ? 'plate--drop-into' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const held = contents ?? []

  const body =
    plate.kind === 'blank' ? null : plate.kind === 'search' ? (
      <SearchBody
        engine={engineOf(plate, settings)}
        engines={settings.searchEngines}
        menu={settings.engineMenu}
        strip={settings.engineStrip}
        fieldFill={plate.fieldFill}
        placeholder={settings.searchPlaceholder}
        onSearch={(query) => actions.onSearch(plate, query)}
        onPickEngine={(engineId) => actions.onPickEngine(plate, engineId)}
      />
    ) : plate.kind === 'image' ? (
      photo ? (
        <>
          {plate.bleed ? <Bed src={photo} /> : null}
          {/* A picture wears its material the way a window wears its glass: the
              sheet is laid over the photograph, so frosted glass frosts the
              picture and acrylic grades it. Hung under the picture instead the
              sheet is a film the picture covers, and the picture is as clear as
              it was without one.
              `solid` is the one answer that is not a sheet — it is the card a
              photograph is laid on — so it stays behind, and the gauge of card it
              leaves showing around the picture is drawn by the stylesheet. */}
          <img className="plate__photo" src={photo} alt={title} draggable={false} />
          {glazed ? <span className="plate__pane" /> : null}
        </>
      ) : (
        <span className="plate__initial">{t('kind.image')}</span>
      )
    ) : plate.kind === 'widget' ? (
      <WidgetBody plate={plate} width={rect.width} height={rect.height} />
    ) : plate.kind === 'folder' ? (
      <FolderBody plate={plate} plates={held} settings={settings} />
    ) : (
      <LinkMark plate={plate} settings={settings} storedIcon={storedIcon} />
    )

  const inner = (
    <>
      {/* What the tile is made of is an attribute because one tile's answer and
          the board's answer are the same kind of thing: one set of rules reads
          it, and a material is the plate the mark is standing on. The mark's own
          pane is a second attribute of the same shape, and the ground the tile
          stands on a third — only when a colour was given, since absent the
          theme's own ink is already the answer. */}
      <span
        className="plate__tile"
        ref={measureTile}
        data-fill={fill.kind}
        data-background={background.kind}
        data-mark={sheet.kind}
        data-ground={leans}
      >
        {body}
      </span>
      {named ? <span className="plate__name">{title || t('common.untitled')}</span> : null}
      {keyLabel ? (
        <span className="plate__badge" aria-hidden="true">
          {keyLabel}
        </span>
      ) : null}
      {/* A picked plate says so three ways: the ring, the step back everything
          else takes, and this tick. The ring alone is easy to lose against a
          photograph, which is what it was read against. */}
      {selected ? (
        <span className="plate__picked" aria-hidden="true">
          <svg viewBox="0 0 14 14" fill="none">
            <path d="M3.2 7.4 5.9 10.1l4.9-6" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ) : null}
      {selected ? <span className="visually-hidden">{t('keys.selection')}</span> : null}
    </>
  )

  /*
   * The press that lifts the icon off its background, and the menu that follows it.
   *
   * Held down on a tile — with either button — the icon comes off its background so
   * that the two layers, the colour and the sheet the tile is cut from and then the
   * pane and the mark standing on it, can be read one at a time. It is the same
   * gesture for both buttons because it is the same question: a press on a tile is
   * a moment of looking at it before anything happens, and what happens afterwards
   * is what the button decides. Let go and the layers settle back; the left button
   * then opens what the tile holds, the right one opens the menu.
   *
   * The menu therefore waits for the release rather than arriving on the press,
   * which is the whole of the difference between the two readings of a right click.
   *
   * The anchor is kept in a ref rather than in state because the press and the
   * browser's own `contextmenu` can land in the same frame, before React has
   * rendered the lift: the menu must know that a press is *in flight*, and state
   * that has not been rendered yet cannot say so. The ref is also the test for
   * whether this context menu came from a held button at all — a menu asked for
   * from the keyboard, or by a script, has no press behind it and opens at once.
   *
   * The release itself is heard from the window as well as from the tile, because
   * the button may be let go with the pointer over the tile next door or over the
   * drawer, and a bare release outside is a look that was abandoned: no menu.
   */
  const onLiftDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!settings.peek || (event.button !== 0 && event.button !== 2)) return
    if (event.button === 2) {
      // The modifiers are taken at the press rather than at the release: Ctrl is
      // held *while* the button goes down, which is what the gesture means, and it
      // may well be let go before the button comes back up.
      menuAt.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        pickHeld: modifierHeld(settings.pickModifier, event),
      }
    }
    from.current = { x: event.clientX, y: event.clientY, button: event.button }
    setLift(true)
  }
  const onLiftUp = (event: ReactPointerEvent<HTMLElement>) => {
    const at = menuAt.current
    from.current = null
    setLift(false)
    if (event.button !== 2 || !at) return
    menuAt.current = null
    // Opened from here rather than from the stylesheet's own `contextmenu`, which
    // the browser raises while the button is still down. Both readings of Ctrl go
    // with it: what it was at the press, which decides whether this press gathered
    // instead of asking, and what it is now, which decides whether the asking has
    // already been let go.
    actions.onContextMenu(
      {
        preventDefault: () => undefined,
        clientX: at.clientX,
        clientY: at.clientY,
        pickHeld: at.pickHeld,
        pickNow: modifierHeld(settings.pickModifier, event),
      },
      plate,
    )
  }

  const shared = {
    className: `${className}${lift ? ' plate--separated' : ''}`,
    style,
    'data-plate': plate.id,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      onLiftDown(event)
      actions.onPointerDown(event, plate)
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => onLiftUp(event),
    onPointerLeave: () => {
      // A press taken off the tile is a gesture that has left, and neither button
      // means anything out there.
      menuAt.current = null
      from.current = null
      setLift(false)
    },
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      // The browser's own menu is never wanted, and neither is the board's own one
      // for empty openings: a press that landed on a tile is about the tile, and it
      // stops here rather than also being read as "add something here".
      event.preventDefault()
      event.stopPropagation()
      if (menuAt.current) return
      actions.onContextMenu(
        {
          preventDefault: () => undefined,
          clientX: event.clientX,
          clientY: event.clientY,
          pickHeld: modifierHeld(settings.pickModifier, event),
        },
        plate,
      )
    },
  }

  // The search plate holds an input, so it cannot be a button. A widget with a
  // view behind it and a folder are both things you press and say so; the clock
  // and the other still ones are only ever read off the board and stay boxes.
  const opens = plate.kind === 'widget' ? widgetView(plate.widget) !== null : false
  const pressable = plate.kind === 'folder' || opens

  if (plate.kind === 'search' || (plate.kind === 'widget' && !pressable)) {
    return (
      <div
        {...shared}
        role="group"
        aria-label={plate.kind === 'search' ? t('kind.search') : t(WIDGET_LABEL[plate.widget ?? 'clock'])}
      >
        {inner}
      </div>
    )
  }

  const label =
    plate.kind === 'widget'
      ? t(WIDGET_LABEL[plate.widget ?? 'clock'])
      : plate.kind === 'folder'
        ? `${title || t('folder.title')} · ${t('folder.count').replace('{n}', String(held.length))}`
        : keyLabel
          ? `${keyLabel}. ${title || t('common.untitled')}`
          : title || t('common.untitled')

  return (
    <button
      type="button"
      {...shared}
      aria-label={label}
      title={opens ? t('widget.expand') : undefined}
      onClick={(event) => actions.onActivate(plate, modifierHeld(settings.pickModifier, event))}
    >
      {inner}
    </button>
  )
}

const WIDGET_LABEL = WIDGET_LABELS

/**
 * The mark on a shortcut: the site's own icon when one is available, and a
 * letter when it is not. The letter is not an error state — it is what you get
 * with icon fetching switched off, which is a setting.
 *
 * Three answers are weighed in order, and the order is the user's: a file they
 * filed on this machine, an address they picked or pasted, and only then whatever
 * the board can fetch for itself. A plate with an answer of its own does not go
 * back to asking a service about it.
 */
function LinkMark({
  plate,
  settings,
  storedIcon,
}: {
  plate: Plate
  settings: Settings
  storedIcon: string | null
}) {
  const mark = useMarkIcon(plate.url, settings, storedIcon, plate.iconUrl)
  /*
   * A mark that has filled its tile is the tile: the icon *is* what is on the
   * board there, with the colour of its own edge carried out to the corners. So a
   * material asked of it is a sheet of that material laid over the icon — the
   * icon frosted, or graded, or bent at the rim by liquid glass — and not a plate
   * the icon stands on, which is what it is on a tile the icon only partly covers.
   * There is nothing left for a background to be: the icon covers it.
   *
   * The two card materials are the exception, for the same reason they are on a
   * picture: a card is not a sheet, it is the thing a thing is laid on, so it
   * stays behind the icon and shows through whatever the icon leaves open.
   */
  const material: MaterialKind = settings.iconMaterialEnabled
    ? plate.iconMaterial?.kind ?? settings.iconMaterial.kind
    : 'none'
  const glazing = plate.bleed && (material === 'acrylic' || material === 'frosted' || material === 'liquid')
  if (mark.src) {
    return (
      <>
        {plate.bleed ? <Bed src={mark.src} spread /> : null}
        <span className="plate__mark-pane" aria-hidden="true">
          <img className="plate__icon" src={mark.src} alt="" draggable={false} onError={mark.onError} />
        </span>
        {glazing ? <span className="plate__pane" aria-hidden="true" /> : null}
      </>
    )
  }
  return <span className="plate__initial">{initialOf(plate)}</span>
}

/**
 * What a filled tile wears under its own picture.
 *
 * A filled tile has no card: the picture is the tile, and a picture that does not
 * reach the tile's edges would leave the wallpaper showing through the difference
 * — a gap in the one state that cannot have one, because there is nothing left for
 * it to be a gap *in*.
 *
 * Two pictures answer that in two ways, and which way is right is decided by what
 * the picture is for. A photograph is a thing being looked at, so it is laid under
 * itself: the same file, magnified until its middle is the whole opening and out of
 * focus until it is a colour, which carries the photograph on around it without
 * pretending to be more of it. A mark is the tile's own colour, so it is *spread* —
 * the pixels at the mark's own edge carried outward to the tile's edge — and the
 * mark keeps the size it was given instead of being magnified to cover. A filled
 * tile with the GitHub mark in it goes black, because that is the colour the mark
 * ends in; magnifying it instead would have been a bigger logo, not a filled tile.
 *
 * Both are read from the file rather than out of it, because a mark usually arrives
 * from another origin: a canvas that has drawn one is tainted, so there is no
 * average to take, and the file's own pixels are the only honest answer.
 */
function Bed({ src, spread }: { src: string; spread?: boolean }) {
  return (
    <span
      className={spread ? 'plate__bed plate__bed--mark' : 'plate__bed'}
      style={{ backgroundImage: `url("${src}")` }}
      aria-hidden="true"
    />
  )
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

function SearchBody({
  engine,
  engines,
  menu,
  strip,
  fieldFill,
  placeholder,
  onSearch,
  onPickEngine,
}: {
  engine: SearchEngine | undefined
  engines: SearchEngine[]
  /** Whether the engine's own mark opens the panel of every engine. */
  menu: boolean
  /** Whether every engine is also laid along the top of the bar. */
  strip: boolean
  fieldFill: FieldFill | undefined
  /** What the field says it is for, when the user wrote their own. */
  placeholder?: string
  onSearch(query: string): void
  onPickEngine(engineId: string): void
}) {
  const t = useT()
  const [value, setValue] = useState('')
  const [picking, setPicking] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const settle = (engineId: string) => {
    onPickEngine(engineId)
    setPicking(false)
    inputRef.current?.focus()
  }

  /*
   * The two ways of changing engines, which are two answers rather than two
   * settings: the strip lays every engine along the top of the bar so that changing
   * one costs a single press, and the panel keeps them behind the mark so that a bar
   * with eight engines in it is still a bar. A board may want both — the strip for
   * the three engines used every day, the panel for the rest — so both are asked
   * separately and neither excludes the other. With neither, the bar simply keeps
   * the engine it was last given, which is what a board that has settled looks like.
   */
  const alongTheTop =
    strip && engines.length > 1 ? (
      <div className="strip" role="listbox" aria-label={t('search.engine')}>
        {engines.map((candidate) => {
          const on = candidate.id === engine?.id
          return (
            <button
              type="button"
              key={candidate.id}
              role="option"
              aria-selected={on}
              className={`strip__mark${on ? ' strip__mark--on' : ''}`}
              style={{ ['--engine-brand' as string]: brandOf(candidate) }}
              aria-label={candidate.name}
              title={candidate.name}
              onClick={() => settle(candidate.id)}
            >
              <EngineMark engine={candidate} className="search__mark" />
            </button>
          )
        })}
      </div>
    ) : null

  return (
    <form
      className={`search${alongTheTop ? ' search--strip' : ''}`}
      // The field's own ground, which is not the card the bar is drawn on. A
      // colour is only meaningful when one was chosen, so `auto` and `none` are
      // left to the stylesheet and the variable stays out of the way.
      data-field-fill={fieldFill?.kind ?? 'auto'}
      style={{
        ['--field-fill' as string]: fieldFill?.kind === 'custom' ? fieldFill.colour : undefined,
      }}
      onSubmit={(event) => {
        event.preventDefault()
        if (value.trim()) {
          onSearch(value.trim())
          setValue('')
        }
      }}
      onPointerDown={(event) => {
        // The field keeps its own pointer behaviour — a drag inside it selects
        // text, which is what a text field is for. Everything else on the bar
        // hands the press to the plate: a bar is mostly field, so its mark of an
        // engine is the handle it is moved by.
        if ((event.target as HTMLElement).closest('input')) event.stopPropagation()
      }}
    >
      {alongTheTop}

      {menu ? (
        <button
          type="button"
          className="search__medal search__medal--button"
          style={{ ['--engine-brand' as string]: engine ? brandOf(engine) : undefined }}
          onClick={() => setPicking((open) => !open)}
          aria-haspopup="listbox"
          aria-expanded={picking}
          title={t('search.switch')}
        >
          {engine ? <EngineMark engine={engine} className="search__mark" /> : null}
          <span className="visually-hidden">{engine?.name ?? t('search.engine')}</span>
        </button>
      ) : null}

      {picking ? (
        <div className="engines" role="listbox" aria-label={t('search.engine')}>
          {engines.map((candidate) => {
            const on = candidate.id === engine?.id
            return (
              <button
                type="button"
                key={candidate.id}
                role="option"
                aria-selected={on}
                className={`engines__row${on ? ' engines__row--on' : ''}`}
                style={{ ['--engine-brand' as string]: brandOf(candidate) }}
                onClick={() => settle(candidate.id)}
              >
                <span className="engines__medal">
                  <EngineMark engine={candidate} className="search__mark" />
                </span>
                <span className="engines__name">{candidate.name}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      <input
        ref={inputRef}
        className="search__input"
        name="q"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder?.trim() || t('search.placeholder')}
        aria-label={t('search.placeholder')}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />

      <button type="submit" className="search__go" aria-label={t('search.go')} title={t('search.go')}>
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* Folders                                                             */
/* ------------------------------------------------------------------ */

/**
 * What a folder shows on the board: the marks of what it holds, in the order it
 * was given them, which is how you recognise a folder from across the page.
 *
 * A folder's own size decides how many fit, so a folder grown to 3x3 shows more
 * of itself than one at 1x1 — and never more than it has, because a folder that
 * invents contents is worse than one that admits to few.
 */
function FolderBody({ plate, plates, settings }: { plate: Plate; plates: Plate[]; settings: Settings }) {
  const t = useT()
  const storedCover = useImageSource(plate.coverKey)
  const cover = storedCover ?? plate.coverUrl ?? null
  // The folder's own material, which is the board's unless the folder answered
  // for itself — and a sheet of glass is only drawn when the answer is one.
  const folderMaterial: MaterialKind = settings.iconMaterialEnabled
    ? plate.iconMaterial?.kind ?? settings.iconMaterial.kind
    : 'none'
  const glazed = folderMaterial === 'acrylic' || folderMaterial === 'frosted'
  const room = 4
  const shown = plates.slice(0, room)

  /*
   * A folder with a cover is drawn as its cover and says what it holds.
   *
   * The cover is what the folder is *called* — a picture of the thing the folder
   * is for — and the marks of what is inside are what a folder without one is
   * called. Showing both at once is showing neither: four wells over a book
   * jacket is a book jacket nobody can see. So the cover takes the folder's face
   * and the count takes the corner, which is exactly the trade a shelf makes.
   *
   * It wears the folder's material the way the folder's own cells do, and a
   * material that is a sheet goes *over* the cover: a cover under glass is the
   * cover, softened, rather than the cover replaced by a card. A card under it —
   * `solid` — is the folder's own plate, and it shows as the gauge the cover
   * leaves around itself.
   */
  if (cover) {
    return (
      <span className="folder folder--cover" data-count={Math.min(plates.length, room)}>
        <img className="folder__cover" src={cover} alt="" draggable={false} />
        {glazed ? <span className="plate__pane" /> : null}
        {plates.length > 0 ? (
          <span className="folder__count">{t('folder.count').replace('{n}', String(plates.length))}</span>
        ) : null}
      </span>
    )
  }

  return (
    <span className="folder" data-count={Math.min(plates.length, room)}>
      <span className="folder__grid">
        {shown.map((child) => (
          <span className="folder__cell" key={child.id}>
            <FolderMark plate={child} settings={settings} />
          </span>
        ))}
      </span>
      {plates.length > shown.length ? (
        <span className="folder__more" aria-hidden="true">
          {t('folder.count').replace('{n}', String(plates.length))}
        </span>
      ) : null}
    </span>
  )
}

/** A mark for something inside a folder: its icon, or a letter for its name. */
export function FolderMark({ plate, settings }: { plate: Plate; settings: Settings }) {
  const storedIcon = useImageSource(plate.iconKey)
  const mark = useMarkIcon(plate.kind === 'link' ? plate.url : undefined, settings, storedIcon, plate.iconUrl)
  if (mark.src) {
    return (
      <img className="folder__icon" src={mark.src} alt="" draggable={false} onError={mark.onError} />
    )
  }
  return <span className="folder__initial">{initialOf(plate)}</span>
}
