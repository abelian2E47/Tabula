/**
 * The board's data model.
 *
 * Placement is expressed in grid openings, never in pixels, so a board keeps
 * its shape across window sizes and screens. A plate occupies `w x h` openings
 * and sits at `x, y` counted from the top-left of the bay.
 */

export type Locale = 'zh' | 'en'

/**
 * Everything that can be placed on the board. `search` is a plate like any
 * other because it has to be movable; `image` shares the tile size set; and a
 * folder is a plate too, because a thing that holds things still has to be
 * placed, sized and named on the same grid as they are.
 */
/**
 * What a plate is.
 *
 * `blank` is an empty opening: a tile someone made before deciding what goes in it.
 * It holds nothing at all — no mark, no name, no words — and it is filled by
 * right-pressing it, which is where the add menu opens for it rather than for the
 * board. It is a kind rather than an absence because a tile is a place on the
 * board, and a place can meaningfully be reserved before it is furnished.
 */
export type PlateKind = 'link' | 'widget' | 'image' | 'search' | 'folder' | 'blank'

/** A rounded tile with its name under it, or a plain circle. */
export type PlateShape = 'tile'

export type WidgetType = 'clock' | 'bookmarks' | 'history' | 'text' | 'wallpaper'

/**
 * How a widget that has a page behind it is drawn on the board.
 *
 * A list is what such a widget is for: the marks and names of the things you
 * kept, read straight off the wall. A mark is what it becomes once you already
 * know what it opens — the same way a shortcut is drawn, so a board of them can
 * be taken in at a glance instead of read line by line. Absent means the list.
 */
export type WidgetStyle = 'list' | 'icon'

export const WIDGET_STYLES: readonly WidgetStyle[] = ['list', 'icon']

/**
 * The faces a text plate may be set in.
 *
 * Five rather than a font list, and all of them either bundled or already on the
 * machine: the point of a greeting is that it looks like you meant it, and a
 * choice that has to be downloaded before the words appear is not a choice
 * anyone makes twice. Each stack ends in a generic family, so a face missing on
 * one machine still gets its character from the next one in the line.
 */
export type TextFontId = 'ui' | 'serif' | 'kai' | 'round' | 'mono'

export const TEXT_FONTS: readonly TextFontId[] = ['ui', 'serif', 'kai', 'round', 'mono']

/** How a text plate lines its words up in its tile. */
export type TextAlign = 'left' | 'center' | 'right'

export const TEXT_ALIGNS: readonly TextAlign[] = ['left', 'center', 'right']

/** Weights offered for a text plate. Three that read differently at any size. */
export const TEXT_WEIGHTS: readonly number[] = [400, 600, 700]

/** The window a text plate's size may be chosen within, in px. */
export const TEXT_MIN_SIZE = 14
export const TEXT_MAX_SIZE = 160
export const TEXT_SIZE_STEP = 2

/** What a text plate says, and how it is set. */
export interface TextSpec {
  /** The words themselves. Line breaks are kept. */
  body: string
  font?: TextFontId
  /** Size in px. Shrunk to fit a tile too short to hold it, never grown. */
  size?: number
  weight?: number
  align?: TextAlign
  /** A colour token, or `auto` to follow the surface it is read against. */
  tint?: TintToken | 'auto'
}

export interface Plate {
  id: string
  /** Which bay this plate sits on. */
  pageId: string
  kind: PlateKind
  shape: PlateShape
  /** Span in openings. */
  w: number
  h: number
  x: number
  y: number
  /** Link plates: what it is and where it goes. */
  title?: string
  url?: string
  /** Widget plates. */
  widget?: WidgetType
  /**
   * Widget plates that have a page behind them: whether the tile shows that
   * page's contents or one mark standing for it. Absent means the list.
   */
  widgetStyle?: WidgetStyle
  /** Text widgets: what it says, and how it is set. */
  text?: TextSpec
  /** Image plates: an uploaded blob kept in local storage under this key. */
  imageKey?: string
  /** Image plates: or a remote address, when the user pasted one. */
  imageUrl?: string
  /**
   * Image plates: every picture this tile can show, when it was given more than
   * one. The first of them is what the tile shows while nothing is taking turns,
   * and `imageKey`/`imageUrl` are the single-picture answer a record from before
   * this existed still carries.
   */
  imageVariants?: ImageVariant[]
  /** Text widgets: every set of words this one can say, in the same way. */
  textVariants?: TextSpec[]
  /** How this tile's pictures or paragraphs take turns, if they do at all. */
  rotation?: Rotation
  /** Link plates: a locally stored icon overriding anything fetched. */
  iconKey?: string
  /** Image plates: draw it edge to edge instead of as a framed picture. */
  bleed?: boolean
  /**
   * A filled link tile: how far the mark is allowed to be *deformed* to close
   * the gap between its own shape and the opening it is standing in.
   *
   * Nought, the default, deforms nothing: the mark keeps the shape it arrived
   * with, is drawn as large as the opening allows, and the rest of the opening is
   * filled with the mark's own colour. One hundred stretches it all the way to
   * the opening's edges, which squares off a round logo. The two ends are the two
   * honest answers and everything between them is a share of the second.
   */
  /** Independent horizontal and vertical icon deformation, as percentages. */
  iconStretchX?: number
  iconStretchY?: number
  /**
   * Link plates: an icon the user picked out of the ones the board could reach,
   * or pasted as an address.
   *
   * Kept apart from `iconKey`, which is a file of the user's own on this machine,
   * because the two are different promises: one is here for good and the other is
   * a picture on somebody else's server. A plate that names this one draws it
   * before asking a service for anything, and both are set apart from the icons
   * the board would have fetched on its own.
   */
  iconUrl?: string
  /** Search plates: which engine this bar searches with. Absent means the
   *  board's current engine, so a second bar can be pointed somewhere else
   *  without disturbing the first. */
  engineId?: string
  /**
   * Folder plates: which folder holds this plate.
   *
   * A plate inside a folder is not on the grid — it is reached by opening the
   * folder — so its placement is kept only for the day it comes back out.
   */
  folderId?: string
  /**
   * Folder plates: the picture the folder wears as its cover, from a file of the
   * user's own, or from an address.
   *
   * The same pair an image plate carries, and for the same reason — one is here
   * for good and the other is a picture on somebody else's server — kept under
   * names of its own because a cover is not the tile's picture: it is what the
   * folder is called, and a folder that has one shows it instead of the marks of
   * what is inside.
   */
  coverKey?: string
  coverUrl?: string
  /**
   * This tile's own ground, overriding the board's. Absent follows the board, so
   * one tile can stand on a colour while its neighbours stay cards.
   *
   * The ground is the *background colour* of the tile's background layer, and it
   * is a colour rather than a material because the two are separate questions: a
   * tile is a card, a colour, or nothing at all underneath, and what that
   * background layer is made of is `backgroundMaterial`.
   */
  fill?: TileFill
  /**
   * This tile's own background layer, overriding the board default. One half of
   * the tile and one only: see `iconMaterial` for the other.
   */
  backgroundMaterial?: PlateMaterial
  /**
   * This tile's own icon layer: what the mark itself is made of, which is a
   * different question from what is behind it. Absent follows the board, and
   * either half may be named on its own.
   */
  iconMaterial?: PlateMaterial
  /**
   * A folder's own material, which is a question of its own rather than a second
   * half of the icon layer.
   *
   * What a folder *shows* is its contents — up to four cells, a glyph, or a cover
   * — so the material a folder wears is the material of the box those things are
   * drawn in, not of any one mark among them. A board can therefore have glass
   * marks on plain folders, or plain marks on a wall of glass folders, without
   * either answer moving the other. Absent follows the board.
   */
  folderMaterial?: PlateMaterial
  /**
   * The colour *inside* a search bar: the field's own ground, which is a
   * different thing from the plate the bar is made of. A bar can be a card on a
   * photograph with a clear field in it, or a clear bar with a filled field.
   */
  fieldFill?: FieldFill
  /** Whether this tile prints its name. Absent follows the board. */
  showName?: boolean
  /**
   * This tile's own name size, in px, and its own ink for that name.
   *
   * A name is part of the tile rather than part of the board: the row of logos under
   * a board wants one size and the label under a single clock wants another, and the
   * colour of that label is the tile's business in exactly the way the colour of its
   * words is. Absent follows the board.
   */
  nameSize?: number
  nameColour?: string
  /**
   * This tile's own mark size, as a fraction of the tile's shorter side. Absent
   * follows the board. Present so a mark can be set on the tile you are looking
   * at rather than on every tile at once — and so a selection of tiles can be
   * given one answer without touching the rest of the board.
   */
  iconSize?: number
  /**
   * This tile's own corner radius, as a percentage of its own box, 0 to 50.
   * Absent follows the board. It rounds the tile and nothing else: a picture
   * carried inside the tile has a radius of its own (`Settings.imageRadius`).
   */
  radius?: number
  /**
   * Where the mark stands inside its tile, as a percentage of the mark's own
   * size — so a mark made larger can be kept off the tile's edge, and a mark that
   * arrives with its own margin can be brought back to the middle. Absent follows
   * the board.
   */
  markOffset?: MarkOffset
  /**
   * Set when a plate is taken off the canvas without being deleted. A hidden
   * search bar keeps its place and its settings and can be shown again from the
   * search section of the settings, which is the only place that lists them.
   */
  hidden?: boolean
}

/** A bay is one page of the board. Three ship by default. */
export interface BoardPage {
  id: string
  /** Absent means "use the localised default name for this position". */
  name?: string
  /** The dot colour that tells this bay apart from its neighbours. */
  tint: TintToken
  /**
   * A page given over to one reading view. It carries no canvas at all: the
   * view fills it, already open, because a page that holds only a list has
   * nothing else to show and no reason to make you press something first.
   * Absent means an ordinary canvas.
   */
  view?: Exclude<ViewName, 'board'>
}

export type TintToken = 'slate' | 'blue' | 'green' | 'amber' | 'rose' | 'violet'

/*
 * ------------------------------------------------------------------ *
 * The two modifier keys                                               *
 * ------------------------------------------------------------------ *
 */

/**
 * A key held while something else is pressed, and the answer "no key at all".
 *
 * Two of the board's gestures are *held* rather than pressed: one gathers what is
 * pressed under it instead of opening it, and the other reveals the numbers and
 * launches straight away. Which key does each is the user's to say, because the
 * hand that reaches for Ctrl on one keyboard reaches for Command on another — and
 * because a board with a browser that keeps Ctrl for itself needs a way to give the
 * gesture to another key, or to give it up and do without.
 */
export type ModifierKey = 'ctrl' | 'alt' | 'shift' | 'meta' | 'none'

export const MODIFIER_KEYS: readonly ModifierKey[] = ['ctrl', 'alt', 'shift', 'meta', 'none']

/** Whether `modifier` is held for this event. */
export function modifierHeld(
  modifier: ModifierKey,
  event: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean },
): boolean {
  switch (modifier) {
    case 'ctrl':
      return Boolean(event.ctrlKey)
    case 'alt':
      return Boolean(event.altKey)
    case 'shift':
      return Boolean(event.shiftKey)
    case 'meta':
      return Boolean(event.metaKey)
    default:
      return false
  }
}

/** The `KeyboardEvent.key` a modifier reports itself by, for key-up handling. */
export function modifierKeysOf(modifier: ModifierKey): string[] {
  switch (modifier) {
    case 'ctrl':
      return ['Control']
    case 'alt':
      return ['Alt']
    case 'shift':
      return ['Shift']
    case 'meta':
      return ['Meta']
    default:
      return []
  }
}

export interface SearchEngine {
  id: string
  name: string
  /** `%s` is replaced with the encoded query. */
  urlTemplate: string
  /**
   * Which bundled mark stands for this engine. Optional because a save written
   * before the marks existed names its engines without one; the reader falls
   * back to the id, then to the generic mark.
   */
  icon?: string
}

/**
 * What a tile is made of.
 *
 * A tile is a plate hung on the user's own wall, and a plate can be a card, a
 * sheet of clear acrylic or a pane of ground glass. The last two let the wall
 * keep showing through, which is the whole reason to ask for them: `acrylic`
 * keeps it sharp and rich, `frosted` dissolves it into light. They are
 * materials rather than opacities, so each carries its own edge, its own way of
 * sitting on the wall, and its own ink — a frosted pane answers for what is
 * written on it in a way a clear one cannot.
 *
 * `none` is not a material: it is the absence of one, the tile taken away and
 * the mark left standing on the wallpaper.
 *
 * `liquid` is the glass that behaves like a liquid: a thicker lens than acrylic
 * with a light moving across it, a bright catch along the edge it is lit from,
 * and the wall bent a little where it meets that edge. It is the one material
 * here that asks the machine for a second filter pass, so the performance stop
 * decides whether it gets one — with the refraction off it is still liquid glass,
 * read from its sheen and its edge alone.
 */
export type MaterialKind = 'solid' | 'acrylic' | 'frosted' | 'liquid' | 'none'

export const MATERIAL_KINDS: readonly MaterialKind[] = ['solid', 'acrylic', 'frosted', 'liquid', 'none']

/**
 * The four kinds a *background* layer is offered, which is every kind but none.
 *
 * A background layer's colour and its material are two questions, and only one of
 * them owns "nothing": the colour's `none` is the transparent tile, and a material's
 * `none` read as a second way of saying the same thing — two answers to "let the
 * wallpaper through" standing in two rows, which is a choice offered twice rather
 * than a choice offered twice over. So the material row asks what the layer is made
 * of, and the answer is one of the four; whether the layer has a material at all is
 * the switch above the row.
 *
 * `none` stays in the type because a record may still say it — it is what this layer
 * answered before the row was narrowed, and what a board that has never been asked
 * answers — and a record is not read through the drawer's list.
 */
export const BACKGROUND_MATERIAL_KINDS: readonly MaterialKind[] = ['solid', 'acrylic', 'frosted', 'liquid']

/**
 * A material, and the ground under it.
 *
 * The two are asked apart because they answer different questions — what the
 * plate is made of, and what is behind it — and a board wants to answer them
 * apart: a coloured tile that is still a sheet of acrylic, or ground glass with
 * something warm under it. A colour on its own is not a material, it is a solid
 * plate in a colour of the user's choosing, which is all the kind that used to
 * be called `custom` ever meant; a record that still says `custom` is read as
 * this.
 */
export interface Material {
  kind: MaterialKind
  /**
   * How much of the material there is, 0 to 100.
   *
   * A material is a shape and an amount, and the amount is the half a person
   * reaches for: the same sheet of ground glass can be a hint of haze or a wall
   * of milk. Each of the board's two materials carries its own, because they are
   * two sheets on two layers and one number asked of both is how a tile ends up
   * with a thick background and a thin mark at the same time.
   */
  strength: number
  /**
   * How far the sheet can be seen through, 0 to 100, where 100 leaves nothing of
   * its own ground in it at all.
   *
   * Asked apart from the strength because the two are different wishes: ground
   * glass can be thick and still let the wall through, and a thin sheet can be
   * nearly opaque. It is a multiplier on the opacity the strength asks for, so
   * nought is exactly the sheet the board has always drawn, and what it leaves at
   * a hundred is the material's own shape — the sheen, the cut edge, the
   * diffusion.
   */
  transparency: number
}

/**
 * What one tile says about its own ground.
 *
 * Both halves are optional, and absent means the board's answer rather than no
 * answer. The two questions are separable all the way down, so a tile that only
 * wanted a colour of its own has not thereby stopped being made of whatever the
 * rest of the board is made of — and one that only wanted to be glass still
 * stands on the board's colour. Naming neither leaves the tile following the
 * board entirely, which is what an untouched tile does.
 */
/**
 * What one tile says about its own two sheets.
 *
 * Every half is optional, and absent means the board's answer rather than no
 * answer. The two questions are separable all the way down, so a tile that only
 * wanted a thicker sheet of its own has not thereby stopped following the board
 * for the icon standing on it — and one that only wanted its mark cast differently
 * still stands on the board's background. Naming nothing leaves the tile following
 * the board entirely, which is what an untouched tile does.
 *
 * Neither sheet is asked for a colour here. The background layer's colour is the
 * tile's background colour (`Plate.fill`), which is a different question from what
 * the layer is made of, and the icon layer's ground is the theme's own card: a
 * second colour control per layer only ever meant the same colour asked twice, in
 * two places, with two answers.
 */
export interface PlateMaterial {
  kind?: MaterialKind
  /**
   * How much of the material there is on *this* plate, 0 to 100.
   *
   * A board has one answer for how thick its glass is, because a board is looked
   * at as a whole — but one icon over a busy part of a photograph can want a
   * thinner sheet than the one beside it, and the only person who knows which is
   * the person looking at it. Absent means the board's own strength, which is what
   * every plate that was never asked says.
   */
  strength?: number
  /** How far this plate's sheet can be seen through. Absent follows the board. */
  transparency?: number
}


/**
 * How much of its tile a mark may take, as a fraction of the tile's shorter
 * side. Above 1 the mark outgrows the tile and is cropped by it, which is a look
 * worth being able to ask for: a logo taken to the edge of its opening reads as
 * the opening rather than as something stuck on it. The mark is not capped by
 * the size of the file it came from either, or the top of this range would be a
 * number the board quietly ignores for every small icon on the web.
 */
export const ICON_SIZE_MIN = 0.2
export const ICON_SIZE_MAX = 2

/**
 * The icon size at which a picture covers its tile exactly.
 *
 * A logo's size is how much of the tile it takes, and at the default it takes a
 * little over half. A picture's size cannot read the same way, because a picture
 * is not something standing on a tile: it is the tile's whole surface, and a
 * photograph shrunk to half a card is not a size anyone asked for. So the slider
 * is read as a zoom about the point where the picture covers the tile, which is
 * the default size — the control is a crop, and a board that never touched it
 * draws its photographs exactly as it always did.
 */
export const PHOTO_COVER_SHARE = 0.54

/**
 * What fills a search field. This is the ground *inside* the bar and not the
 * plate the bar is made of: a bar is a field with a mark in it, and the field
 * can be a well cut into the plate, nothing at all, or a colour of its own.
 */
export interface FieldFill {
  kind: 'auto' | 'none' | 'custom'
  /** Only read when the kind is `custom`. Any CSS colour. */
  colour?: string
}

/**
 * What a tile stands on: the theme's card, a colour of the user's, or nothing at
 * all — the tile taken away and the mark left on the wallpaper.
 *
 * Two answers rather than three: "what colour is it" and "what is it made of"
 * were the same question asked of a plate, and the second one only ever had
 * three ways of saying "let the wallpaper through". A mark's material is the one
 * that stayed (see `Settings.markMaterial`), because a logo is a different kind
 * of thing from the tile it stands on.
 */
export interface TileFill {
  kind: 'auto' | 'none' | 'custom'
  /** Only read when the kind is `custom`. Any CSS colour. */
  colour?: string
}

/** Where the search plate offers the engines it can search with. */
export type EnginePlacement = 'menu' | 'strip'

/**
 * The window a search bar may be sized within. A bar narrower than this cannot
 * show a mark, a query and a way to submit it; a bar taller than this stops
 * being a bar.
 *
 * The height is in rows and does not have to be whole. A square opening is the
 * unit the board is laid out on, but a bar is a field with a mark in it, not a
 * square, and one row is a good deal taller than the line of text inside it:
 * a bar that can only be one row or two has no answer for "a row and a half",
 * which is the size most bars actually want.
 */
export const SEARCH_MIN_W = 3
export const SEARCH_MIN_H = 0.6
export const SEARCH_MAX_H = 3
/** Fine enough to land on any height between two rows, coarse enough to use. */
export const SEARCH_H_STEP = 0.05

/**
 * The widths a search bar is offered. A bar is a wide, short thing, so these are
 * not the tile spans: a plate holds a mark, while a bar holds a field, and one
 * cell of either is the same size on the grid. Widths stay whole because a bar's
 * left and right edges are where it meets whatever is beside it.
 */
export const SEARCH_WIDTHS: readonly number[] = [3, 4, 6, 8, 12]

/** The window the engine marks above a bar may be sized within, in px. */
export const ENGINE_MARK_MIN = 20
export const ENGINE_MARK_MAX = 46

/**
 * Where a mark stands inside its tile, in per cent of the mark's own size, on
 * each axis. Nought is the middle. The window stops short of a mark that has left
 * its tile: a mark is *placed* on a tile, not thrown off it.
 */
export interface MarkOffset {
  x: number
  y: number
}
export const MARK_OFFSET_MAX = 60
export const MARK_OFFSET_STEP = 5

/**
 * What is behind everything. `none` is the default: a blank surface in the
 * theme's own colour, with no image and no texture.
 */
export type Wallpaper =
  | { kind: 'none' }
  | { kind: 'flat'; id: string }
  | { kind: 'url'; url: string }
  | { kind: 'upload'; key: string; name: string }

/**
 * One picture a tile can show, out of several.
 *
 * A file the user filed on this machine, or an address they pasted — the same two
 * answers a single picture tile has always had, in a list rather than on their own.
 * The name is the file's own, kept so that a shelf of them can be read.
 */
export interface ImageVariant {
  /** A blob kept in local storage, for a picture the user filed here. */
  key?: string
  /** Or a remote address, for one they pasted. */
  url?: string
  /** What the file was called, for a list that has to name it. */
  name?: string
}

/** How many wallpapers, pictures or paragraphs one shelf may hold. */
export const VARIANTS_MAX = 24

/**
 * What the wallpaper is made of, which is the same question a tile answers with
 * a `Material` — asked of the biggest surface on the board.
 *
 * The wallpaper is the one thing nothing stands in front of: it is what the
 * glass is made of rather than a pane over something else. So its vocabulary is
 * the four that make sense for a whole wall rather than the four a tile has.
 * `clear` is the picture as it arrived; `acrylic` is the same picture seen
 * through a sheet of it — richer, a little darker, still sharp; `frosted` is the
 * picture seen through ground glass, which is the strongest of the four and
 * lightens everything behind it; `custom` is a colour of the user's own laid
 * over the top.
 *
 * `blur` is kept apart from the kind rather than folded into it, because it is
 * the one part of this a user reaches for on its own: a wallpaper softened by a
 * few pixels is a background a board of cards can be read on, and that has
 * nothing to do with whether the picture is also tinted. It is the one number
 * here, and the one that belongs to the user rather than to the material: the
 * kind says what the wall is made of, and this says how far off its focus is.
 */
export type WallKind = 'clear' | 'acrylic' | 'frosted' | 'liquid' | 'custom'

export const WALL_KINDS: readonly WallKind[] = ['clear', 'acrylic', 'frosted', 'liquid', 'custom']

export interface Wall {
  kind: WallKind
  /** Only read when the kind is `custom`. Any CSS colour. */
  colour?: string
  /** How far the wallpaper is diffused, in px. */
  blur: number
  /**
   * How much of the material there is, 0 to 100.
   *
   * A material is a shape and an amount, and the amount is the half a person
   * actually reaches for: the same sheet of ground glass can be a hint of haze or
   * a wall of milk, and which of the two is wanted depends on the picture under
   * it. Nought leaves the wallpaper as it arrived whatever the kind says, so this
   * is also the way back to a plain wall without giving the material up.
   */
  strength: number
}

/** The most a wallpaper may be diffused, in px. Past this it is no longer a picture. */
export const WALL_BLUR_MAX = 40
/** The strongest blur applied to translucent component surfaces. */
export const COMPONENT_BLUR_MAX = 32
/*
 * ------------------------------------------------------------------ *
 * Taking turns                                                       *
 * ------------------------------------------------------------------ *
 */

/**
 * A set of things that can take turns: how they do it, and when.
 *
 * Three of the board's surfaces hold more than one of something — the wall holds
 * a shelf of wallpapers, a picture tile holds a set of photographs, a greeting
 * holds a set of paragraphs — and in all three cases the question after "which
 * ones" is "in what order, and when does it change". That question is one question,
 * so it is one type, asked in three places.
 *
 * `interval` counts from midnight rather than from whenever the board was opened:
 * a board that changes every thirty minutes should show the same wallpaper at
 * 09:00 on two different days, and a sequence that started when the tab did would
 * drift by however long the tab was closed.
 *
 * `clock` names the moment each one starts, so a morning picture and an evening one
 * are two answers rather than a sequence with a gap in it. The moment in force is
 * the last one that has already passed, and before the first one of the day the
 * last one of the night is still in force — which is what makes a set of moments
 * cover the whole day rather than leaving the small hours undefined.
 */
export type RotationMode = 'off' | 'interval' | 'clock'

export const ROTATION_MODES: readonly RotationMode[] = ['off', 'interval', 'clock']

/** Shortest and longest interval between two changes, in minutes. */
export const ROTATION_EVERY_MIN = 5
export const ROTATION_EVERY_MAX = 1440

/** One moment of the day and which of the set it starts. `time` is `HH:MM`. */
export interface RotationMoment {
  time: string
  index: number
}

export interface Rotation {
  mode: RotationMode
  /** Minutes between changes. Read when the mode is `interval`. */
  every: number
  /** The moments of the day that name one of the set. Read when `clock`. */
  at: RotationMoment[]
}

/**
 * The rule a surface that has never taken turns answers with: the first of whatever
 * the set holds, and nothing to wait for.
 */
export const ROTATION_OFF: Rotation = { mode: 'off', every: 60, at: [] }
/** How much of a material there can be, as a share. */
export const MATERIAL_STRENGTH_MAX = 100
/** How far a material may be seen through, as a share: 100 is a clear sheet. */
export const MATERIAL_TRANSPARENCY_MAX = 100
/** The strongest diffusion a material wears at full strength, in px. */
export const MATERIAL_BLUR_MAX = 26
/** The strongest blur applied to image plate content. */
export const IMAGE_BLUR_MAX = 24

/** The window a plate's name may be printed at, in px. */
export const NAME_SIZE_MIN = 9
export const NAME_SIZE_MAX = 22

/**
 * How far a corner may be rounded, in per cent of the box it is on.
 *
 * Fifty and no further, because fifty *is* the shape: at fifty per cent of the
 * shorter side every corner has met the one beside it, so a square tile is a
 * circle and a wide one is an ellipse, and a slider past that would be a slider
 * that had already finished. Both radii stop here for the same reason, and both
 * are read as a share rather than in pixels so that a tile keeps its shape when
 * it is resized and a picture keeps its corners when it is zoomed.
 */
export const RADIUS_MAX = 50

/**
 * How far a search bar's own corner may come in, in px.
 *
 * The length of half a two-row bar, which is the point at which a bar with square
 * corners at the ends has become a pill and there is nothing left to round. A bar is
 * a length rather than a share of itself because a share of a bar thirty times wider
 * than it is tall is an ellipse, not a rectangle with round corners.
 */
export const BAR_RADIUS_MAX = 36

/**
 * The colours a tile's background is offered as, before the picker.
 *
 * A short list rather than a full palette: these are the grounds a mark reads
 * on — a paper card and its shadowed counterpart, the two cool neutrals that let
 * a board of logos sit together, and four hues far enough apart to tell one from
 * another at the size of a tile. The picker beside them is for the colour that
 * is not here, and `none` is for no colour at all, which is the wallpaper.
 */
export const TILE_COLOURS: readonly string[] = [
  '#ffffff',
  '#f2f0ec',
  '#e4e7ec',
  '#cfd6e0',
  '#2a2f37',
  '#111418',
  '#3b82f6',
  '#22a06b',
  '#d98a1f',
  '#e5484d',
  '#8b5cf6',
]

/*
 * How hard the board is allowed to work for looks.
 *
 * Three stops rather than a number, because the two things being traded against
 * each other are not measurable on a slider: one is how much glass a machine can
 * afford to diffuse, and the other is how much movement a person wants to watch.
 * The answer is a posture, not a figure.
 */
export type Performance = 'low' | 'medium' | 'high'

export const PERFORMANCE_LEVELS: readonly Performance[] = ['low', 'medium', 'high']

/**
 * What each stop is worth.
 *
 * `motion` multiplies every duration and delay on the board, so a low stop is a
 * board that still moves and moves quickly. `fx` multiplies how much material
 * there is — its diffusion and its ground — and it is the one that costs frames:
 * a `backdrop-filter` is a full-surface blur behind an element, and a board of
 * them is the only expensive thing this page does.
 */
export const PERFORMANCE: Record<Performance, { motion: number; fx: number }> = {
  low: { motion: 0.4, fx: 0.34 },
  medium: { motion: 1, fx: 0.72 },
  high: { motion: 1.25, fx: 1 },
}

/**
 * Where the page rail is hung, and which way it runs.
 *
 * A row of tags goes above or below the field; a column goes beside it. The third
 * answer is where it sits along that edge, and it is only ever read on the axis
 * the orientation runs on — a row is left, centre or right, a column is top,
 * centre or bottom — which is why one name covers both.
 */
export interface RailSpec {
  orientation: 'row' | 'column'
  edge: 'top' | 'bottom' | 'left' | 'right'
  align: 'start' | 'center' | 'end'
}

export const RAIL_EDGES: Record<RailSpec['orientation'], ReadonlyArray<RailSpec['edge']>> = {
  row: ['bottom', 'top'],
  column: ['left', 'right'],
}

export const RAIL_ORIENTATIONS: readonly RailSpec['orientation'][] = ['row', 'column']

/** Where the rail sits along its own axis: a row left to right, a column top to bottom. */
export const RAIL_ALIGNS: readonly RailSpec['align'][] = ['start', 'center', 'end']

/** The edge a rail falls back to when the orientation it was given cannot reach it. */
export function railEdgeFor(orientation: RailSpec['orientation'], edge: RailSpec['edge']): RailSpec['edge'] {
  return RAIL_EDGES[orientation].includes(edge) ? edge : RAIL_EDGES[orientation][0]
}

export interface Board {
  /** Schema version, so a future migration can recognise older saves. */
  version: number
  pages: BoardPage[]
  plates: Plate[]
}

export interface Settings {
  locale: Locale
  /** Interface tone. The wallpaper is not consulted. */
  theme: 'light' | 'dark'
  /**
   * The material of the tile's *background layer*: the sheet the tile itself is
   * made of. Its own kind, its own amount, its own transparency.
   *
   * A tile is two layers — a background and the icon standing on it — and the two
   * are asked apart because they answer different questions and want different
   * things: a tile can be a pane of ground glass with a completely untouched logo
   * on it, or a plain card with a mark cast in liquid glass. One answer for both
   * was the older reading, and it made every choice a compromise between two
   * surfaces that are not the same size, are not looked at the same way, and do
   * not cost the machine the same.
   */
  backgroundMaterial: Material
  /** Whether the background layer is made of anything at all. */
  backgroundMaterialEnabled: boolean
  /** The material of the tile's *icon layer*: the mark and the pane it stands on. */
  iconMaterial: Material
  /** Whether the icon layer is made of anything at all. */
  iconMaterialEnabled: boolean
  /**
   * The material of the boxes a *folder* is drawn in: its cells, its glyph, and
   * the cover it has been given.
   *
   * A folder asks this separately from the icon layer because a folder is not an
   * icon: what it shows is its contents, and the box those contents are drawn in
   * is the folder's own surface. One answer for both meant a board wearing glass
   * marks had glass folders as well, with no way to say otherwise — a board of
   * plain folders holding photographs, or of glass folders holding plain marks,
   * was not expressible. A folder may answer for itself through
   * `Plate.folderMaterial`.
   */
  folderMaterial: Material
  /**
   * How round a *search bar* is, in px.
   *
   * A length rather than the share a tile is rounded by, because a bar is nothing
   * like a square: the same percentage across a bar thirty times wider than it is
   * tall draws an ellipse where a rectangle was meant, pointed at both ends. A
   * length asks the corner how far it should come in, which is the question a
   * person means, and at the top of the range the bar is a pill.
   */
  barRadius: number
  /**
   * Whether the engine's own mark opens a panel of every engine.
   *
   * The two ways of changing engines are separate answers rather than two settings,
   * so a board may have both: the mark for the whole list, a strip along the bar
   * for the two or three used every day. With neither, the bar keeps the engine it
   * was last given, which is a bar that has settled on one place to search.
   */
  engineMenu: boolean
  /** Whether every engine is also laid along the top of the search bar. */
  engineStrip: boolean
  /** How much room to leave around the grid, in vw. */
  wallMargin: number
  /** Whether the board may fetch site icons from a third party. */
  iconSource: 'auto' | 'off'
  iconProvider: string
  /** When the grid is drawn. */
  grid: 'drag' | 'always'
  cols: number
  rows: number
  wallpaper: Wallpaper
  /**
   * The wallpapers the user added themselves, which is the shelf a wallpaper can
   * be changed through rather than a setting of one picture.
   *
   * `wallpaper` above is what is hanging *now*; this is what is available, and the
   * two are kept apart so that changing the wallpaper — by hand from the widget, or
   * by the clock — never loses the shelf it was chosen from. The presets are not
   * here: they ship with the board, they cannot be removed, and a shelf of them
   * beside a shelf of the user's own would be two lists where one is wanted.
   */
  wallpapers: Wallpaper[]
  /** How that shelf takes turns, if it does. */
  wallRotation: Rotation
  /** What that wallpaper is made of, and how far it is diffused. */
  wall: Wall
  /**
   * The background colour of every tile, unless the tile answers for itself
   * through `Plate.fill`: the theme's card, a colour, or nothing at all.
   */
  tileFill: TileFill
  /** Whether plates print their names under themselves. A tile can say
   *  otherwise for itself through `Plate.showName`. */
  showNames: boolean
  /**
   * How large a tile's name is printed, in px. The line under a tile and nothing
   * else: it moves no tile, no mark and no opening, which is what makes it safe
   * to drag while the board is being looked at.
   */
  nameSize: number
  /**
   * How much the board is allowed to spend on looks. Read by the stylesheet as
   * `--fx`, which scales every material's own diffusion and ground, and as
   * `--motion`, which scales every duration.
   */
  performance: Performance
  /** Blur applied to image plate content, in px. */
  imageBlur: number
  /**
   * The corner radius of a picture itself, as a percentage of its own box, 0 to
   * 50.
   *
   * Apart from the tile's radius because a picture is the one thing on a board
   * that is a surface rather than an object standing on one: a photograph inside
   * a rounded tile is a photograph in a rounded frame, and its own corners are
   * its own business. At nought the frame does all the rounding, which is what
   * every picture the board has drawn so far did.
   */
  imageRadius: number
  /**
   * How much of a tile its mark fills, as a fraction of the tile's shorter
   * side.
   *
   * A fraction rather than a size, so a mark grows with the tile it sits in and
   * a 2x2 tile does not wear a 1x1 tile's mark. Past 1 the mark is larger than
   * its tile and the tile crops it.
   */
  iconSize: number
  /** Corner radius of the tile, as a percentage of its own box, 0 to 50. At the
   *  top of the range a square tile is a circle and a wide one an ellipse. */
  tileRadius: number
  /**
   * Where marks stand inside their tiles. A tile can say otherwise for itself
   * through `Plate.markOffset`.
   */
  markOffset: MarkOffset
  /**
   * Whether holding the right button over a tile lifts its icon off its
   * background.
   *
   * It is the one gesture that shows what a tile is made of: the background layer
   * steps back and the icon layer comes forward, and the two materials are seen
   * apart instead of stacked. An animation nobody wants is a tax on every press,
   * so it is a setting — and the menu it opens on release works either way.
   */
  peek: boolean
  /**
   * How big an engine's mark is drawn, in px. The marks above the bar are the
   * row of things you aim at to change engine, so their size is a setting and
   * not a constant: the same row has to serve a 4K display and a laptop, and
   * the bar's own size says nothing about which one the user is on.
   */
  engineMark: number
  /** The key that jumps to the search bar. A single character. */
  focusKey: string
  /**
   * The key held to *gather* rather than to open: a press under it adds the tile to
   * the pick, and what was gathered opens when the key is let go.
   */
  pickModifier: ModifierKey
  /** The key held to reveal the launch numbers and to launch a tile outright. */
  revealModifier: ModifierKey
  /**
   * What a search bar's field says before anything is typed into it.
   *
   * Empty or absent means the board's own wording, which is what a bar has always
   * shown. It is the board's rather than the bar's because the field is a field:
   * two bars side by side say the same thing about what typing into them does,
   * whatever engine each of them happens to be pointed at.
   */
  searchPlaceholder?: string
  /** Where the page rail is hung, and which way it runs. */
  rail: RailSpec
  searchEngines: SearchEngine[]
  activeEngineId: string
}

export const BOARD_VERSION = 1

/**
 * Every size a plate may take. The four the brief named come first; the rest
 * exist so a photograph or a list widget has somewhere to grow.
 */
export const SPAN_SET: ReadonlyArray<{ w: number; h: number }> = [
  { w: 1, h: 1 },
  { w: 1, h: 2 },
  { w: 2, h: 1 },
  { w: 2, h: 2 },
  { w: 3, h: 2 },
  { w: 2, h: 3 },
  { w: 3, h: 3 },
]

/** Sizes offered first in the interface. */
export const DEFAULT_SPANS = SPAN_SET.slice(0, 4)

export function spanKey(w: number, h: number): string {
  return `${w}x${h}`
}

/**
 * A whole surface the board hands over to. `board` is the new tab page itself;
 * the other two are the standalone reading views, which carry no search plate
 * and no shortcuts because that is exactly what the board is for.
 */
export type ViewName = 'board' | 'bookmarks' | 'history'

/** The file each view is served from, relative to the extension root. */
export const VIEW_FILE: Record<ViewName, string> = {
  board: 'index.html',
  bookmarks: 'bookmarks.html',
  history: 'history.html',
}

/**
 * Which view a widget opens when it is pressed, or null when it is only ever
 * read off the board. The clock has nothing to expand into.
 */
export function widgetView(widget: WidgetType | undefined): ViewName | null {
  switch (widget) {
    case 'bookmarks':
      return 'bookmarks'
    case 'history':
      return 'history'
    default:
      return null
  }
}

/**
 * Whether a plate has anything to launch.
 *
 * A clock tells the time, an image is a picture and a greeting is words: none of
 * them opens anything, so none of them is given a key. A folder holds things you
 * asked it to hold, and opens for them, so it does get one. Handing out a key
 * that does nothing is worse than handing out no key, because it makes the whole
 * reveal read as broken.
 */
export function isLaunchable(plate: Plate): boolean {
  if (plate.kind === 'link') return Boolean(plate.url)
  if (plate.kind === 'widget') return widgetView(plate.widget) !== null
  if (plate.kind === 'folder') return true
  return false
}

/**
 * Whether a plate lives inside a folder rather than on the grid. Nothing that
 * is held by a folder is laid out, counted for room or given a launch key.
 */
export function isFiled(plate: Plate): plate is Plate & { folderId: string } {
  return Boolean(plate.folderId)
}

/**
 * The keys launch targets are reached by, in order. Digits first because they
 * are the ones people expect; letters after them, so a board with more than
 * nine things on it does not run out of keys.
 */
export const LAUNCH_KEYS: readonly string[] = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
]
