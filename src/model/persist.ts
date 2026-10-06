/**
 * The saved document, and how it is read back.
 *
 * Kept apart from the store so the standalone views can read the same record
 * without dragging the board's React state in behind them. The save format is
 * defined exactly once, here: a second definition elsewhere is the kind of
 * drift that shows up as a blank page after a rename.
 */

import { surface } from '../platform/browser'
import { defaultSettings, sampleBoard } from './defaults'
import { BOARD_VERSION, BAR_RADIUS_MAX, COMPONENT_BLUR_MAX, IMAGE_BLUR_MAX, ENGINE_MARK_MAX, ENGINE_MARK_MIN, ICON_SIZE_MAX, ICON_SIZE_MIN, MARK_OFFSET_MAX, MATERIAL_KINDS, MATERIAL_STRENGTH_MAX, MATERIAL_TRANSPARENCY_MAX, NAME_SIZE_MAX, NAME_SIZE_MIN, PERFORMANCE_LEVELS, RADIUS_MAX, RAIL_ALIGNS, RAIL_EDGES, ROTATION_EVERY_MAX, ROTATION_EVERY_MIN, MODIFIER_KEYS, ROTATION_MODES, ROTATION_OFF, TEXT_ALIGNS, TEXT_FONTS, TEXT_MAX_SIZE, TEXT_MIN_SIZE, TEXT_WEIGHTS, VARIANTS_MAX, WALL_BLUR_MAX, WALL_KINDS, WIDGET_STYLES, railEdgeFor, widgetView } from './types'
import type { ModifierKey, Rotation, RotationMode, RotationMoment, Wallpaper } from './types'
import { minutesAt } from './rotation'
import type { Board, MarkOffset, Material, MaterialKind, Performance, Plate, PlateMaterial, RailSpec, Settings, TextAlign, TextFontId, TextSpec, TileFill, Wall, WallKind, WidgetStyle } from './types'

/** Keeps a migrated number inside the range its setting is offered in. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * A mark's placement, as read back: two numbers in the window the sliders offer.
 * A record that names only one axis keeps the other at the middle, so a hand-made
 * save cannot take a mark off its tile.
 */
function repairOffset(raw: unknown): MarkOffset {
  const value = (raw ?? {}) as { x?: unknown; y?: unknown }
  return {
    x: Math.round(clamp(typeof value.x === 'number' ? value.x : 0, -MARK_OFFSET_MAX, MARK_OFFSET_MAX)),
    y: Math.round(clamp(typeof value.y === 'number' ? value.y : 0, -MARK_OFFSET_MAX, MARK_OFFSET_MAX)),
  }
}

export const STATE_KEY = 'state'

/**
 * Bumped whenever the saved shape changes. A save from a different schema is
 * discarded rather than migrated: this board has no users to migrate, and a
 * half-understood old save presents as a bug rather than as an upgrade.
 */
export const SCHEMA = 1

export interface SavedState {
  schema: number
  board: Board
  settings: Settings
}

export function readSaved(raw: unknown): SavedState | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Partial<SavedState>
  if (candidate.schema !== SCHEMA) return null
  return {
    schema: SCHEMA,
    board: mergeBoard(candidate.board),
    settings: mergeSettings(candidate.settings),
  }
}

function mergeBoard(raw: unknown): Board {
  const fresh = sampleBoard()
  if (!raw || typeof raw !== 'object') return fresh
  const candidate = raw as Partial<Board>
  const pages = Array.isArray(candidate.pages) && candidate.pages.length > 0 ? candidate.pages : fresh.pages
  const plates = Array.isArray(candidate.plates)
    ? candidate.plates.filter((plate): plate is Plate => Boolean(plate) && typeof plate === 'object').map(repairPlate)
    : []
  return { version: BOARD_VERSION, pages, plates }
}

/**
 * A saved plate with the board's abandoned idea taken back out of it.
 *
 * A search bar could once be folded down into its mark. It read badly — a bar
 * came back from it as a one-cell box with nowhere to type — so the offer is
 * gone. A bar saved folded has to come back as a bar, at the span it had before
 * it was folded, rather than as a mark that no longer opens. Nothing else is
 * rewritten: a plate is the user's, and this only drops what the board no
 * longer understands.
 */
function repairPlate(raw: Plate): Plate {
  const { form, foldSpan, material: wasMaterial, iconFollow, ...plate } = raw as Plate & {
    form?: string
    foldSpan?: { w: number; h: number }
    /** What a tile was made of, when tiles still had a material of their own. */
    material?: unknown
    /** How far a mark followed its tile, before that was a settled question. */
    iconFollow?: unknown
  }
  // The name a tile's ground went by before either of the others: kept out of the
  // rest spread so it cannot come back as a field nothing reads.
  const wasFill = (raw as { fill?: unknown }).fill
  if (plate.text) plate.text = repairText(plate.text)
  /*
   * A tile that holds several pictures, or several sets of words.
   *
   * Each entry is held to what the single answer has always been held to — a file
   * key or an address something can draw, a set of words that fits — because the
   * only difference between one and several is how many there are. An empty list is
   * no list: a shelf with nothing on it is the tile's single answer, and leaving the
   * empty array on the record would make the tile look like it was mid-edit.
   */
  plate.imageVariants = Array.isArray(plate.imageVariants)
    ? plate.imageVariants
        .filter((variant) => variant && typeof variant === 'object')
        .map((variant) => ({
          ...(typeof variant.key === 'string' ? { key: variant.key } : {}),
          ...(typeof variant.url === 'string' && /^(https?:|data:image\/|\/)/i.test(variant.url.trim())
            ? { url: variant.url.trim() }
            : {}),
          ...(typeof variant.name === 'string' && variant.name.trim() ? { name: variant.name.trim().slice(0, 80) } : {}),
        }))
        .filter((variant) => variant.key || variant.url)
        .slice(0, VARIANTS_MAX)
    : undefined
  if (!plate.imageVariants?.length) delete plate.imageVariants
  plate.textVariants = Array.isArray(plate.textVariants)
    ? plate.textVariants.filter((spec) => spec && typeof spec === 'object').map(repairText).slice(0, VARIANTS_MAX)
    : undefined
  if (!plate.textVariants?.length) delete plate.textVariants
  // And the rule that turns them over. Kept only where there is something to turn:
  // a rotation on a tile with one picture is a rule that can never be read.
  if (plate.rotation && (plate.imageVariants?.length || plate.textVariants?.length)) {
    plate.rotation = repairRotation(plate.rotation, ROTATION_OFF)
  } else {
    delete plate.rotation
  }
  // A tile that answers for its own mark is held to the same ranges the menu
  // offers, so a hand-edited record cannot leave a mark bigger than its tile.
  if (typeof plate.iconSize === 'number') plate.iconSize = clamp(plate.iconSize, ICON_SIZE_MIN, ICON_SIZE_MAX)
  // A name's own size and ink, held to what the slider and the picker offer.
  if (typeof plate.nameSize === 'number') plate.nameSize = Math.round(clamp(plate.nameSize, NAME_SIZE_MIN, NAME_SIZE_MAX))
  else delete plate.nameSize
  if (typeof plate.nameColour === 'string' && plate.nameColour.trim()) plate.nameColour = plate.nameColour.trim().slice(0, 40)
  else delete plate.nameColour
  if (typeof plate.iconStretchX === 'number') plate.iconStretchX = clamp(plate.iconStretchX, 0, 100)
  else delete plate.iconStretchX
  if (typeof plate.iconStretchY === 'number') plate.iconStretchY = clamp(plate.iconStretchY, 0, 100)
  else delete plate.iconStretchY
  delete (plate as Plate & { iconStretch?: unknown }).iconStretch
  // An icon the user picked or pasted has to be an address something can draw:
  // anything else is dropped rather than left on the record for the mark to
  // discover it cannot use.
  if (typeof plate.iconUrl === 'string' && /^(https?:|data:image\/|\/)/i.test(plate.iconUrl.trim())) {
    plate.iconUrl = plate.iconUrl.trim()
  } else {
    delete plate.iconUrl
  }
  if (typeof plate.radius === 'number') plate.radius = clamp(plate.radius, 0, 50)
  // A folder's cover is held to the same rule as a pasted icon, and for the same
  // reason: an address nothing can draw is dropped rather than kept on the record
  // for the folder to discover it cannot use.
  if (typeof plate.coverUrl === 'string' && /^(https?:|data:image\/|\/)/i.test(plate.coverUrl.trim())) {
    plate.coverUrl = plate.coverUrl.trim()
  } else {
    delete plate.coverUrl
  }
  if (typeof plate.coverKey !== 'string') delete plate.coverKey
  if (plate.markOffset) plate.markOffset = repairOffset(plate.markOffset)
  // What the tile stands on: the *background colour* of its background layer. It
  // has been called a fill and a material, and both are read into the three
  // answers that are left, because a colour is a colour whatever it was called
  // and a material with no colour of its own was the plain card.
  const fill = tileFillFrom(plate.fill) ?? tileFillFrom(wasFill) ?? tileFillFrom(wasMaterial)
  if (fill) plate.fill = fill
  else delete plate.fill
  // The two sheets, either of which a tile may answer for itself. The mark's
  // plate has been called `markMaterial` and is the icon layer now; the tile's
  // own sheet is the background layer, and it is held to the same ranges.
  const backgroundMaterial = repairPlateMaterial(plate.backgroundMaterial)
  if (backgroundMaterial) plate.backgroundMaterial = backgroundMaterial
  else delete plate.backgroundMaterial
  const iconMaterial = repairPlateMaterial(
    plate.iconMaterial ?? (plate as Plate & { markMaterial?: unknown }).markMaterial,
  )
  delete (plate as Plate & { markMaterial?: unknown }).markMaterial
  if (iconMaterial) plate.iconMaterial = iconMaterial
  else delete plate.iconMaterial
  // A folder's own surface, which is a question of its own rather than a second
  // half of the icon layer.
  const folderMaterial = repairPlateMaterial(plate.folderMaterial)
  if (folderMaterial) plate.folderMaterial = folderMaterial
  else delete plate.folderMaterial
  // A widget is either its list or one mark standing for it, and only a widget
  // with a page behind it has the choice at all. Anything else comes back as the
  // list, which is what a widget has always been.
  const drawn = plate.kind === 'widget' && widgetView(plate.widget) !== null
  plate.widgetStyle =
    drawn && WIDGET_STYLES.includes(plate.widgetStyle as WidgetStyle)
      ? (plate.widgetStyle as WidgetStyle)
      : undefined
  // The colour inside a bar is a search bar's own thing, and only a kind that is
  // actually offered is kept: a record edited by hand comes back as a plain
  // field rather than as a colour nobody can then change.
  plate.fieldFill =
    plate.kind === 'search' && plate.fieldFill && ['auto', 'none', 'custom'].includes(plate.fieldFill.kind)
      ? plate.fieldFill
      : undefined
  if (plate.kind !== 'search' || form !== 'icon') return plate
  const span = foldSpan ?? { w: 8, h: 1 }
  return { ...plate, w: span.w, h: span.h }
}

/**
 * A rule for taking turns, brought onto the three there are.
 *
 * A record from before a surface could take turns names neither, and the answer for
 * both halves is the one that changes nothing: the mode off, which shows the first
 * of whatever the set holds. The moments are kept in order and kept whole, because a
 * list of times that has lost one of its entries is a list that changes at the wrong
 * hour rather than a list that does not change.
 */
function repairRotation(raw: unknown, fallback: Rotation): Rotation {
  if (!raw || typeof raw !== 'object') return fallback
  const candidate = raw as Partial<Rotation>
  return {
    mode: ROTATION_MODES.includes(candidate.mode as RotationMode) ? (candidate.mode as RotationMode) : fallback.mode,
    every: Math.round(
      clamp(
        typeof candidate.every === 'number' ? candidate.every : fallback.every,
        ROTATION_EVERY_MIN,
        ROTATION_EVERY_MAX,
      ),
    ),
    at: Array.isArray(candidate.at)
      ? candidate.at
          .filter((moment): moment is RotationMoment => Boolean(moment) && typeof moment === 'object')
          .map((moment) => ({ time: String(moment.time ?? ''), index: Math.max(0, Math.round(Number(moment.index) || 0)) }))
          .filter((moment) => minutesAt(moment.time) !== null)
          .slice(0, VARIANTS_MAX)
      : fallback.at,
  }
}

/** Whether a record is a wallpaper the board can hang. */
function isWallpaper(raw: unknown): raw is Wallpaper {
  if (!raw || typeof raw !== 'object') return false
  const candidate = raw as Partial<Wallpaper> & { kind?: unknown }
  if (candidate.kind === 'flat') return typeof (candidate as { id?: unknown }).id === 'string'
  if (candidate.kind === 'url') return typeof (candidate as { url?: unknown }).url === 'string'
  if (candidate.kind === 'upload') return typeof (candidate as { key?: unknown }).key === 'string'
  return false
}

/**
 * A material, brought onto the ones the board actually offers.
 *
 * Neither sheet is asked for a colour any more. The background layer's colour is
 * the tile's background colour, and the icon layer's ground is the theme's own
 * card, so a record that carried a colour on either is read into the kind and the
 * two amounts that are left, and the colour is dropped rather than kept on the
 * record for a rule nothing reads. `custom` was a colour pretending to be a kind,
 * and is read as the solid plate it always was.
 */
function repairMaterial(raw: unknown, fallback: MaterialKind = 'solid'): Material {
  const candidate = (raw ?? {}) as { kind?: unknown; strength?: unknown; transparency?: unknown }
  const named = candidate.kind === 'custom' ? 'solid' : candidate.kind
  const kind = MATERIAL_KINDS.includes(named as MaterialKind) ? (named as MaterialKind) : fallback
  const strength = Math.round(
    clamp(typeof candidate.strength === 'number' ? candidate.strength : 66, 0, MATERIAL_STRENGTH_MAX),
  )
  const transparency = Math.round(
    clamp(typeof candidate.transparency === 'number' ? candidate.transparency : 0, 0, MATERIAL_TRANSPARENCY_MAX),
  )
  return { kind, strength, transparency }
}

/**
 * The same question asked on one tile, where either half may go unanswered.
 *
 * A tile's answer is a partial one on purpose: naming only a colour keeps the
 * tile on the board's material, and naming only a material keeps it on the
 * board's ground, so an answer that names neither is no answer at all and is
 * dropped — which is what leaves a tile following the board, and what a tile
 * comes back to when the menu hands both questions back.
 */
function repairPlateMaterial(raw: unknown): PlateMaterial | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const candidate = raw as { kind?: unknown; strength?: unknown; transparency?: unknown }
  const material: PlateMaterial = {}
  const named = candidate.kind === 'custom' ? 'solid' : candidate.kind
  if (MATERIAL_KINDS.includes(named as MaterialKind)) material.kind = named as MaterialKind
  if (typeof candidate.strength === 'number') material.strength = clamp(candidate.strength, 0, MATERIAL_STRENGTH_MAX)
  if (typeof candidate.transparency === 'number') {
    material.transparency = clamp(candidate.transparency, 0, MATERIAL_TRANSPARENCY_MAX)
  }
  return material.kind || material.strength !== undefined || material.transparency !== undefined ? material : undefined
}

/**
 * What a wallpaper is made of, and how far it is diffused.
 *
 * A record from before the wall had a material names neither, and the answer for
 * both is the one that draws the wallpaper as it arrived: no tint over it and no
 * blur. The blur is a slider's number, so a record carrying one from somewhere
 * else is brought back into range.
 */
function repairWall(raw: unknown): Wall {
  const candidate = (raw ?? {}) as Partial<Wall>
  const kind = WALL_KINDS.includes(candidate.kind as WallKind) ? (candidate.kind as WallKind) : 'clear'
  const blur = clamp(typeof candidate.blur === 'number' ? candidate.blur : 0, 0, WALL_BLUR_MAX)
  // A record from before the wall had an amount to give has the board's default
  // rather than nought: nought would be a wall that says `frosted` and shows a
  // sharp picture, which is the one reading nobody asked for.
  const strength = Math.round(
    clamp(
      typeof candidate.strength === 'number' ? candidate.strength : defaultSettings().wall.strength,
      0,
      MATERIAL_STRENGTH_MAX,
    ),
  )
  return kind === 'custom'
    ? {
        kind,
        colour: typeof candidate.colour === 'string' ? candidate.colour : undefined,
        blur: Math.round(blur),
        strength,
      }
    : { kind, blur: Math.round(blur), strength }
}

/**
 * The name the same question used to go by, on a record that still has it.
 *
 * A tile once stood on a *fill* — the theme's card, a colour, or nothing — and
 * then on a *material*, which asked what the plate was made of as well. The
 * material is gone again, so both are read into the three answers that are left.
 * A colour is kept whatever it was called; a material that was never about a
 * colour (`acrylic`, `frosted`) comes back as the plain card, because what a
 * tile is made of is the board's business again.
 */
function tileFillFrom(raw: unknown): TileFill | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const old = raw as { kind?: unknown; colour?: unknown }
  const colour = typeof old.colour === 'string' ? old.colour : undefined
  if (old.kind === 'none') return { kind: 'none' }
  if (colour) return { kind: 'custom', colour }
  if (old.kind === 'auto' || old.kind === 'solid' || old.kind === 'custom' || old.kind === 'acrylic' || old.kind === 'frosted') {
    return { kind: 'auto' }
  }
  return undefined
}

/**
 * A saved greeting, held inside the faces and the sizes the board can actually
 * set. A size is a number that reaches the layout as a font size, and a face is
 * a name the stylesheet has a rule for; a record carrying neither of those has
 * to come back as one it can draw rather than as a tile with no words in it.
 */
function repairText(raw: TextSpec): TextSpec {
  const font = TEXT_FONTS.includes(raw.font as TextFontId) ? (raw.font as TextFontId) : 'ui'
  const weight = TEXT_WEIGHTS.includes(raw.weight as number) ? (raw.weight as number) : 600
  const align = TEXT_ALIGNS.includes(raw.align as TextAlign) ? (raw.align as TextAlign) : 'left'
  const size = clamp(typeof raw.size === 'number' ? raw.size : 32, TEXT_MIN_SIZE, TEXT_MAX_SIZE)
  return {
    body: typeof raw.body === 'string' ? raw.body : '',
    font,
    size: Math.round(size),
    weight,
    align,
    tint: raw.tint ?? 'auto',
  }
}

/**
 * Where the page rail is hung, as read back.
 *
 * The orientation is the outer answer and the other two follow from it: a record
 * that names an edge its orientation cannot reach — a row of tags along the left
 * side — comes back on the edge its orientation does have rather than as a rail
 * drawn in a place the layout has no room for.
 */
function repairRail(raw: unknown): RailSpec {
  const base = defaultSettings().rail
  if (!raw || typeof raw !== 'object') return base
  const candidate = raw as Partial<RailSpec>
  const orientation: RailSpec['orientation'] = candidate.orientation === 'column' ? 'column' : 'row'
  const named = (RAIL_EDGES.row as ReadonlyArray<string>)
    .concat(RAIL_EDGES.column as ReadonlyArray<string>)
    .includes(candidate.edge as string)
    ? (candidate.edge as RailSpec['edge'])
    : base.edge
  return {
    orientation,
    edge: railEdgeFor(orientation, named),
    align: (RAIL_ALIGNS as ReadonlyArray<string>).includes(candidate.align as string)
      ? (candidate.align as RailSpec['align'])
      : base.align,
  }
}

function mergeSettings(raw: unknown): Settings {
  const base = defaultSettings()
  if (!raw || typeof raw !== 'object') return base
  const legacy = raw as Partial<Settings> & {
    iconScale?: unknown
    tileFill?: unknown
    iconFollow?: unknown
    componentBlur?: unknown
    material?: unknown
    /** The one amount every pane used to be asked for, and the one transparency. */
    materialStrength?: unknown
    materialTransparency?: unknown
    /** The icon layer's strength, when it was a bare number beside the mark's plate. */
    iconMaterialStrength?: unknown
    /** The mark's own plate, before the icon layer had a name. */
    markMaterial?: unknown
    /** The corner radius, before it was the tile's own. */
    radius?: unknown
    /** The one way engines used to be reached, before either was asked. */
    enginePlacement?: unknown
    barRadius?: unknown
    engineMenu?: unknown
    engineStrip?: unknown
    wallpapers?: unknown
    wallRotation?: unknown
    folderMaterial?: unknown
  }
  const candidate = { ...legacy }
  // Icon size used to be a multiplier over a fixed 54% of the tile, and a
  // multiplier means nothing now that the size is the fraction itself. An old
  // save's setting is carried over rather than dropped.
  const wasScaled = typeof legacy.iconScale === 'number' ? (legacy.iconScale as number) : null
  delete candidate.iconScale
  // A mark used to be able to stop following its tile. Nothing asks that any
  // more, and the answer is not carried over: a record holding one would keep a
  // mark small with no control left to say otherwise.
  delete candidate.iconFollow
  // And what every tile stands on used to be called its material — a fill before
  // that. The three answers are the same three, so an old record comes across.
  const wasFill = tileFillFrom(candidate.tileFill) ?? tileFillFrom(legacy.material)
  delete candidate.tileFill
  delete candidate.material
  // How much glass there is used to be a blur in pixels of its own, asked of every
  // pane at once, and then a single share for all of them. Both readings survive:
  // the pixels become the share they were standing in for, and the share becomes
  // the starting point for *both* layers, so a board arranged under the one number
  // does not move when it arrives at two.
  const wasBlur = typeof legacy.componentBlur === 'number' ? (legacy.componentBlur as number) : null
  delete candidate.componentBlur
  const wasStrength =
    typeof legacy.materialStrength === 'number'
      ? clamp(legacy.materialStrength as number, 0, MATERIAL_STRENGTH_MAX)
      : wasBlur === null
        ? base.backgroundMaterial.strength
        : clamp((wasBlur / COMPONENT_BLUR_MAX) * MATERIAL_STRENGTH_MAX, 0, MATERIAL_STRENGTH_MAX)
  const wasTransparency = Math.round(
    clamp(
      typeof legacy.materialTransparency === 'number' ? (legacy.materialTransparency as number) : 0,
      0,
      MATERIAL_TRANSPARENCY_MAX,
    ),
  )
  const wasIconStrength = Math.round(
    clamp(
      typeof legacy.iconMaterialStrength === 'number' ? (legacy.iconMaterialStrength as number) : wasStrength,
      0,
      MATERIAL_STRENGTH_MAX,
    ),
  )
  // The mark's plate keeps its kind and gains the two amounts; the background's
  // the same. A record that named neither layer answers with nothing, which is how
  // every tile and every mark was drawn before either existed.
  const iconSeed = repairMaterial(legacy.iconMaterial ?? legacy.markMaterial ?? base.iconMaterial, 'none')
  const namedIconAmount = typeof legacy.iconMaterial === 'object' || typeof legacy.markMaterial === 'object'
  delete candidate.markMaterial
  const backgroundSeed = legacy.backgroundMaterial
    ? repairMaterial(legacy.backgroundMaterial, 'none')
    : { ...base.backgroundMaterial, strength: Math.round(wasStrength), transparency: wasTransparency }
  // The icon service used to default to the one that answers with whatever
  // small file the site ships, which is what a board of soft marks was made of.
  // A record that still carries that default follows the new one; any other
  // choice was a choice, and is left alone because it is in the drawer.
  if (candidate.iconProvider === 'cccyun') delete candidate.iconProvider
  return {
    ...base,
    ...candidate,
    tileFill: wasFill ?? base.tileFill,
    backgroundMaterial: backgroundSeed,
    backgroundMaterialEnabled: candidate.backgroundMaterialEnabled !== false,
    // The icon layer's amount is the record's own when the record named a
    // material of its own, and otherwise the bare strength it used to be asked
    // for — which in turn falls back to the one number both layers shared.
    iconMaterial: namedIconAmount ? iconSeed : { ...iconSeed, strength: Math.round(wasIconStrength), transparency: wasTransparency },
    iconMaterialEnabled: candidate.iconMaterialEnabled !== false,
    // A folder's surface. A record from before folders had one answers `none`,
    // which is what a folder was drawn with until now.
    folderMaterial: legacy.folderMaterial ? repairMaterial(legacy.folderMaterial, 'none') : base.folderMaterial,
    // The two modifier keys, held to gather and to reveal. A record from before they
    // could be chosen answers with the pair the board has always used.
    pickModifier: MODIFIER_KEYS.includes(legacy.pickModifier as ModifierKey)
      ? (legacy.pickModifier as ModifierKey)
      : base.pickModifier,
    revealModifier: MODIFIER_KEYS.includes(legacy.revealModifier as ModifierKey)
      ? (legacy.revealModifier as ModifierKey)
      : base.revealModifier,
    /*
     * How round a bar is, in px, and the two ways its engines can be reached.
     *
     * A record from before the bar had a corner of its own carries the tile's
     * radius instead, which is what it was rounded by — read as a length, since a
     * share of a bar is exactly the ellipse this setting exists to replace. The two
     * engine answers come from the one placement they used to be, and from a record
     * that named neither.
     */
    barRadius: Math.round(
      clamp(
        typeof legacy.barRadius === 'number' ? legacy.barRadius : BAR_RADIUS_MAX * (base.tileRadius / RADIUS_MAX) * 2,
        0,
        BAR_RADIUS_MAX,
      ),
    ),
    engineMenu: legacy.engineMenu !== undefined ? legacy.engineMenu !== false : legacy.enginePlacement !== 'strip',
    engineStrip: legacy.engineStrip !== undefined ? legacy.engineStrip !== false : legacy.enginePlacement === 'strip',
    // The shelf of wallpapers the user added, and the rule its turns are taken by.
    // A record from before the shelf existed has one wallpaper hanging and nothing
    // to change it for, which is exactly an empty shelf.
    wallpapers: Array.isArray(legacy.wallpapers)
      ? legacy.wallpapers.filter(isWallpaper).slice(0, VARIANTS_MAX)
      : base.wallpapers,
    wallRotation: repairRotation(legacy.wallRotation, base.wallRotation),
    performance: PERFORMANCE_LEVELS.includes(candidate.performance as Performance)
      ? (candidate.performance as Performance)
      : base.performance,
    nameSize: Math.round(
      clamp(typeof candidate.nameSize === 'number' ? candidate.nameSize : base.nameSize, NAME_SIZE_MIN, NAME_SIZE_MAX),
    ),
    searchPlaceholder:
      typeof candidate.searchPlaceholder === 'string' && candidate.searchPlaceholder.trim()
        ? candidate.searchPlaceholder.slice(0, 80)
        : undefined,
    rail: repairRail(candidate.rail),
    imageBlur: Number.isFinite(candidate.imageBlur)
      ? clamp(candidate.imageBlur as number, 0, IMAGE_BLUR_MAX)
      : base.imageBlur,
    iconSize: clamp(
      // The size is the fraction of the tile itself, so a record that carries one
      // is read as it stands; only a record from before that was a multiplier over
      // the default is worked back into a fraction.
      typeof candidate.iconSize === 'number'
        ? candidate.iconSize
        : wasScaled === null
          ? base.iconSize
          : base.iconSize * wasScaled,
      ICON_SIZE_MIN,
      ICON_SIZE_MAX,
    ),
    // Both corner radii are percentages of the box they are on, so a record that
    // carries one from somewhere else is brought back into the range the slider
    // offers. The tile's has been called `radius` and is named for what it rounds.
    tileRadius: Math.round(
      clamp(
        typeof candidate.tileRadius === 'number'
          ? candidate.tileRadius
          : typeof legacy.radius === 'number'
            ? legacy.radius
            : base.tileRadius,
        0,
        RADIUS_MAX,
      ),
    ),
    imageRadius: Math.round(
      clamp(typeof candidate.imageRadius === 'number' ? candidate.imageRadius : base.imageRadius, 0, RADIUS_MAX),
    ),
    peek: candidate.peek !== false,
    markOffset: candidate.markOffset ? repairOffset(candidate.markOffset) : base.markOffset,
    engineMark: Math.round(
      clamp(typeof candidate.engineMark === 'number' ? candidate.engineMark : base.engineMark, ENGINE_MARK_MIN, ENGINE_MARK_MAX),
    ),
    // Arrays and the wallpaper object are taken whole when present, because a
    // partial merge of either produces a board that lies about its own state.
    searchEngines:
      Array.isArray(candidate.searchEngines) && candidate.searchEngines.length > 0
        ? candidate.searchEngines
        : base.searchEngines,
    wallpaper: candidate.wallpaper ?? base.wallpaper,
    wall: repairWall(candidate.wall ?? base.wall),
  }
}

/** Everything on disk, in the shape the board uses internally. */
export async function loadSaved(): Promise<SavedState> {
  const all = await surface.storage.get()
  const saved = readSaved(all[STATE_KEY])
  return saved ?? { schema: SCHEMA, board: sampleBoard(), settings: defaultSettings() }
}
