/**
 * Everything that is not the canvas: the settings drawer, the menu that adds
 * something new, and the menu that belongs to a single plate.
 *
 * They read the store directly rather than having the whole board threaded
 * down through props, because each one is opened from exactly one place and
 * changes exactly one thing.
 */

import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useLocale, useT } from '../i18n'
import { useDismiss, useImageSource, useStoreFile } from '../lib/hooks'
import { FLAT_WALLPAPERS, flatWallpaper, freshText } from '../model/defaults'
import { labelOfWallpaper, sameWallpaper } from '../model/wallpaper'
import { iconCandidates } from '../platform/favicon'
import { useStore } from '../model/store'
import {
  BACKGROUND_MATERIAL_KINDS,
  BAR_RADIUS_MAX,
  DEFAULT_SPANS,
  ENGINE_MARK_MAX,
  ENGINE_MARK_MIN,
  ICON_SIZE_MAX,
  ICON_SIZE_MIN,
  MARK_OFFSET_MAX,
  MARK_OFFSET_STEP,
  MATERIAL_KINDS,
  MODIFIER_KEYS,
  ROTATION_EVERY_MIN,
  ROTATION_MODES,
  ROTATION_OFF,
  SEARCH_H_STEP,
  SEARCH_MAX_H,
  SEARCH_MIN_H,
  SEARCH_WIDTHS,
  TEXT_ALIGNS,
  TEXT_FONTS,
  TEXT_MAX_SIZE,
  TEXT_MIN_SIZE,
  TEXT_SIZE_STEP,
  TEXT_WEIGHTS,
  VARIANTS_MAX,
  WALL_BLUR_MAX,
  IMAGE_BLUR_MAX,
  MATERIAL_STRENGTH_MAX,
  MATERIAL_TRANSPARENCY_MAX,
  NAME_SIZE_MAX,
  NAME_SIZE_MIN,
  PERFORMANCE_LEVELS,
  RADIUS_MAX,
  RAIL_ALIGNS,
  RAIL_EDGES,
  RAIL_ORIENTATIONS,
  railEdgeFor,
  TILE_COLOURS,
  WALL_KINDS,
  WIDGET_STYLES,
  widgetView,
  type BoardPage,
  type ImageVariant,
  type Locale,
  type Plate,
  type PlateMaterial,
  type Rotation,
  type SearchEngine,
  type TextSpec,
  type TintToken,
  type ViewName,
  type Wallpaper,
} from '../model/types'
import type { Field } from '../layout/grid'
import { hostOf } from '../platform/data'
import { ICON_PROVIDERS } from '../platform/favicon'
import { FolderMark, engineOf } from './Plate'
import { WIDGETS, WIDGET_LABELS as WIDGET_LABEL } from './Widgets'

/**
 * The height a bar of this many rows comes to, in px, for the menu's readout.
 *
 * It is the same arithmetic the canvas lays a plate out with, so the number the
 * menu prints is the number the bar will actually be: `h` whole rows plus the
 * gaps between them.
 */
function barHeight(field: Field, h: number): number {
  return h * field.tile + (h - 1) * field.gapY
}

/** A slider's value brought onto its own step, so 0.1 does not arrive as 0.099999. */
function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step
}


/**
 * How a set of things takes turns, asked in one place and used in three.
 *
 * The wall, a shelf of pictures and a stack of paragraphs all take turns the same
 * way, so the control is the same control: which rule, how long between changes, or
 * which moments of the day name which one. The names of the things are passed in
 * because a list of moments has to say *what* it shows at eight in the morning, and
 * only the caller knows what its set holds.
 */
function RotationRows({
  rotation,
  count,
  labels,
  onChange,
}: {
  rotation: Rotation
  count: number
  labels?: string[]
  onChange(next: Rotation): void
}) {
  const t = useT()
  const nothingToTurn = count < 2
  return (
    <>
      <div className="field-row field-row--stack">
        <span className="field-row__label">{t('rotation.title')}</span>
        <div className="buttons">
          {ROTATION_MODES.map((mode) => (
            <button
              type="button"
              key={mode}
              disabled={nothingToTurn}
              className={`button${rotation.mode === mode ? ' button--primary' : ''}`}
              onClick={() => onChange({ ...rotation, mode })}
            >
              {t(`rotation.${mode}` as 'rotation.off')}
            </button>
          ))}
        </div>
      </div>
      {rotation.mode === 'interval' ? (
        <label className="field-row">
          <span className="field-row__label">{t('rotation.every')}</span>
          <input
            type="range"
            min={ROTATION_EVERY_MIN}
            max={240}
            step={5}
            value={rotation.every}
            onChange={(event) => onChange({ ...rotation, every: Number(event.target.value) })}
          />
          <span className="field-row__value">
            {rotation.every >= 60 && rotation.every % 60 === 0
              ? t('rotation.hours').replace('{n}', String(rotation.every / 60))
              : t('rotation.minutes').replace('{n}', String(rotation.every))}
          </span>
        </label>
      ) : null}
      {rotation.mode === 'clock' ? (
        <div className="field-row field-row--stack">
          <span className="field-row__label">{t('rotation.moments')}</span>
          {rotation.at.map((moment, at) => (
            <div className="rotation__moment" key={at}>
              <input
                type="time"
                className="input"
                value={moment.time}
                aria-label={t('rotation.moments')}
                onChange={(event) =>
                  onChange({
                    ...rotation,
                    at: rotation.at.map((one, index) => (index === at ? { ...one, time: event.target.value } : one)),
                  })
                }
              />
              <select
                className="input"
                value={Math.min(moment.index, Math.max(0, count - 1))}
                aria-label={t('rotation.moments')}
                onChange={(event) =>
                  onChange({
                    ...rotation,
                    at: rotation.at.map((one, index) =>
                      index === at ? { ...one, index: Number(event.target.value) } : one,
                    ),
                  })
                }
              >
                {Array.from({ length: count }, (_, index) => (
                  <option key={index} value={index}>
                    {labels?.[index] ?? String(index + 1)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-button"
                aria-label={t('common.remove')}
                title={t('common.remove')}
                onClick={() => onChange({ ...rotation, at: rotation.at.filter((_, index) => index !== at) })}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button"
            disabled={count < 1}
            onClick={() => onChange({ ...rotation, at: [...rotation.at, { time: '08:00', index: 0 }] })}
          >
            {t('rotation.addMoment')}
          </button>
        </div>
      ) : null}
      <p className="section__note">{nothingToTurn ? t('rotation.needTwo') : t('rotation.hint')}</p>
    </>
  )
}

/**
 * One wallpaper on the shelf, shown as the picture rather than as its name.
 *
 * The presets are drawn as pictures and a shelf of the user's own has to be drawn
 * the same way, or the two lists cannot be read together: a wallpaper is chosen by
 * looking at it. A file kept on this machine is read back through the same store a
 * hanging one is, and a pasted address is drawn by the browser — which is the same
 * distinction the two ways of bringing one in already make.
 *
 * The card carries a way off as well as a way to choose it: a shelf you can only add
 * to is a shelf that fills up with pictures nobody wanted twice.
 */
function ShelfCard({
  wallpaper,
  on,
  locale,
  onPick,
  onRemove,
}: {
  wallpaper: Wallpaper
  on: boolean
  locale: Locale
  onPick(): void
  onRemove(): void
}) {
  const t = useT()
  const stored = useImageSource(wallpaper.kind === 'upload' ? wallpaper.key : null)
  const url = stored ?? (wallpaper.kind === 'url' ? wallpaper.url : null)
  const flat = wallpaper.kind === 'flat' ? flatWallpaper(wallpaper.id) : undefined
  const label = labelOfWallpaper(wallpaper, locale)
  const style: CSSProperties | undefined = url
    ? { backgroundImage: `url("${url}")` }
    : flat
      ? { background: flat.colour }
      : undefined
  return (
    <span
      className={`wallpaper-card${on ? ' wallpaper-card--on' : ''}${url ? ' wallpaper-card--shot' : ''}${
        flat?.theme === 'dark' ? ' wallpaper-card--dark' : ''
      }`}
      style={style}
    >
      <button
        type="button"
        className="wallpaper-card__pick"
        aria-pressed={on}
        aria-label={label}
        title={label}
        onClick={onPick}
      />
      <span className="wallpaper-card__name">{label}</span>
      <button
        type="button"
        className="wallpaper-card__drop"
        aria-label={t('common.remove')}
        title={t('common.remove')}
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  )
}

/**
 * What a picture in a list is called: the name of the file it came from, or the site
 * it is served by. Either is what a person recognises it by — nobody reads a blob
 * key — and a picture with neither is one the record should not have kept.
 */
function labelOfPicture(variant: ImageVariant): string {
  if (variant.name) return variant.name
  if (variant.url) return hostOf(variant.url) || variant.url
  return '—'
}

/**
 * A new engine to be filled in, with an id of its own.
 *
 * The id is what the bar stores when it is told to search with this engine, so it
 * has to be unique and it has to be stable once the engine exists — hence a name
 * made at the moment of adding rather than one derived from whatever the user types
 * next. The address is a real one with the query in it, because a row that arrives
 * empty is a row that has to be guessed at before it can be used.
 */
function newEngine(locale: Locale): SearchEngine {
  return {
    id: `own-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: locale === 'zh' ? '新引擎' : 'New engine',
    urlTemplate: 'https://example.com/search?q=%s',
  }
}

/**
 * An address as a browser would take it.
 *
 * What a person types into an address field is usually a site — `example.com` —
 * and occasionally something with a scheme of its own, of which `mailto:` and
 * `about:` are the ones a board's tiles ever carry. The two are told apart by the
 * `//`: an address with a scheme and an authority has both, and a bare host with a
 * port (`example.com:8080`) looks like a scheme but is not one. Everything else is
 * given `https`, which is what the browser would have typed for them.
 */
function addressOf(typed: string): string {
  const trimmed = typed.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (/^(mailto|tel|about|data|file|view-source|chrome|moz-extension):/i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

/**
 * A plate's own material with one half handed back to the board.
 *
 * A plate answers a layer with a partial object, so clearing one slider must clear
 * that half and leave the rest: a tile that was given a kind of its own and then
 * has its strength handed back goes on being that kind and follows the board for
 * how much of it there is. When the last half goes the whole answer goes, which is
 * what returns the plate to following the board exactly as it did before it was
 * ever asked — and what the double click on each slider is for.
 */
function repairOwn(
  material: PlateMaterial | undefined,
  half: 'kind' | 'strength' | 'transparency',
): PlateMaterial | undefined {
  if (!material) return undefined
  const next: PlateMaterial = { ...material }
  delete next[half]
  return next.kind !== undefined || next.strength !== undefined || next.transparency !== undefined ? next : undefined
}


const ADD_MODES = ['link', 'image', 'widget', 'search', 'folder'] as const
type AddMode = (typeof ADD_MODES)[number]

const ADD_MODE_LABEL = {
  link: 'add.link',
  image: 'add.image',
  widget: 'add.widget',
  search: 'add.search',
  folder: 'folder.new',
} as const

const KIND_LABEL = {
  link: 'kind.link',
  widget: 'kind.widget',
  image: 'kind.image',
  search: 'kind.search',
  folder: 'folder.title',
  blank: 'kind.blank',
} as const

/** Everything needed to place a new plate, except where it lands. */
export type AddDraft = Omit<Plate, 'id' | 'x' | 'y' | 'pageId'>

/**
 * How a key is written down. A space has no glyph, so it gets a name; a letter
 * gets its capital; anything else (an arrow, a function key) is already its own
 * name.
 */
function describeKey(key: string, spaceLabel: string): string {
  if (key === ' ') return spaceLabel
  return key.length === 1 ? key.toUpperCase() : key
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose(): void }) {
  const t = useT()
  const { settings, patchSettings, restoreSamples, board, bayId, patchPlate } = useStore()
  const ref = useDismiss<HTMLDivElement>(open, onClose)
  const storeFile = useStoreFile()

  // The bars of the page you are looking at. A hidden bar cannot be reached on
  // the board at all, so this is also the only way back to it.
  const bars = board.plates.filter((plate) => plate.pageId === bayId && plate.kind === 'search')

  /*
   * A wallpaper the user brought, filed and hung.
   *
   * Bringing one is two acts that a person means as one: it goes on the shelf so
   * that it can be come back to, and it goes on the wall so that it can be seen.
   * The same picture brought twice is not added twice — the shelf is a list of
   * pictures, not a log of uploads — so it is found by what it is and merely hung.
   */
  const addToShelf = (candidate: Wallpaper) => {
    const known = settings.wallpapers.some((one) => sameWallpaper(one, candidate))
    patchSettings({
      wallpaper: candidate,
      wallpapers: known || settings.wallpapers.length >= VARIANTS_MAX ? settings.wallpapers : [...settings.wallpapers, candidate],
    })
  }

  if (!open) return null

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" ref={ref} role="dialog" aria-label={t('settings.title')}>
        <div className="drawer__head">
          <span className="drawer__title">{t('settings.title')}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>

        <div className="drawer__body">
          <section>
            <div className="section__title">{t('wallpaper.title')}</div>
            <div className="wallpaper-grid">
              <button
                type="button"
                className={`wallpaper-card wallpaper-card--none${
                  settings.wallpaper.kind === 'none' ? ' wallpaper-card--on' : ''
                }`}
                onClick={() => patchSettings({ wallpaper: { kind: 'none' } })}
                aria-pressed={settings.wallpaper.kind === 'none'}
              >
                <span className="wallpaper-card__name">{t('wallpaper.none')}</span>
              </button>

              {FLAT_WALLPAPERS.map((preset) => {
                const on = settings.wallpaper.kind === 'flat' && settings.wallpaper.id === preset.id
                return (
                  <button
                    type="button"
                    key={preset.id}
                    className={`wallpaper-card${on ? ' wallpaper-card--on' : ''}${
                      preset.theme === 'dark' ? ' wallpaper-card--dark' : ''
                    }`}
                    style={{ background: preset.colour }}
                    onClick={() => patchSettings({ wallpaper: { kind: 'flat', id: preset.id } })}
                    aria-pressed={on}
                  >
                    <span className="wallpaper-card__name">{preset.label[settings.locale]}</span>
                  </button>
                )
              })}
            </div>

            <div className="field-row" style={{ marginTop: 12 }}>
              <span className="field-row__label">{t('wallpaper.upload')}</span>
              <label className="button">
                {t('wallpaper.choose')}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (!file) return
                    const key = await storeFile(file, 'wall')
                    // Filed here *and* put on the shelf: a wallpaper the user
                    // brought is one they may want to come back to, so it is added
                    // to the list of their own as well as being hung.
                    if (key) addToShelf({ kind: 'upload', key, name: file.name })
                  }}
                />
              </label>
            </div>
            <WallpaperUrlRow onAdd={addToShelf} />
            {/*
             * The shelf of the user's own wallpapers, which is what a wallpaper can
             * be changed through. The presets above are not on it: they ship with
             * the board, they cannot be removed, and a shelf mixed from both would
             * be a list you can half delete.
             */}
            <div className="field-row field-row--stack" style={{ marginTop: 12 }}>
              <span className="field-row__label">{t('wallpaper.shelf')}</span>
              {settings.wallpapers.length ? (
                <div className="wallpaper-grid">
                  {settings.wallpapers.map((candidate, at) => (
                    <ShelfCard
                      key={`${candidate.kind}-${at}`}
                      wallpaper={candidate}
                      locale={settings.locale}
                      on={sameWallpaper(candidate, settings.wallpaper)}
                      onPick={() => patchSettings({ wallpaper: candidate })}
                      onRemove={() =>
                        patchSettings({
                          wallpapers: settings.wallpapers.filter((_, index) => index !== at),
                        })
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="section__note">{t('wallpaper.shelfEmpty')}</p>
              )}
            </div>
            {/* And how that shelf takes its turns: by the clock, by an interval, or
                not at all. */}
            <RotationRows
              rotation={settings.wallRotation}
              count={settings.wallpapers.length}
              labels={settings.wallpapers.map((candidate) => labelOfWallpaper(candidate, settings.locale))}
              onChange={(next) => patchSettings({ wallRotation: next })}
            />


            {/* What the wall is made of, and how far off its focus is. Both are
                only asked for when there is a wall to ask about: with no
                wallpaper there is no picture to be made of anything. */}
            {settings.wallpaper.kind !== 'none' ? (
              <>
                <div className="field-row field-row--stack" style={{ marginTop: 12 }}>
                  <span className="field-row__label">{t('wallpaper.material')}</span>
                  <div className="buttons">
                    {WALL_KINDS.map((kind) => (
                      <button
                        type="button"
                        key={kind}
                        className={`button${settings.wall.kind === kind ? ' button--primary' : ''}`}
                        onClick={() =>
                          patchSettings({
                            wall:
                              kind === 'custom'
                                ? { ...settings.wall, kind, colour: settings.wall.colour ?? '#3f4a63' }
                                : { ...settings.wall, kind },
                          })
                        }
                      >
                        {t(`wall.${kind}` as 'wall.clear')}
                      </button>
                    ))}
                  </div>
                </div>
                {settings.wall.kind === 'custom' ? (
                  <label className="field-row">
                    <span className="field-row__label">{t('wallpaper.wallColour')}</span>
                    <input
                      type="color"
                      className="colour-input"
                      value={settings.wall.colour ?? '#3f4a63'}
                      onChange={(event) =>
                        patchSettings({ wall: { ...settings.wall, colour: event.target.value } })
                      }
                    />
                    <span className="field-row__value">{settings.wall.colour ?? '#3f4a63'}</span>
                  </label>
                ) : null}
                <label className="field-row">
                  <span className="field-row__label">{t('wallpaper.blur')}</span>
                  <input
                    type="range"
                    min={0}
                    max={WALL_BLUR_MAX}
                    step={1}
                    value={settings.wall.blur}
                    onChange={(event) =>
                      patchSettings({ wall: { ...settings.wall, blur: Number(event.target.value) } })
                    }
                  />
                  <span className="field-row__value">
                    {settings.wall.blur > 0 ? `${settings.wall.blur}px` : t('wallpaper.blurOff')}
                  </span>
                </label>
                <p className="field-row__hint">{t('wallpaper.wallHint')}</p>
                {/*
                 * A wallpaper can be glass too, and the strength belongs to the
                 * same question here as it does on a mark: how much glass. It is
                 * hidden on a wall made of nothing — there is no material to
                 * thicken — and the blur above it stays the wall's own, which is
                 * the picture going soft rather than anything laid over it. Named
                 * for the background rather than for materials in general, because
                 * the row below carries the same word for the tiles.
                 */}
                {settings.wall.kind === 'acrylic' ||
                settings.wall.kind === 'frosted' ||
                settings.wall.kind === 'liquid' ? (
                  <label className="field-row">
                    <span className="field-row__label">{t('wallpaper.wallStrength')}</span>
                    <input
                      type="range"
                      min={0}
                      max={MATERIAL_STRENGTH_MAX}
                      step={1}
                      value={settings.wall.strength}
                      onChange={(event) =>
                        patchSettings({
                          wall: { ...settings.wall, strength: Number(event.target.value) },
                        })
                      }
                    />
                    <span className="field-row__value">{settings.wall.strength}%</span>
                  </label>
                ) : null}
              </>
            ) : null}
          </section>

          <section>
            <div className="section__title">{t('settings.appearance')}</div>
            <div className="field-row">
              <span className="field-row__label">{t('settings.theme')}</span>
              <select
                className="input"
                value={settings.theme}
                onChange={(event) => patchSettings({ theme: event.target.value as 'light' | 'dark' })}
              >
                <option value="light">{t('theme.light')}</option>
                <option value="dark">{t('theme.dark')}</option>
              </select>
            </div>
            <label className="field-row">
              <span className="field-row__label">{t('settings.wallMargin')}</span>
              <input
                type="range"
                min={0}
                max={12}
                step={0.5}
                value={settings.wallMargin}
                onChange={(event) => patchSettings({ wallMargin: Number(event.target.value) })}
              />
              <span className="field-row__value">{settings.wallMargin}</span>
            </label>
            <div className="field-row">
              <span className="field-row__label">{t('settings.language')}</span>
              <select
                className="input"
                value={settings.locale}
                onChange={(event) => patchSettings({ locale: event.target.value as 'zh' | 'en' })}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            {/*
             * The performance stop, as three notches rather than a percentage.
             *
             * It is a choice between three boards, not a quantity — nobody knows
             * what seventy per cent of a blur is — and the three have names. The
             * track is where the answer is shown: the pips up to the chosen stop
             * fill in, so the setting reads as "this much of the board is lit",
             * and the pip you chose swells under its own transition. Both are
             * scaled by `--motion`, so a reader who asked their system for
             * stillness gets the same three notches without the travel.
             */}
            <div className="field-row field-row--stack">
              <span className="field-row__label">{t('settings.performance')}</span>
              <div className="stops" role="radiogroup" aria-label={t('settings.performance')}>
                {PERFORMANCE_LEVELS.map((level, index) => (
                  <button
                    type="button"
                    key={level}
                    role="radio"
                    aria-checked={level === settings.performance}
                    className={`stops__stop${level === settings.performance ? ' stops__stop--on' : ''}`}
                    onClick={() => patchSettings({ performance: level })}
                  >
                    <span className="stops__pip" aria-hidden="true">
                      <span
                        className="stops__fill"
                        style={{
                          transform: `scaleX(${index <= PERFORMANCE_LEVELS.indexOf(settings.performance) ? 1 : 0})`,
                        }}
                      />
                    </span>
                    {t(`performance.${level}` as 'performance.low')}
                  </button>
                ))}
              </div>
            </div>
            <div className="field-row">
              <span className="field-row__label">{t('settings.grid')}</span>
              <select
                className="input"
                value={settings.grid}
                onChange={(event) => patchSettings({ grid: event.target.value as 'drag' | 'always' })}
              >
                <option value="drag">{t('settings.gridDrag')}</option>
                <option value="always">{t('settings.gridAlways')}</option>
              </select>
            </div>
          </section>

          <section>
            <div className="section__title">{t('settings.groupBackground')}</div>
            {/*
             * What the tile's background layer is coloured with.
             *
             * Three answers, and they are three different wishes: the theme's own
             * card, a colour of the user's, or nothing at all — which is how the
             * wallpaper is let through. The colour is asked once, for the whole
             * board, and answered by a tile on its own menu when one tile wants to
             * differ; what the layer is *made of* is the question underneath, and
             * it is not a colour question.
             */}
            <div className="field-row field-row--stack">
              <span className="field-row__label">{t('settings.tileGround')}</span>
              <div className="buttons">
                <button
                  type="button"
                  className={`button${settings.tileFill.kind === 'auto' ? ' button--primary' : ''}`}
                  onClick={() => patchSettings({ tileFill: { kind: 'auto' } })}
                >
                  {t('settings.tileGroundAuto')}
                </button>
                <button
                  type="button"
                  className={`button${settings.tileFill.kind === 'none' ? ' button--primary' : ''}`}
                  onClick={() => patchSettings({ tileFill: { kind: 'none' } })}
                >
                  {t('settings.tileGroundNone')}
                </button>
                <input
                  type="color"
                  className="colour-input"
                  aria-label={t('settings.tileColour')}
                  value={settings.tileFill.colour ?? '#ffffff'}
                  onChange={(event) =>
                    patchSettings({ tileFill: { kind: 'custom', colour: event.target.value } })
                  }
                />
                <span className="field-row__value">
                  {settings.tileFill.kind === 'custom'
                    ? settings.tileFill.colour ?? t('settings.tileGroundCard')
                    : t('settings.tileGroundCard')}
                </span>
              </div>
            </div>
            <div className="swatches">
              {TILE_COLOURS.map((colour) => (
                <button
                  type="button"
                  key={colour}
                  className={`swatch${
                    settings.tileFill.kind === 'custom' && settings.tileFill.colour === colour ? ' swatch--on' : ''
                  }`}
                  style={{ background: colour }}
                  aria-label={colour}
                  title={colour}
                  onClick={() => patchSettings({ tileFill: { kind: 'custom', colour } })}
                />
              ))}
            </div>
            {/*
             * Whether the layer is made of anything at all, which is the one place
             * "nothing" is said now that the material row no longer offers it: the
             * colour has its own transparent answer, and two rows both saying "let
             * the wallpaper through" is one question asked twice. Switching it back
             * on returns the material that was last chosen rather than a default.
             */}
            <div className="field-row field-row--check">
              <input
                type="checkbox"
                checked={settings.backgroundMaterialEnabled && settings.backgroundMaterial.kind !== 'none'}
                onChange={(event) =>
                  patchSettings(
                    event.target.checked
                      ? {
                          backgroundMaterialEnabled: true,
                          backgroundMaterial: {
                            ...settings.backgroundMaterial,
                            kind: settings.backgroundMaterial.kind === 'none' ? 'solid' : settings.backgroundMaterial.kind,
                          },
                        }
                      : { backgroundMaterialEnabled: false },
                  )
                }
              />
              <span className="field-row__label">{t('settings.backgroundMaterialEnabled')}</span>
            </div>
            <div className="field-row field-row--stack">
              <span className="field-row__label">{t('settings.backgroundMaterial')}</span>
              <div className="buttons">
                {BACKGROUND_MATERIAL_KINDS.map((kind) => (
                  <button
                    type="button"
                    key={kind}
                    className={`button${settings.backgroundMaterial.kind === kind ? ' button--primary' : ''}`}
                    onClick={() =>
                      patchSettings({
                        backgroundMaterialEnabled: true,
                        backgroundMaterial: { ...settings.backgroundMaterial, kind },
                      })
                    }
                  >
                    {t(`material.${kind}` as 'material.solid')}
                  </button>
                ))}
              </div>
            </div>
            <label className="field-row">
              <span className="field-row__label">{t('settings.materialStrength')}</span>
              <input
                type="range"
                min={0}
                max={MATERIAL_STRENGTH_MAX}
                step={1}
                value={settings.backgroundMaterial.strength}
                onChange={(event) =>
                  patchSettings({
                    backgroundMaterial: { ...settings.backgroundMaterial, strength: Number(event.target.value) },
                  })
                }
              />
              <span className="field-row__value">{settings.backgroundMaterial.strength}%</span>
            </label>
            <label className="field-row">
              <span className="field-row__label">{t('settings.materialTransparency')}</span>
              <input
                type="range"
                min={0}
                max={MATERIAL_TRANSPARENCY_MAX}
                step={1}
                value={settings.backgroundMaterial.transparency}
                onChange={(event) =>
                  patchSettings({
                    backgroundMaterial: {
                      ...settings.backgroundMaterial,
                      transparency: Number(event.target.value),
                    },
                  })
                }
              />
              <span className="field-row__value">{settings.backgroundMaterial.transparency}%</span>
            </label>
          </section>

          <section>
            <div className="section__title">{t('settings.groupIcon')}</div>
            {/*
             * The other sheet, on the other layer. The same five answers, asked
             * apart from the background's because the two are not the same size and
             * not looked at for the same thing: a background is read for its colour
             * and its weight, a mark for its edge and its gloss.
             */}
            <div className="field-row field-row--check">
              <input
                type="checkbox"
                checked={settings.iconMaterialEnabled}
                onChange={(event) => patchSettings({ iconMaterialEnabled: event.target.checked })}
              />
              <span className="field-row__label">{t('settings.iconMaterialEnabled')}</span>
            </div>
            <div className="field-row field-row--stack">
              <span className="field-row__label">{t('settings.iconMaterial')}</span>
              <div className="buttons">
                {MATERIAL_KINDS.map((kind) => (
                  <button
                    type="button"
                    key={kind}
                    className={`button${settings.iconMaterial.kind === kind ? ' button--primary' : ''}`}
                    onClick={() => patchSettings({ iconMaterial: { ...settings.iconMaterial, kind } })}
                  >
                    {t(`material.${kind}` as 'material.solid')}
                  </button>
                ))}
              </div>
            </div>
            <label className="field-row">
              <span className="field-row__label">{t('settings.iconMaterialStrength')}</span>
              <input
                type="range"
                min={0}
                max={MATERIAL_STRENGTH_MAX}
                step={1}
                value={settings.iconMaterial.strength}
                onChange={(event) =>
                  patchSettings({ iconMaterial: { ...settings.iconMaterial, strength: Number(event.target.value) } })
                }
              />
              <span className="field-row__value">{settings.iconMaterial.strength}%</span>
            </label>
            <label className="field-row">
              <span className="field-row__label">{t('settings.iconMaterialTransparency')}</span>
              <input
                type="range"
                min={0}
                max={MATERIAL_TRANSPARENCY_MAX}
                step={1}
                value={settings.iconMaterial.transparency}
                onChange={(event) =>
                  patchSettings({
                    iconMaterial: { ...settings.iconMaterial, transparency: Number(event.target.value) },
                  })
                }
              />
              <span className="field-row__value">{settings.iconMaterial.transparency}%</span>
            </label>
            <label className="field-row">
              <span className="field-row__label">{t('settings.iconSize')}</span>
              <input
                type="range"
                min={ICON_SIZE_MIN * 100}
                max={ICON_SIZE_MAX * 100}
                step={2}
                value={Math.round(settings.iconSize * 100)}
                onChange={(event) => patchSettings({ iconSize: Number(event.target.value) / 100 })}
              />
              <span className="field-row__value">{Math.round(settings.iconSize * 100)}%</span>
            </label>
            {/* The top of this range is past the tile on purpose: a mark bigger
                than the opening it stands in is cropped by it, which is a look
                worth being able to ask for. */}
            <p className="section__note">{t('settings.iconSizeHint')}</p>
            {/* The names under the tiles, which had a size all along and no way
                to say what it was. */}
            <label className="field-row field-row--check">
              <input
                type="checkbox"
                checked={settings.showNames}
                onChange={(event) => patchSettings({ showNames: event.target.checked })}
              />
              <span className="field-row__label">{t('settings.showNames')}</span>
            </label>
            <label className="field-row">
              <span className="field-row__label">{t('settings.nameSize')}</span>
              <input
                type="range"
                min={NAME_SIZE_MIN}
                max={NAME_SIZE_MAX}
                step={1}
                value={settings.nameSize}
                onChange={(event) => patchSettings({ nameSize: Number(event.target.value) })}
              />
              <span className="field-row__value">{settings.nameSize}px</span>
            </label>
            <p className="section__note">{t('settings.nameSizeHint')}</p>
            {/* Where the mark stands. A board-wide answer, with a tile's own on
                the tile's menu: one icon over a photograph may want to sit off
                centre while every other one stays where it is. */}
            <label className="field-row">
              <span className="field-row__label">{t('settings.markOffsetX')}</span>
              <input
                type="range"
                min={-MARK_OFFSET_MAX}
                max={MARK_OFFSET_MAX}
                step={MARK_OFFSET_STEP}
                value={settings.markOffset.x}
                onChange={(event) =>
                  patchSettings({ markOffset: { ...settings.markOffset, x: Number(event.target.value) } })
                }
              />
              <span className="field-row__value">{settings.markOffset.x}%</span>
            </label>
            <label className="field-row">
              <span className="field-row__label">{t('settings.markOffsetY')}</span>
              <input
                type="range"
                min={-MARK_OFFSET_MAX}
                max={MARK_OFFSET_MAX}
                step={MARK_OFFSET_STEP}
                value={settings.markOffset.y}
                onChange={(event) =>
                  patchSettings({ markOffset: { ...settings.markOffset, y: Number(event.target.value) } })
                }
              />
              <span className="field-row__value">{settings.markOffset.y}%</span>
            </label>
            <p className="section__note">{t('settings.markOffsetHint')}</p>
          </section>

          <section>
            <div className="section__title">{t('settings.groupTile')}</div>
            {/*
             * How big a tile is.
             *
             * Asked as a count of columns and rows rather than as a size in
             * pixels, because the board fills the window it is opened in: the
             * openings are what the picture is divided into, and every tile is a
             * whole number of them. Fewer columns is a bigger tile, and the whole
             * board stays on screen at every window size, which a pixel size
             * cannot promise.
             */}
            <div className="field-row">
              <span className="field-row__label">{t('settings.tileSize')}</span>
              <select
                className="input"
                value={settings.cols}
                onChange={(event) => patchSettings({ cols: Number(event.target.value) })}
              >
                {[8, 10, 12, 14, 16, 18, 20].map((n) => (
                  <option key={n} value={n}>
                    {n} {t('settings.columns')}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={settings.rows}
                onChange={(event) => patchSettings({ rows: Number(event.target.value) })}
              >
                {[3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    {n} {t('settings.rows')}
                  </option>
                ))}
              </select>
            </div>
            <p className="section__note">{t('settings.tileSizeHint')}</p>
            {/*
             * And how round the tile is.
             *
             * A share of the tile's own box, so the top of the range is the
             * tile's own shape and nothing else: a square tile rounds all the way
             * into a circle, and a tile twice as wide as it is tall rounds into an
             * ellipse. Only the sheet the tile is cut from is rounded — not the
             * mark standing on it, which has its own corners, and not a picture,
             * which has the group below.
             */}
            <label className="field-row">
              <span className="field-row__label">{t('settings.tileRadius')}</span>
              <input
                type="range"
                min={0}
                max={RADIUS_MAX}
                step={1}
                value={settings.tileRadius}
                onChange={(event) => patchSettings({ tileRadius: Number(event.target.value) })}
              />
              <span className="field-row__value">{settings.tileRadius}%</span>
            </label>
            <p className="section__note">{t('settings.tileRadiusHint')}</p>
            {/* The right button, which both looks and commands. Held, the icon
                comes off its background so that the two layers can be read one at
                a time; let go, the menu opens where the button went down. */}
            <label className="field-row field-row--check">
              <input
                type="checkbox"
                checked={settings.peek}
                onChange={(event) => patchSettings({ peek: event.target.checked })}
              />
              <span className="field-row__label">{t('settings.peek')}</span>
            </label>
            <p className="section__note">{t('settings.peekHint')}</p>
          </section>

          <section>
            <div className="section__title">{t('settings.groupPicture')}</div>
            {/* A picture is the one tile that has no room for a background behind
                it: it covers the opening it is given, so its corners are its own
                and are cut on its own edge, independent of the tile's. */}
            <label className="field-row">
              <span className="field-row__label">{t('settings.imageRadius')}</span>
              <input
                type="range"
                min={0}
                max={RADIUS_MAX}
                step={1}
                value={settings.imageRadius}
                onChange={(event) => patchSettings({ imageRadius: Number(event.target.value) })}
              />
              <span className="field-row__value">{settings.imageRadius}%</span>
            </label>
            <label className="field-row">
              <span className="field-row__label">{t('settings.imageBlur')}</span>
              <input
                type="range"
                min={0}
                max={IMAGE_BLUR_MAX}
                step={1}
                value={settings.imageBlur}
                onChange={(event) => patchSettings({ imageBlur: Number(event.target.value) })}
              />
              <span className="field-row__value">
                {settings.imageBlur > 0 ? `${settings.imageBlur}px` : t('settings.blurOff')}
              </span>
            </label>
            <p className="section__note">{t('settings.imageHint')}</p>
          </section>

          <section>
            <div className="section__title">{t('settings.groupFolder')}</div>
            {/*
             * A folder's own surface, which is a question of its own rather than a
             * second half of the icon layer.
             *
             * What a folder shows is what is inside it — up to four cells, a glyph,
             * or a cover — so the sheet this setting is about is the box those
             * things are drawn in. One answer for folders and marks together meant
             * a board in glass had glass folders as well, with nothing left to say
             * that a folder should stay plain while its marks do not.
             */}
            <div className="field-row field-row--stack">
              <span className="field-row__label">{t('settings.folderMaterial')}</span>
              <div className="buttons">
                {MATERIAL_KINDS.map((kind) => (
                  <button
                    type="button"
                    key={kind}
                    className={`button${settings.folderMaterial.kind === kind ? ' button--primary' : ''}`}
                    onClick={() => patchSettings({ folderMaterial: { ...settings.folderMaterial, kind } })}
                  >
                    {t(`material.${kind}` as 'material.solid')}
                  </button>
                ))}
              </div>
            </div>
            {settings.folderMaterial.kind !== 'none' ? (
              <>
                <label className="field-row">
                  <span className="field-row__label">{t('settings.materialStrength')}</span>
                  <input
                    type="range"
                    min={0}
                    max={MATERIAL_STRENGTH_MAX}
                    step={1}
                    value={settings.folderMaterial.strength}
                    onChange={(event) =>
                      patchSettings({
                        folderMaterial: { ...settings.folderMaterial, strength: Number(event.target.value) },
                      })
                    }
                  />
                  <span className="field-row__value">{settings.folderMaterial.strength}%</span>
                </label>
                <label className="field-row">
                  <span className="field-row__label">{t('settings.materialTransparency')}</span>
                  <input
                    type="range"
                    min={0}
                    max={MATERIAL_TRANSPARENCY_MAX}
                    step={1}
                    value={settings.folderMaterial.transparency}
                    onChange={(event) =>
                      patchSettings({
                        folderMaterial: { ...settings.folderMaterial, transparency: Number(event.target.value) },
                      })
                    }
                  />
                  <span className="field-row__value">{settings.folderMaterial.transparency}%</span>
                </label>
              </>
            ) : null}
          </section>

          <section>
            <div className="section__title">{t('search.engine')}</div>
            {/*
             * The two ways of changing engines, as two ticks rather than as a choice
             * between them.
             *
             * They are not alternatives: the strip is for the two or three places
             * searched every day, laid along the bar where one press reaches them,
             * and the panel is for the whole list behind the mark. A board may want
             * both, and the answer it gives when it wants neither is not a third
             * question — with neither ticked the bar keeps the engine it was last
             * given, which is a bar that has settled.
             */}
            <div className="field-row field-row--check">
              <input
                type="checkbox"
                checked={settings.engineMenu}
                onChange={(event) => patchSettings({ engineMenu: event.target.checked })}
              />
              <span className="field-row__label">{t('settings.engineMenu')}</span>
            </div>
            <div className="field-row field-row--check">
              <input
                type="checkbox"
                checked={settings.engineStrip}
                onChange={(event) => patchSettings({ engineStrip: event.target.checked })}
              />
              <span className="field-row__label">{t('settings.engineStrip')}</span>
            </div>
            <p className="section__note">{t('settings.engineHint')}</p>
            {/*
             * The engines the bar can search, which are the ones that ship and any
             * the user adds.
             *
             * An engine is a name and an address with `%s` where the words go: that
             * is all one has ever been, and it is enough to add the one a person
             * actually uses. The marks are bundled rather than fetched, so an engine
             * with no mark of its own is drawn as a magnifier — which stands for "an
             * engine" without pretending to be a brand.
             *
             * The last one cannot be removed: a bar with no engines is a bar that
             * cannot search, and the field's own wording promises a search.
             */}
            <div className="field-row field-row--stack">
              <span className="field-row__label">{t('settings.engines')}</span>
              <div className="engines-edit">
                {settings.searchEngines.map((engine, at) => (
                  <div className="engines-edit__row" key={engine.id}>
                    <input
                      type="text"
                      className="input"
                      value={engine.name}
                      aria-label={t('settings.engineName')}
                      placeholder={t('settings.engineName')}
                      onChange={(event) =>
                        patchSettings({
                          searchEngines: settings.searchEngines.map((one, index) =>
                            index === at ? { ...one, name: event.target.value } : one,
                          ),
                        })
                      }
                    />
                    <input
                      type="text"
                      className="input input--wide"
                      value={engine.urlTemplate}
                      aria-label={t('settings.engineUrl')}
                      placeholder={t('settings.engineUrlHint')}
                      spellCheck={false}
                      data-warn={/%s/.test(engine.urlTemplate) ? undefined : 'on'}
                      onChange={(event) =>
                        patchSettings({
                          searchEngines: settings.searchEngines.map((one, index) =>
                            index === at ? { ...one, urlTemplate: event.target.value } : one,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="icon-button"
                      disabled={settings.searchEngines.length < 2}
                      aria-label={t('common.remove')}
                      title={t('common.remove')}
                      onClick={() =>
                        patchSettings({
                          searchEngines: settings.searchEngines.filter((_, index) => index !== at),
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="button"
                onClick={() =>
                  patchSettings({
                    searchEngines: [...settings.searchEngines, newEngine(settings.locale)],
                  })
                }
              >
                {t('settings.engineAdd')}
              </button>
            </div>
            <p className="section__note">{t('settings.enginesHint')}</p>
            <label className="field-row">
              <span className="field-row__label">{t('settings.barRadius')}</span>
              <input
                type="range"
                min={0}
                max={BAR_RADIUS_MAX}
                step={1}
                value={settings.barRadius}
                onChange={(event) => patchSettings({ barRadius: Number(event.target.value) })}
              />
              <span className="field-row__value">{settings.barRadius}px</span>
            </label>
            <label className="field-row">
              <span className="field-row__label">{t('settings.engineMark')}</span>
              <input
                type="range"
                min={ENGINE_MARK_MIN}
                max={ENGINE_MARK_MAX}
                step={2}
                value={settings.engineMark}
                onChange={(event) => patchSettings({ engineMark: Number(event.target.value) })}
              />
              <span className="field-row__value">{settings.engineMark}px</span>
            </label>
            {/*
             * What the field says before anything is typed in it. One line, so
             * the field cannot be pushed wider by it, and an empty box means the
             * default wording rather than a field with nothing to say.
             */}
            <label className="field-row field-row--stack">
              <span className="field-row__label">{t('settings.searchPlaceholder')}</span>
              <input
                type="text"
                className="input"
                maxLength={80}
                value={settings.searchPlaceholder ?? ''}
                placeholder={t('settings.searchPlaceholderDefault')}
                onChange={(event) => {
                  const next = event.target.value
                  patchSettings({ searchPlaceholder: next.trim() ? next : undefined })
                }}
              />
            </label>
            <p className="section__note">{t('settings.searchPlaceholderHint')}</p>
          </section>

          <section>
            <div className="section__title">{t('settings.rail')}</div>
            {/*
             * Three questions with two, four and three answers, and only the
             * first one constrains the others: a row cannot hang on a side edge,
             * so changing the arrangement to a column moves an edge that no
             * longer exists over to the first one the column can reach. That
             * correction lives in `railEdgeFor`, in the model, because it is a
             * fact about rails and not about this form.
             */}
            <div className="field-row">
              <span className="field-row__label">{t('settings.railOrientation')}</span>
              <div className="buttons">
                {RAIL_ORIENTATIONS.map((orientation) => (
                  <button
                    type="button"
                    key={orientation}
                    className={`button${settings.rail.orientation === orientation ? ' button--primary' : ''}`}
                    onClick={() =>
                      patchSettings({
                        rail: {
                          ...settings.rail,
                          orientation,
                          edge: railEdgeFor(orientation, settings.rail.edge),
                        },
                      })
                    }
                  >
                    {t(`rail.${orientation}` as 'rail.row')}
                  </button>
                ))}
              </div>
            </div>
            <div className="field-row">
              <span className="field-row__label">{t('settings.railEdge')}</span>
              <div className="buttons">
                {RAIL_EDGES[settings.rail.orientation].map((edge) => (
                  <button
                    type="button"
                    key={edge}
                    className={`button${settings.rail.edge === edge ? ' button--primary' : ''}`}
                    onClick={() => patchSettings({ rail: { ...settings.rail, edge } })}
                  >
                    {t(`rail.${edge}` as 'rail.top')}
                  </button>
                ))}
              </div>
            </div>
            <div className="field-row">
              <span className="field-row__label">{t('settings.railAlign')}</span>
              <div className="buttons">
                {RAIL_ALIGNS.map((align) => (
                  <button
                    type="button"
                    key={align}
                    className={`button${settings.rail.align === align ? ' button--primary' : ''}`}
                    onClick={() => patchSettings({ rail: { ...settings.rail, align } })}
                  >
                    {settings.rail.orientation === 'row'
                      ? t(`railAlignX.${align}` as 'railAlignX.start')
                      : t(`railAlignY.${align}` as 'railAlignY.start')}
                  </button>
                ))}
              </div>
            </div>
            <p className="section__note">{t('settings.railHint')}</p>
          </section>

          <section>
            <div className="section__title">{t('settings.keys')}</div>
            <div className="field-row">
              <span className="field-row__label">{t('settings.focusKey')}</span>
              <button
                type="button"
                className="input input--key"
                onClick={(event) => (event.currentTarget as HTMLElement).focus()}
                onKeyDown={(event) => {
                  if (event.key === 'Tab') return
                  event.preventDefault()
                  if (event.key === 'Escape') return
                  patchSettings({ focusKey: event.key })
                }}
              >
                {describeKey(settings.focusKey, t('key.space'))}
              </button>
              <button type="button" className="button" onClick={() => patchSettings({ focusKey: ' ' })}>
                {t('common.reset')}
              </button>
            </div>
            <p className="section__note">{t('settings.focusKeyHint')}</p>
            {/*
             * The two keys the board is held by, each offered as the five keys a
             * modifier can be: the hand that reaches for Ctrl on one keyboard reaches
             * for Command on another, a browser that keeps Ctrl for itself leaves
             * another key to be picked, and a board that wants neither gesture can say
             * so. None of the three is a wrong answer.
             */}
            {(
              [
                ['pickModifier', settings.pickModifier, 'settings.pickKey', 'settings.pickKeyHint'],
                ['revealModifier', settings.revealModifier, 'settings.revealKey', 'settings.revealKeyHint'],
              ] as const
            ).map(([field, current, label, hint]) => (
              <div key={field}>
                <div className="field-row field-row--stack">
                  <span className="field-row__label">{t(label)}</span>
                  <div className="buttons">
                    {MODIFIER_KEYS.map((key) => (
                      <button
                        type="button"
                        key={key}
                        className={`button${current === key ? ' button--primary' : ''}`}
                        onClick={() => patchSettings({ [field]: key })}
                      >
                        {t(`key.${key}` as 'key.ctrl')}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="section__note">{t(hint)}</p>
              </div>
            ))}
          </section>

          <section>
            <div className="section__title">{t('settings.icons')}</div>
            <div className="field-row">
              <span className="field-row__label">{t('settings.iconFetch')}</span>
              <select
                className="input"
                value={settings.iconSource}
                onChange={(event) => patchSettings({ iconSource: event.target.value as 'auto' | 'off' })}
              >
                <option value="auto">{t('settings.iconsAuto')}</option>
                <option value="off">{t('settings.iconsOff')}</option>
              </select>
            </div>
            <div className="field-row">
              <span className="field-row__label">{t('settings.iconProvider')}</span>
              <select
                className="input"
                value={settings.iconProvider}
                disabled={settings.iconSource === 'off'}
                onChange={(event) => patchSettings({ iconProvider: event.target.value })}
              >
                {ICON_PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="field-row__hint">{t('settings.iconsHint')}</p>
          </section>

          <section>
            <div className="section__title">{t('settings.bars')}</div>
            {bars.length === 0 ? (
              <p className="section__note">{t('settings.noBars')}</p>
            ) : (
              bars.map((bar, index) => {
                const engine = engineOf(bar, settings)
                const name = engine ? engine.name : `${t('kind.search')} ${index + 1}`
                return (
                  <label className="field-row field-row--check" key={bar.id}>
                    <input
                      type="checkbox"
                      checked={!bar.hidden}
                      onChange={(event) => patchPlate(bar.id, { hidden: !event.target.checked })}
                    />
                    <span className="field-row__label">{name}</span>
                  </label>
                )
              })
            )}
            <p className="field-row__hint">{t('settings.barsHint')}</p>
          </section>

          <section>
            <div className="section__title">{t('settings.board')}</div>
            <p className="field-row__hint">{t('common.sampleHint')}</p>
            <div className="buttons" style={{ marginTop: 8 }}>
              <button type="button" className="button button--danger" onClick={restoreSamples}>
                {t('settings.reset')}
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}

function WallpaperUrlRow({ onAdd }: { onAdd(wallpaper: Wallpaper): void }) {
  const t = useT()
  const { settings } = useStore()
  const [value, setValue] = useState(settings.wallpaper.kind === 'url' ? settings.wallpaper.url : '')
  const apply = () => {
    const typed = value.trim()
    if (typed) onAdd({ kind: 'url', url: typed })
  }

  return (
    <div className="field-row">
      <input
        className="input input--wide"
        value={value}
        placeholder={t('wallpaper.url')}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            apply()
          }
        }}
      />
      <button type="button" className="button" disabled={!value.trim()} onClick={apply}>
        {t('wallpaper.apply')}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Popover shell                                                       */
/* ------------------------------------------------------------------ */

function Popover({
  anchor,
  onClose,
  children,
  minWidth = 220,
}: {
  anchor: { x: number; y: number }
  onClose(): void
  children: ReactNode
  minWidth?: number
}) {
  const ref = useDismiss<HTMLDivElement>(true, onClose)
  const left = Math.max(8, Math.min(anchor.x, globalThis.innerWidth - minWidth - 12))
  const top = Math.max(8, Math.min(anchor.y, globalThis.innerHeight - 80))

  // The popover's own height is not known until it renders, so it is not
  // guessed at: the room it has left is handed to it as a ceiling instead, and
  // anything longer scrolls. A menu that opens off the bottom of the window is
  // worse than a menu that scrolls.
  return (
    <div
      className="popover"
      ref={ref}
      role="menu"
      style={{ left, top, minWidth, maxHeight: Math.max(180, globalThis.innerHeight - top - 12) }}
    >
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Adding something                                                    */
/* ------------------------------------------------------------------ */

/**
 * The menu a right press on the board itself opens: the board's own few answers.
 *
 * A press that missed every tile is a press on the wallpaper, and what it can mean
 * is about the board rather than about anything on it: make a place for something,
 * put a different picture behind it, or start the board again. The wallpaper line is
 * only offered when there is a shelf to change through — a menu item that cannot do
 * anything is worse than one that is not there.
 *
 * Making a place is deliberately the first line and the quiet one: a board grows by
 * putting an empty tile down and then deciding what it is, and the deciding happens
 * on the tile itself, where the thing will be.
 */
export function WallMenu({
  anchor,
  count,
  onClose,
  onNewTile,
  onRandomWallpaper,
  onRefresh,
  onSettings,
}: {
  anchor: { x: number; y: number }
  /** How many wallpapers the user's own shelf holds, which is what a change needs. */
  count: number
  onClose(): void
  onNewTile(): void
  onRandomWallpaper(): void
  onRefresh(): void
  onSettings(): void
}) {
  const t = useT()
  const item = (label: string, run: () => void) => (
    <button
      type="button"
      className="menu-item"
      onClick={() => {
        run()
        onClose()
      }}
    >
      {label}
    </button>
  )
  return (
    <Popover anchor={anchor} onClose={onClose} minWidth={200}>
      {item(t('wall.newTile'), onNewTile)}
      {count > 1 ? item(t('wall.randomWallpaper'), onRandomWallpaper) : null}
      {item(t('wall.settings'), onSettings)}
      {item(t('wall.refresh'), onRefresh)}
    </Popover>
  )
}

export function AddPopover({
  anchor,
  onClose,
  onAdd,
  into,
}: {
  anchor: { x: number; y: number }
  onClose(): void
  onAdd(plate: AddDraft): void
  /**
   * Set when the menu was opened on a tile that is already there rather than on the
   * board: the draft is then what goes *into* that opening, and the heading says so
   * rather than offering to hang something new.
   */
  into?: boolean
}) {
  const t = useT()
  const locale = useLocale()
  const storeFile = useStoreFile()
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<AddMode>('link')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')

  const commitLink = () => {
    const trimmed = url.trim()
    if (!trimmed) return
    onAdd({ kind: 'link', shape: 'tile', w: 1, h: 1, url: addressOf(trimmed), title: title.trim() || undefined })
    onClose()
  }

  return (
    <Popover anchor={anchor} onClose={onClose} minWidth={280}>
      <div className="popover__head">
        <span className="popover__title">{into ? t('add.into') : t('add.title')}</span>
      </div>

      <div className="buttons" style={{ padding: '0 10px 9px' }}>
        {ADD_MODES.map((option) => (
          <button
            type="button"
            key={option}
            className={`button${mode === option ? ' button--primary' : ''}`}
            onClick={() => setMode(option)}
          >
            {t(ADD_MODE_LABEL[option])}
          </button>
        ))}
      </div>

      {mode === 'link' ? (
        <div style={{ display: 'grid', gap: 7, padding: '0 10px 8px' }}>
          <input
            className="input input--wide"
            value={url}
            autoFocus
            placeholder={t('add.urlLabel')}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitLink()
            }}
          />
          <input
            className="input input--wide"
            value={title}
            placeholder={t('add.titleLabel')}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitLink()
            }}
          />
          <button type="button" className="button button--primary" disabled={!url.trim()} onClick={commitLink}>
            {t('add.confirm')}
          </button>
        </div>
      ) : null}

      {mode === 'image' ? (
        <div style={{ display: 'grid', gap: 7, padding: '0 10px 8px' }}>
          <button type="button" className="button" onClick={() => fileRef.current?.click()}>
            {t('add.imageFromFile')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              const key = await storeFile(file, 'image')
              if (!key) return
              onAdd({ kind: 'image', shape: 'tile', w: 2, h: 2, imageKey: key, title: file.name })
              onClose()
            }}
          />
          <input
            className="input input--wide"
            value={url}
            placeholder={t('add.imageFromUrl')}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && url.trim()) {
                onAdd({ kind: 'image', shape: 'tile', w: 2, h: 2, imageUrl: url.trim() })
                onClose()
              }
            }}
          />
          <p className="field-row__hint" style={{ margin: 0 }}>
            {t('size.current', { w: 2, h: 2 })} · {t('plate.spanHint')}
          </p>
        </div>
      ) : null}

      {mode === 'widget' ? (
        <>
          {WIDGETS.map((type) => (
            <button
              type="button"
              key={type}
              className="menu-item"
              onClick={() => {
                // Each widget is hung at the size it is read at: a clock is a
                // square, a greeting is a line or two wide, and a list wants the
                // room it needs to show rows.
                const size =
                  type === 'clock' ? { w: 2, h: 2 } : type === 'text' ? { w: 4, h: 2 } : { w: 4, h: 3 }
                onAdd({
                  kind: 'widget',
                  shape: 'tile',
                  widget: type,
                  ...size,
                  ...(type === 'text' ? { text: freshText(locale), showName: false } : null),
                })
                onClose()
              }}
            >
              {t(WIDGET_LABEL[type])}
            </button>
          ))}
        </>
      ) : null}

      {mode === 'search' ? (
        <div style={{ padding: '0 10px 8px' }}>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              onAdd({ kind: 'search', shape: 'tile', w: 8, h: 1 })
              onClose()
            }}
          >
            {t('add.confirm')}
          </button>
          {/* More than one bar is allowed on purpose: each carries its own
              engine, so a page can offer two places to start from. */}
          <p className="popover__note">{t('add.searchNote')}</p>
        </div>
      ) : null}

      {mode === 'folder' ? (
        <div style={{ padding: '0 10px 8px' }}>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              // Two cells across holds four marks legibly, which is what a
              // folder draws; it is resized like anything else from there.
              onAdd({ kind: 'folder', shape: 'tile', w: 2, h: 2 })
              onClose()
            }}
          >
            {t('add.confirm')}
          </button>
          <p className="popover__note">{t('folder.note')}</p>
        </div>
      ) : null}
    </Popover>
  )
}

/* ------------------------------------------------------------------ */
/* One plate's own menu                                                */
/* ------------------------------------------------------------------ */

/**
 * The words on a text plate, and how they are set.
 *
 * It gets its own section rather than sharing the tile's, because none of it is
 * about the tile: the face, the size, the weight, the alignment and the colour
 * are the plate reading as intended rather than as the interface's default.
 *
 * Everything is edited into one local draft and written from that draft. The
 * plate this menu was opened on is a snapshot taken when it opened, so a write
 * composed from it would drop whatever the last write changed — which showed up
 * as a greeting keeping only the very last thing set on it.
 */
function TextSettings({ plate }: { plate: Plate }) {
  const t = useT()
  const { patchPlate } = useStore()
  const [draft, setDraft] = useState<TextSpec>(() => plate.text ?? { body: '' })
  const size = draft.size ?? 32
  const weight = draft.weight ?? 600
  const align = draft.align ?? 'left'
  const font = draft.font ?? 'ui'
  const tint = draft.tint ?? 'auto'

  const commit = (next: Partial<TextSpec>) => {
    const merged = { ...draft, ...next }
    setDraft(merged)
    patchPlate(plate.id, { text: merged })
  }

  return (
    <>
      <div className="menu-label">{t('text.body')}</div>
      <div style={{ display: 'flex', gap: 7, padding: '0 10px 4px', alignItems: 'flex-start' }}>
        <textarea
          className="input input--wide"
          rows={2}
          value={draft.body}
          placeholder={t('text.placeholder')}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
        />
        <button type="button" className="button" onClick={() => patchPlate(plate.id, { text: draft })}>
          {t('common.save')}
        </button>
      </div>

      <div className="menu-label">{t('text.font')}</div>
      <div className="buttons" style={{ padding: '0 10px 4px' }}>
        {TEXT_FONTS.map((id) => (
          <button
            type="button"
            key={id}
            className={`button${font === id ? ' button--primary' : ''}`}
            onClick={() => commit({ font: id })}
          >
            {t(`textFont.${id}` as 'textFont.ui')}
          </button>
        ))}
      </div>

      <div className="menu-label">{t('text.size')}</div>
      <label className="field-row">
        <input
          type="range"
          min={TEXT_MIN_SIZE}
          max={TEXT_MAX_SIZE}
          step={TEXT_SIZE_STEP}
          value={size}
          onChange={(event) => commit({ size: Number(event.target.value) })}
        />
        <span className="field-row__value">{size}px</span>
      </label>
      <p className="field-row__hint" style={{ margin: '0 10px 4px' }}>
        {t('text.sizeHint')}
      </p>

      <div className="menu-label">{t('text.weight')}</div>
      <div className="buttons" style={{ padding: '0 10px 4px' }}>
        {TEXT_WEIGHTS.map((value) => (
          <button
            type="button"
            key={value}
            className={`button${weight === value ? ' button--primary' : ''}`}
            onClick={() => commit({ weight: value })}
          >
            {t(`textWeight.${value}` as 'textWeight.600')}
          </button>
        ))}
      </div>

      <div className="menu-label">{t('text.align')}</div>
      <div className="buttons" style={{ padding: '0 10px 4px' }}>
        {TEXT_ALIGNS.map((value) => (
          <button
            type="button"
            key={value}
            className={`button${align === value ? ' button--primary' : ''}`}
            onClick={() => commit({ align: value })}
          >
            {t(`textAlign.${value}` as 'textAlign.left')}
          </button>
        ))}
      </div>

      <div className="menu-label">{t('text.tint')}</div>
      <div className="buttons" style={{ padding: '0 10px 4px', alignItems: 'center' }}>
        <button
          type="button"
          className={`button${tint === 'auto' ? ' button--primary' : ''}`}
          onClick={() => commit({ tint: 'auto' })}
        >
          {t('tint.auto')}
        </button>
        {TINTS.map((token) => (
          <button
            type="button"
            key={token}
            className={`swatch${tint === token ? ' swatch--on' : ''}`}
            style={{ background: TINT[token] }}
            aria-label={t(`tint.${token}` as 'tint.blue')}
            title={t(`tint.${token}` as 'tint.blue')}
            onClick={() => commit({ tint: token })}
          />
        ))}
      </div>
    </>
  )
}

export function PlateMenu({
  plate: opened,
  anchor,
  field,
  targets,
  onClose,
  onMove,
}: {
  plate: Plate
  anchor: { x: number; y: number }
  field: Field
  /** Everything a setting from this menu should reach: the plate alone, or the
   *  whole pick when the plate is part of one. */
  targets?: string[]
  onClose(): void
  onMove(plate: Plate): void
}) {
  const t = useT()
  const { board, patchPlates, removePlate, bays, settings } = useStore()
  const storeFile = useStoreFile()
  const fileRef = useRef<HTMLInputElement>(null)

  /**
   * The plate as it is now, not as it was when the menu opened.
   *
   * The menu is handed a copy, and a copy of a plate stops being true the
   * instant the first setting is written: the fill would change while the
   * highlight stayed where it was, and closing and reopening the menu was the
   * only way to see where things stood. Everything below draws from the store
   * instead, so a press and the highlight it moves happen in the same breath.
   */
  const plate = board.plates.find((candidate) => candidate.id === opened.id) ?? opened

  /**
   * Where a setting goes: one plate, or everything that is picked.
   *
   * With a selection standing, the menu speaks for all of it. Shape, size, fill,
   * corners, the picture that fills the tile — these are answers a set of icons
   * can share, and answering them one right-click at a time is how a board ends
   * up with eleven near-misses. The two that cannot be shared are the name —
   * one name for many things is not a name — and taking something down, which
   * would be a surprise of a different order. Those stay on one plate.
   */
  const reach = targets && targets.length > 1 ? targets : [plate.id]
  const patchPlate = (id: string, patch: Partial<Plate>) => {
    void id
    patchPlates(reach.map((target) => ({ id: target, ...patch })))
  }
  /** The name belongs to the plate the menu was opened on, and only to it. */
  const renamePlate = (title: string) => patchPlates([{ id: plate.id, title }])

  const [name, setName] = useState(plate.title ?? '')
  // The address this plate opens, which is a different field from the address of
  // its icon: a shortcut is a name and a place, and both of them go stale.
  const [web, setWeb] = useState(plate.url ?? '')
  /**
   * The address, asked again.
   *
   * A site moves, or a tile turns out to point at the wrong page, and without this
   * the only way to fix it is to take the tile down and hang a new one — losing the
   * place it was in, its size, its colour and everything else that had been set on
   * it. So the address is editable where every other answer about a tile is.
   *
   * The name is left alone, and so is an icon the user chose by hand: they edited
   * the address, not the face. A tile with no icon of its own goes on fetching one,
   * and fetches the new site's.
   */
  const commitWeb = () => {
    const typed = web.trim()
    if (!typed) return
    patchPlate(plate.id, { url: addressOf(typed) })
  }

  // The icon browser, opened from the menu below. Kept here rather than in a
  // popover of its own because it answers the question the menu is already
  // asking — which picture this plate draws — and the answer should land where
  // the question was asked.
  const [browsing, setBrowsing] = useState(false)
  // The address field answers whichever picture question the menu is showing — an
  // icon picked by hand, or a folder's cover — so there is one field and one piece
  // of state, and it opens on whichever address the plate already carries.
  const [address, setAddress] = useState(plate.coverUrl ?? plate.iconUrl ?? '')
  const [failed, setFailed] = useState<string[]>([])
  // A candidate that could not be fetched is dropped rather than drawn as a
  // broken frame: the services refuse different hosts, and half of what comes
  // back for a given site is a 404. Nothing is memoised against `plate.url`
  // alone, because the list is three strings long and building it is cheaper
  // than keeping it straight.
  const reachable = iconCandidates(plate.url, settings.iconProvider).filter(
    (src) => !failed.includes(src),
  )
  const commitAddress = () => {
    const next = address.trim()
    if (!next) return
    patchPlate(
      plate.id,
      plate.kind === 'folder' ? { coverUrl: next, coverKey: undefined } : { iconUrl: next, iconKey: undefined },
    )
  }

  const markSize = plate.iconSize ?? settings.iconSize
  // The name under the tile: its size and its ink, which a tile may answer for
  // itself. Most tiles take the board's answer, which is what every board had.
  const nameSize = plate.nameSize ?? settings.nameSize
  const markRadius = plate.radius ?? settings.tileRadius
  const markOffset = plate.markOffset ?? settings.markOffset
  // Stretch has no board-wide answer: how far a mark may bend is a property of
  // the one picture that is being bent, so absent means none.
  const markStretchX = plate.iconStretchX ?? 0
  const markStretchY = plate.iconStretchY ?? 0
  // The two sheets this tile may answer for itself, resolved the way the board
  // resolves them: the tile's own half where it named one, the board's otherwise.
  // `follow` in the menu is the absence of the whole half, so a tile that names
  // only a kind goes on following the board for the amount.
  const backgroundSheet = {
    kind: plate.backgroundMaterial?.kind ?? settings.backgroundMaterial.kind,
    strength: plate.backgroundMaterial?.strength ?? settings.backgroundMaterial.strength,
    transparency: plate.backgroundMaterial?.transparency ?? settings.backgroundMaterial.transparency,
  }
  const markSheet = {
    kind: plate.iconMaterial?.kind ?? settings.iconMaterial.kind,
    strength: plate.iconMaterial?.strength ?? settings.iconMaterial.strength,
    transparency: plate.iconMaterial?.transparency ?? settings.iconMaterial.transparency,
  }
  /*
   * The plate's second layer, which a folder answers with a sheet of its own.
   *
   * A folder is not a mark: what it shows is its contents, so the box those are
   * drawn in is the folder's surface, and the question belongs to `folderMaterial`
   * rather than to the icon layer. The menu asks whichever of the two the tile
   * actually has, so the row a person sees is the row that will do something.
   */
  const folderSheet = {
    kind: plate.folderMaterial?.kind ?? settings.folderMaterial.kind,
    strength: plate.folderMaterial?.strength ?? settings.folderMaterial.strength,
    transparency: plate.folderMaterial?.transparency ?? settings.folderMaterial.transparency,
  }
  const secondIsFolder = plate.kind === 'folder'
  const second = secondIsFolder ? folderSheet : markSheet
  const secondOwn = secondIsFolder ? plate.folderMaterial : plate.iconMaterial
  const setSecond = (next: PlateMaterial | undefined) =>
    patchPlate(plate.id, secondIsFolder ? { folderMaterial: next } : { iconMaterial: next })
  /** A tile that has answered for itself, so it can be handed back to the board. */
  const ownMarkDetail =
    plate.iconSize !== undefined ||
    plate.radius !== undefined ||
    plate.markOffset !== undefined ||
    plate.iconStretchX !== undefined ||
    plate.iconStretchY !== undefined

  const kindLabel = plate.kind === 'widget' ? t(WIDGET_LABEL[plate.widget ?? 'clock']) : t(KIND_LABEL[plate.kind])

  return (
    <Popover anchor={anchor} onClose={onClose} minWidth={244}>
      <div className="popover__head">
        <span className="popover__title">{plate.title?.trim() || kindLabel}</span>
        <span className="popover__kind">{kindLabel}</span>
      </div>

      {reach.length > 1 ? (
        <p className="popover__note">{t('plate.reachAll').replace('{n}', String(reach.length))}</p>
      ) : null}

      {plate.kind === 'widget' && plate.widget === 'text' ? <TextSettings plate={plate} /> : null}

      {/*
       * A picture tile that holds several pictures.
       *
       * The single picture it may also have is left where it is and not shown here:
       * this is the *set*, and a set with one thing in it is not a set — which is
       * also why the tiles that have never been given more than one look exactly as
       * they always did. Each entry is a file the user brought, listed by its name,
       * and the rule underneath turns them over.
       */}
      {plate.kind === 'image' ? (
        <>
          <div className="menu-label">{t('plate.pictures')}</div>
          {(plate.imageVariants ?? []).length ? (
            <div className="shelf">
              {(plate.imageVariants ?? []).map((variant, at) => (
                <span className="shelf__item" key={`${variant.key ?? variant.url}-${at}`}>
                  <span className="shelf__name">{labelOfPicture(variant)}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('common.remove')}
                    title={t('common.remove')}
                    onClick={() =>
                      patchPlate(plate.id, {
                        imageVariants: (plate.imageVariants ?? []).filter((_, index) => index !== at),
                      })
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="section__note">{t('plate.picturesEmpty')}</p>
          )}
          <div className="buttons" style={{ padding: '0 10px 6px' }}>
            <label className="button">
              {t('plate.picturesAdd')}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  const key = await storeFile(file, 'image')
                  if (!key) return
                  patchPlate(plate.id, {
                    imageVariants: [...(plate.imageVariants ?? []), { key, name: file.name }].slice(0, VARIANTS_MAX),
                  })
                }}
              />
            </label>
          </div>
          <RotationRows
            rotation={plate.rotation ?? ROTATION_OFF}
            count={(plate.imageVariants ?? []).length}
            labels={(plate.imageVariants ?? []).map(labelOfPicture)}
            onChange={(next) => patchPlate(plate.id, { rotation: next })}
          />
        </>
      ) : null}

      {/*
       * And a greeting that holds several paragraphs. The words are written here
       * rather than in the text settings above, because those are about *how* words
       * are set and these are about *which* words; the face, the size and the weight
       * are shared by every paragraph of one greeting, which is what makes it one
       * greeting rather than several.
       */}
      {plate.kind === 'widget' && plate.widget === 'text' ? (
        <>
          <div className="menu-label">{t('plate.paragraphs')}</div>
          {(plate.textVariants ?? []).length ? (
            (plate.textVariants ?? []).map((spec, at) => (
              <div className="field-row" key={at} style={{ alignItems: 'flex-start' }}>
                <textarea
                  className="input"
                  rows={2}
                  value={spec.body}
                  aria-label={t('plate.paragraphs')}
                  onChange={(event) =>
                    patchPlate(plate.id, {
                      textVariants: (plate.textVariants ?? []).map((one, index) =>
                        index === at ? { ...one, body: event.target.value } : one,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('common.remove')}
                  title={t('common.remove')}
                  onClick={() =>
                    patchPlate(plate.id, {
                      textVariants: (plate.textVariants ?? []).filter((_, index) => index !== at),
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))
          ) : (
            <p className="section__note">{t('plate.paragraphsEmpty')}</p>
          )}
          <div className="buttons" style={{ padding: '0 10px 6px' }}>
            <button
              type="button"
              className="button"
              onClick={() =>
                patchPlate(plate.id, {
                  textVariants: [...(plate.textVariants ?? []), freshText(settings.locale)].slice(0, VARIANTS_MAX),
                })
              }
            >
              {t('plate.paragraphsAdd')}
            </button>
          </div>
          <RotationRows
            rotation={plate.rotation ?? ROTATION_OFF}
            count={(plate.textVariants ?? []).length}
            labels={(plate.textVariants ?? []).map((spec) => spec.body.split('\n')[0].slice(0, 18) || '—')}
            onChange={(next) => patchPlate(plate.id, { rotation: next })}
          />
        </>
      ) : null}

      {/* A widget with a page behind it can stand on the board as its list or as
          one mark. Both are the same object; this only decides which of the two
          the tile shows, and the name underneath follows from it. */}
      {plate.kind === 'widget' && widgetView(plate.widget) ? (
        <>
          <div className="menu-label">{t('widget.style')}</div>
          <div className="buttons" style={{ padding: '0 10px 4px' }}>
            {WIDGET_STYLES.map((style) => (
              <button
                type="button"
                key={style}
                className={`button${(plate.widgetStyle ?? 'list') === style ? ' button--primary' : ''}`}
                onClick={() => patchPlate(plate.id, { widgetStyle: style })}
              >
                {t(`widget.${style}` as 'widget.list')}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {plate.kind !== 'search' ? (
        <>
          <div className="menu-label">{t('plate.shape')}</div>
          <div className="buttons" style={{ padding: '0 10px 4px' }}>
            {(['tile'] as const).map((shape) => (
              <button
                type="button"
                key={shape}
                className={`button${plate.shape === shape ? ' button--primary' : ''}`}
                onClick={() =>
                  patchPlate(plate.id, { shape })
                }
              >
                {t(`shape.${shape}` as 'shape.tile')}
              </button>
            ))}
          </div>

          <div className="menu-label">{t('size.title')}</div>
          <div className="span-grid">
              {DEFAULT_SPANS.map((span) => {
                const on = plate.w === span.w && plate.h === span.h
                return (
                  <button
                    type="button"
                    key={`${span.w}x${span.h}`}
                    className={`span-choice${on ? ' span-choice--on' : ''}`}
                    onClick={() => {
                      patchPlate(plate.id, { w: span.w, h: span.h })
                      onMove({ ...plate, w: span.w, h: span.h })
                    }}
                  >
                    <span
                      className="span-choice__chip"
                      style={{ width: 6 + span.w * 8, height: 6 + span.h * 8, borderRadius: 3 }}
                    />
                    <span className="span-choice__name">
                      {span.w}×{span.h}
                    </span>
                  </button>
                )
              })}
            </div>
        </>
      ) : null}

      {plate.kind !== 'search' ? (
        <>
          <div className="menu-label">{t('plate.nameLabel')}</div>
          <div style={{ display: 'flex', gap: 7, padding: '0 10px 4px' }}>
            <input
              className="input input--wide"
              value={name}
              placeholder={t('add.titleLabel')}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  renamePlate(name.trim())
                  onClose()
                }
              }}
            />
            <button
              type="button"
              className="button"
              onClick={() => {
                renamePlate(name.trim())
                onClose()
              }}
            >
              {t('common.save')}
            </button>
          </div>

          <label className="field-row field-row--check" style={{ marginTop: 6 }}>
            <input
              type="checkbox"
              checked={plate.showName ?? settings.showNames}
              onChange={(event) => patchPlate(plate.id, { showName: event.target.checked })}
            />
            <span className="field-row__label">{t('settings.showNames')}</span>
          </label>
          {/*
           * And what that name is set in, on this tile rather than on all of them.
           *
           * A name belongs to the tile it is under: the label beneath one clock wants
           * a different size, and often a different ink, from the row of words under a
           * grid of logos. Both are the tile's own answers, and both can be handed
           * back to the board — the size by double-clicking its slider, the ink by the
           * button beside the picker.
           */}
          <label className="field-row">
            <span className="field-row__label">{t('plate.nameSize')}</span>
            <input
              type="range"
              min={NAME_SIZE_MIN}
              max={NAME_SIZE_MAX}
              step={1}
              value={nameSize}
              onChange={(event) => patchPlate(plate.id, { nameSize: Number(event.target.value) })}
              onDoubleClick={() => patchPlate(plate.id, { nameSize: undefined })}
            />
            <span className="field-row__value">{nameSize}px</span>
          </label>
          <div className="field-row">
            <span className="field-row__label">{t('plate.nameColour')}</span>
            <div className="buttons">
              <input
                type="color"
                className="colour-input"
                aria-label={t('plate.nameColour')}
                value={plate.nameColour ?? '#ffffff'}
                onChange={(event) => patchPlate(plate.id, { nameColour: event.target.value })}
              />
              <button
                type="button"
                className={`button${plate.nameColour ? '' : ' button--primary'}`}
                onClick={() => patchPlate(plate.id, { nameColour: undefined })}
              >
                {t('plate.fillFollow')}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {/* Where the tile goes, for the tiles that go somewhere. A shortcut is the
          one kind of plate whose whole content is an address, so a shortcut that
          cannot be re-pointed is a shortcut that has to be thrown away when the
          site moves. */}
      {plate.kind === 'link' ? (
        <>
          <div className="menu-label">{t('plate.webAddress')}</div>
          <div style={{ display: 'flex', gap: 7, padding: '0 10px 4px' }}>
            <input
              className="input input--wide"
              value={web}
              placeholder={t('plate.webAddressHint')}
              aria-label={t('plate.webAddress')}
              onChange={(event) => setWeb(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                commitWeb()
              }}
            />
            <button type="button" className="button" disabled={!web.trim()} onClick={commitWeb}>
              {t('common.save')}
            </button>
          </div>
        </>
      ) : null}

      {/*
       * The tile's background layer, asked in the order a person answers it: what
       * colour, and then what that colour is made of.
       *
       * A *picture* is not asked: a photograph is the tile's whole surface, so a
       * colour behind it and a sheet under it are answers to a question the picture
       * does not raise — and the two rows only ever made a photograph that did not
       * fill its own tile. What a picture wears is asked further down, on the
       * material of the sheet over it.
       *
       * Both rows offer the board's own answer first — `follow` — because one tile
       * over a photograph should not cost the other fifteen their cards.
       */}
      {plate.kind !== 'image' ? (
        <>
          <div className="menu-label">{t('plate.fill')}</div>
          <div className="buttons" style={{ padding: '0 10px 4px' }}>
            {(['follow', 'auto', 'none', 'custom'] as const).map((kind) => {
              const on = kind === 'follow' ? plate.fill === undefined : plate.fill?.kind === kind
              return (
                <button
                  type="button"
                  key={kind}
                  className={`button${on ? ' button--primary' : ''}`}
                  onClick={() =>
                    patchPlate(plate.id, {
                      fill:
                        kind === 'follow'
                          ? undefined
                          : kind === 'custom'
                            ? { kind, colour: plate.fill?.colour ?? '#ffffff' }
                            : { kind },
                    })
                  }
                >
                  {kind === 'follow'
                    ? t('plate.fillFollow')
                    : kind === 'auto'
                      ? t('settings.tileGroundAuto')
                      : kind === 'none'
                        ? t('settings.tileGroundNone')
                        : t('plate.fillColour')}
                </button>
              )
            })}
          </div>
          {/* And the colour itself, which is only read when this tile answers with
              one. Shown whatever the answer is, so the picker does not move about. */}
          <div className="field-row" style={{ padding: '0 10px 4px' }}>
            <span className="field-row__label">{t('plate.fillColour')}</span>
            <div className="buttons">
              <input
                type="color"
                className="colour-input"
                aria-label={t('plate.fillColour')}
                value={plate.fill?.colour ?? '#ffffff'}
                onChange={(event) => patchPlate(plate.id, { fill: { kind: 'custom', colour: event.target.value } })}
              />
              <span className="field-row__value">
                {plate.fill?.kind === 'custom' ? plate.fill.colour : t('plate.fillColourFollow')}
              </span>
            </div>
          </div>
          <div className="swatches" style={{ padding: '0 10px 6px' }}>
            {TILE_COLOURS.map((colour) => (
              <button
                type="button"
                key={colour}
                className={`swatch${plate.fill?.kind === 'custom' && plate.fill.colour === colour ? ' swatch--on' : ''}`}
                style={{ background: colour }}
                aria-label={colour}
                title={colour}
                onClick={() => patchPlate(plate.id, { fill: { kind: 'custom', colour } })}
              />
            ))}
          </div>

          {/* What that colour is made of. The four kinds and the board's own answer,
              the same set the drawer offers, because the question is the same one —
              and the same four, because "nothing" is the colour's answer above rather
              than a second one here. */}
          <div className="menu-label">{t('settings.backgroundMaterial')}</div>
          <div className="buttons" style={{ padding: '0 10px 4px' }}>
            {(['follow', ...BACKGROUND_MATERIAL_KINDS] as const).map((kind) => {
              const on =
                kind === 'follow' ? plate.backgroundMaterial === undefined : plate.backgroundMaterial?.kind === kind
              return (
                <button
                  type="button"
                  key={`background-${kind}`}
                  className={`button${on ? ' button--primary' : ''}`}
                  onClick={() =>
                    patchPlate(plate.id, {
                      backgroundMaterial: kind === 'follow' ? undefined : { ...plate.backgroundMaterial, kind },
                    })
                  }
                >
                  {kind === 'follow' ? t('plate.fillFollow') : t(`material.${kind}` as 'material.solid')}
                </button>
              )
            })}
          </div>
          {/* How much of it there is on this tile, and how far it can be seen
              through: in a row of glass, one tile is allowed to be the thick one.
              Absent means the board's own, which is what clearing it returns the tile
              to — hence the double click, as on every other slider here. Only a sheet
              has amounts to set, so a layer made of nothing offers neither. */}
          {backgroundSheet.kind !== 'none' ? (
            <>
              <label className="field-row" style={{ padding: '0 10px 4px' }}>
                <span className="field-row__label">{t('settings.materialStrength')}</span>
                <input
                  type="range"
                  min={0}
                  max={MATERIAL_STRENGTH_MAX}
                  step={2}
                  value={Math.round(backgroundSheet.strength)}
                  onChange={(event) =>
                    patchPlate(plate.id, {
                      backgroundMaterial: { ...plate.backgroundMaterial, strength: Number(event.target.value) },
                    })
                  }
                  onDoubleClick={() =>
                    patchPlate(plate.id, { backgroundMaterial: repairOwn(plate.backgroundMaterial, 'strength') })
                  }
                />
                <span className="field-row__value">{Math.round(backgroundSheet.strength)}%</span>
              </label>
              <label className="field-row" style={{ padding: '0 10px 4px' }}>
                <span className="field-row__label">{t('settings.materialTransparency')}</span>
                <input
                  type="range"
                  min={0}
                  max={MATERIAL_TRANSPARENCY_MAX}
                  step={2}
                  value={Math.round(backgroundSheet.transparency)}
                  onChange={(event) =>
                    patchPlate(plate.id, {
                      backgroundMaterial: { ...plate.backgroundMaterial, transparency: Number(event.target.value) },
                    })
                  }
                  onDoubleClick={() =>
                    patchPlate(plate.id, { backgroundMaterial: repairOwn(plate.backgroundMaterial, 'transparency') })
                  }
                />
                <span className="field-row__value">{Math.round(backgroundSheet.transparency)}%</span>
              </label>
            </>
          ) : null}
        </>
      ) : null}

      {/* And the tile's own corner. It is the tile's answer rather than the
          mark's — a rounded card with a square logo standing on it is exactly
          what rounding a tile means — and it is a share of the tile's own box,
          so the top of the range is the tile's own shape: a square one becomes a
          circle, a wide one an ellipse. */}
      {plate.kind !== 'search' ? (
        <label className="field-row" style={{ padding: '0 10px 4px' }}>
          <span className="field-row__label">{t('settings.tileRadius')}</span>
          <input
            type="range"
            min={0}
            max={RADIUS_MAX}
            step={1}
            value={markRadius}
            onChange={(event) => patchPlate(plate.id, { radius: Number(event.target.value) })}
            onDoubleClick={() => patchPlate(plate.id, { radius: undefined })}
          />
          <span className="field-row__value">{markRadius}%</span>
        </label>
      ) : null}

      {plate.kind !== 'search' ? (
        <>
          {/* And the plate's second sheet, which is a different question on a
              different surface: a tile can keep its card with the logo on it
              standing on glass, or the other way round. A folder asks it about its
              own surface rather than about an icon, which is why the heading moves
              and the answer is stored apart. Answered as a partial object, exactly
              as the background layer is, so a plate that names only a kind goes on
              following the board for the amount. */}
          <div className="menu-label">
            {secondIsFolder ? t('settings.folderMaterial') : t('settings.iconMaterial')}
          </div>
          <div className="buttons" style={{ padding: '0 10px 4px' }}>
            {(['follow', ...MATERIAL_KINDS] as const).map((kind) => {
              const on = kind === 'follow' ? secondOwn === undefined : secondOwn?.kind === kind
              return (
                <button
                  type="button"
                  key={kind}
                  className={`button${on ? ' button--primary' : ''}`}
                  onClick={() => setSecond(kind === 'follow' ? undefined : { ...secondOwn, kind })}
                >
                  {kind === 'follow' ? t('plate.fillFollow') : t(`material.${kind}` as 'material.solid')}
                </button>
              )
            })}
          </div>
          {/* How much of the sheet there is, and how far it can be seen through,
              on this plate rather than on all of them. Absent means the board's own
              strength, which is what clearing it returns the plate to — hence the
              double click, as on every other slider here. Only a sheet has amounts
              to set, so a layer made of nothing does not offer the controls. */}
          {second.kind !== 'none' ? (
            <>
              <label className="field-row" style={{ padding: '0 10px 4px' }}>
                <span className="field-row__label">{t('plate.markStrength')}</span>
                <input
                  type="range"
                  min={0}
                  max={MATERIAL_STRENGTH_MAX}
                  step={2}
                  value={Math.round(second.strength)}
                  onChange={(event) => setSecond({ ...secondOwn, strength: Number(event.target.value) })}
                  onDoubleClick={() => setSecond(repairOwn(secondOwn, 'strength'))}
                />
                <span className="field-row__value">{Math.round(second.strength)}%</span>
              </label>
              <label className="field-row" style={{ padding: '0 10px 4px' }}>
                <span className="field-row__label">{t('plate.markTransparency')}</span>
                <input
                  type="range"
                  min={0}
                  max={MATERIAL_TRANSPARENCY_MAX}
                  step={2}
                  value={Math.round(second.transparency)}
                  onChange={(event) => setSecond({ ...secondOwn, transparency: Number(event.target.value) })}
                  onDoubleClick={() => setSecond(repairOwn(secondOwn, 'transparency'))}
                />
                <span className="field-row__value">{Math.round(second.transparency)}%</span>
              </label>
            </>
          ) : null}

          {/* The mark, on this tile rather than on all of them: how big it is,
              where it stands on the tile, and how far it is pulled out of its own
              shape. Each is a separate answer, and each can be handed back to the
              board by double-clicking the slider.
              A *link* offers them and a picture does not: what a picture shows is a
              photograph rather than a mark standing on a card, so its size, its
              place and its stretch are not questions about it — the picture is the
              tile. */}
          {plate.kind === 'link' ? (
            <>
              <div className="menu-label">{t('settings.mark')}</div>
              <label className="field-row">
                <span className="field-row__label">{t('settings.iconSize')}</span>
                <input
                  type="range"
                  min={ICON_SIZE_MIN * 100}
                  max={ICON_SIZE_MAX * 100}
                  step={2}
                  value={Math.round(markSize * 100)}
                  onChange={(event) => patchPlate(plate.id, { iconSize: Number(event.target.value) / 100 })}
                  onDoubleClick={() => patchPlate(plate.id, { iconSize: undefined })}
                />
                <span className="field-row__value">{Math.round(markSize * 100)}%</span>
              </label>
              {/* Where the mark stands on its tile. Two axes, because a mark is
                  placed rather than nudged along one line, and both are read as a
                  share of the mark's own size — so a mark made larger carries the
                  same place with it instead of drifting off the tile. */}
              <label className="field-row">
                <span className="field-row__label">{t('settings.markOffsetX')}</span>
                <input
                  type="range"
                  min={-MARK_OFFSET_MAX}
                  max={MARK_OFFSET_MAX}
                  step={MARK_OFFSET_STEP}
                  value={markOffset.x}
                  onChange={(event) =>
                    patchPlate(plate.id, { markOffset: { ...markOffset, x: Number(event.target.value) } })
                  }
                  onDoubleClick={() => patchPlate(plate.id, { markOffset: undefined })}
                />
                <span className="field-row__value">{markOffset.x}%</span>
                <button type="button" className="icon-button" title={t('common.reset')} aria-label={t('common.reset')} onClick={() => patchPlate(plate.id, { markOffset: { ...markOffset, x: 0 } })}>↺</button>
              </label>
              <label className="field-row">
                <span className="field-row__label">{t('settings.markOffsetY')}</span>
                <input
                  type="range"
                  min={-MARK_OFFSET_MAX}
                  max={MARK_OFFSET_MAX}
                  step={MARK_OFFSET_STEP}
                  value={markOffset.y}
                  onChange={(event) =>
                    patchPlate(plate.id, { markOffset: { ...markOffset, y: Number(event.target.value) } })
                  }
                  onDoubleClick={() => patchPlate(plate.id, { markOffset: undefined })}
                />
                <span className="field-row__value">{markOffset.y}%</span>
                <button type="button" className="icon-button" title={t('common.reset')} aria-label={t('common.reset')} onClick={() => patchPlate(plate.id, { markOffset: { ...markOffset, y: 0 } })}>↺</button>
              </label>
              {ownMarkDetail ? (
                <button
                  type="button"
                  className="menu-item"
                  onClick={() =>
                    patchPlate(plate.id, {
                      iconSize: undefined,
                      radius: undefined,
                      markOffset: undefined,
                      iconStretchX: undefined,
                      iconStretchY: undefined,
                    })
                  }
                >
                  {t('settings.markReset')}
                </button>
              ) : null}

              {/* A tile whose picture and background are the same thing: no card
                  behind it, no inset, the picture filling the opening to its own
                  rounded corners. */}
              <label className="field-row field-row--check">
                <input
                  type="checkbox"
                  checked={Boolean(plate.bleed)}
                  onChange={(event) => patchPlate(plate.id, { bleed: event.target.checked })}
                />
                <span className="field-row__label">{t('plate.seamless')}</span>
              </label>
              {/* How far the mark is pulled out of its own shape, one axis at a
                  time. Asked of every mark and not only of a filled one: two
                  factors are written by every plate and the stylesheet reads them
                  wherever a mark is drawn, so a logo on a wide tile can be pulled
                  wide without being blown up to fill it. */}
              <label className="field-row">
                <span className="field-row__label">{t('settings.iconStretchX')}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={markStretchX}
                  onChange={(event) => patchPlate(plate.id, { iconStretchX: Number(event.target.value) })}
                  onDoubleClick={() => patchPlate(plate.id, { iconStretchX: undefined })}
                />
                <span className="field-row__value">{markStretchX}%</span>
              </label>
              <label className="field-row">
                <span className="field-row__label">{t('settings.iconStretchY')}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={markStretchY}
                  onChange={(event) => patchPlate(plate.id, { iconStretchY: Number(event.target.value) })}
                  onDoubleClick={() => patchPlate(plate.id, { iconStretchY: undefined })}
                />
                <span className="field-row__value">{markStretchY}%</span>
              </label>
              {/* The tops of both sliders are past the mark's own edge on purpose:
                  a mark wider than its pane is cropped by the pane it stands on,
                  which is a look worth being able to ask for. */}
              <p className="section__note">{t('settings.iconStretchHint')}</p>
            </>
          ) : null}
        </>
      ) : null}

      {plate.kind === 'search' ? (
        <>
          <div className="menu-label">{t('size.title')}</div>
          <div className="span-grid">
            {SEARCH_WIDTHS.map((w) => {
              const on = plate.w === w
              return (
                <button
                  type="button"
                  key={w}
                  className={`span-choice${on ? ' span-choice--on' : ''}`}
                  onClick={() => {
                    patchPlate(plate.id, { w })
                    onMove({ ...plate, w })
                  }}
                >
                  <span
                    className="span-choice__chip"
                    style={{ width: 4 + w * 6, height: 6 + Math.round(plate.h * 8) }}
                  />
                  <span className="span-choice__name">{w}×</span>
                </button>
              )
            })}
          </div>

          {/* Advance by five hundredths of a row, and print what that comes to
              in pixels, because "1.45 rows" says nothing about how tall the bar
              will be while "110px" says all of it. */}
          <label className="field-row">
            <span className="field-row__label">{t('size.height')}</span>
            <input
              type="range"
              min={SEARCH_MIN_H}
              max={SEARCH_MAX_H}
              step={SEARCH_H_STEP}
              value={plate.h}
              onChange={(event) => {
                const h = roundTo(Number(event.target.value), SEARCH_H_STEP)
                patchPlate(plate.id, { h })
                onMove({ ...plate, h })
              }}
            />
            <span className="field-row__value">{t('size.heightValue').replace('{h}', plate.h.toFixed(2)).replace('{px}', String(Math.round(barHeight(field, plate.h))))}</span>
          </label>
          <p className="section__note">{t('size.heightHint')}</p>

          {/* What the field sits in is the bar's own material, so it is asked
              once, above, with every other tile's: a clear bar over a photograph
              and a frosted one are two of the same list. What is left here is
              the other ground — the field inside the bar. */}
          <div className="menu-label">{t('search.fieldFill')}</div>
          <div className="field-row">
            <div className="buttons">
              {(['auto', 'none', 'custom'] as const).map((kind) => (
                <button
                  type="button"
                  key={kind}
                  className={`button${(plate.fieldFill?.kind ?? 'auto') === kind ? ' button--primary' : ''}`}
                  onClick={() =>
                    patchPlate(plate.id, {
                      fieldFill:
                        kind === 'auto'
                          ? undefined
                          : { kind, ...(kind === 'custom' ? { colour: plate.fieldFill?.colour ?? '#ffffff' } : null) },
                    })
                  }
                >
                  {t(`fieldFill.${kind}` as 'fieldFill.auto')}
                </button>
              ))}
            </div>
          </div>
          {plate.fieldFill?.kind === 'custom' ? (
            <label className="field-row">
              <span className="field-row__label">{t('settings.tileColour')}</span>
              <input
                type="color"
                className="colour-input"
                value={plate.fieldFill.colour ?? '#ffffff'}
                onChange={(event) =>
                  patchPlate(plate.id, { fieldFill: { kind: 'custom', colour: event.target.value } })
                }
              />
              <span className="field-row__value">{plate.fieldFill.colour ?? '#ffffff'}</span>
            </label>
          ) : null}
          <p className="section__note">{t('search.dragHint')}</p>

          <button
            type="button"
            className="menu-item"
            onClick={() => {
              patchPlate(plate.id, { hidden: true })
              onClose()
            }}
          >
            {t('search.hide')}
          </button>
        </>
      ) : null}

      {plate.folderId ? (
        <button
          type="button"
          className="menu-item"
          onClick={() => {
            patchPlate(plate.id, { folderId: undefined })
            onClose()
          }}
        >
          {t('folder.unfile')}
        </button>
      ) : null}

      {plate.kind === 'link' || plate.kind === 'image' ? (
        <>
          <button type="button" className="menu-item" onClick={() => fileRef.current?.click()}>
            {plate.kind === 'link' ? t('plate.pickIcon') : t('add.imageFromFile')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              const key = await storeFile(file, plate.kind === 'link' ? 'icon' : 'image')
              if (!key) return
              patchPlate(plate.id, plate.kind === 'link' ? { iconKey: key } : { imageKey: key, imageUrl: undefined })
              onClose()
            }}
          />
        </>
      ) : null}

      {/*
       * What a folder wears.
       *
       * A cover is a picture of the thing the folder is *for* — a book jacket, a
       * project's mark — and it comes from the machine or from an address, which
       * are the same two places a plate's picture comes from and for the same
       * reason: one of them is here for good, and the other is a picture on
       * somebody else's server. What the folder does with it is the drawing's
       * business (see `FolderBody`): a folder with a cover shows the cover, and
       * one without shows the marks of what is inside.
       */}
      {plate.kind === 'folder' ? (
        <>
          <button type="button" className="menu-item" onClick={() => fileRef.current?.click()}>
            {t('folder.coverFromFile')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              const key = await storeFile(file, 'cover')
              if (!key) return
              patchPlate(plate.id, { coverKey: key, coverUrl: undefined })
              onClose()
            }}
          />
          <label className="field-row field-row--stack">
            <span className="field-row__label">{t('folder.coverAddress')}</span>
            <input
              type="text"
              className="input"
              value={address}
              placeholder={t('plate.iconAddressHint')}
              onChange={(event) => setAddress(event.target.value)}
              onBlur={commitAddress}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                commitAddress()
              }}
            />
          </label>
          {plate.coverKey || plate.coverUrl ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                setAddress('')
                patchPlate(plate.id, { coverKey: undefined, coverUrl: undefined })
              }}
            >
              {t('folder.coverClear')}
            </button>
          ) : null}
        </>
      ) : null}

      {/*
       * What the board could reach for this site, laid out to be looked at.
       *
       * A fetched icon is chosen by asking one service and taking what comes
       * back, which is the right answer for a board that has to answer by
       * itself and the wrong one for a person: the services disagree about which
       * sites they answer for and what size they answer with, so the only way to
       * pick the good one is to see them side by side. Pasting an address is the
       * same question answered by hand, and it is the same answer — a plate
       * holds one address it was given, and having been given one it stops
       * asking services by itself.
       */}
      {plate.kind === 'link' ? (
        <>
          <button
            type="button"
            className="menu-item"
            onClick={() => setBrowsing((open) => !open)}
            aria-expanded={browsing}
          >
            {t('plate.browseIcons')}
          </button>
          {browsing ? (
            <div className="icon-bay">
              {reachable.length ? (
                <div className="icon-bay__grid">
                  {reachable.map((src) => {
                    const on = plate.iconUrl === src
                    return (
                      <button
                        type="button"
                        key={src}
                        className={`icon-bay__cell${on ? ' icon-bay__cell--on' : ''}`}
                        title={src}
                        aria-label={src}
                        aria-pressed={on}
                        onClick={() => {
                          patchPlate(plate.id, { iconUrl: src, iconKey: undefined })
                          setAddress(src)
                        }}
                      >
                        <img
                          src={src}
                          alt=""
                          loading="lazy"
                          onError={() => setFailed((list) => [...list, src])}
                        />
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="section__note">{t('plate.iconsNone')}</p>
              )}
              <label className="field-row field-row--stack">
                <span className="field-row__label">{t('plate.iconAddress')}</span>
                <input
                  type="text"
                  className="input"
                  value={address}
                  placeholder={t('plate.iconAddressHint')}
                  onChange={(event) => setAddress(event.target.value)}
                  onBlur={commitAddress}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    commitAddress()
                  }}
                />
              </label>
              {plate.iconUrl || plate.iconKey ? (
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setAddress('')
                    patchPlate(plate.id, { iconUrl: undefined, iconKey: undefined })
                  }}
                >
                  {t('plate.iconClear')}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      <div className="menu-label">{t('plate.bay')}</div>
      <div className="buttons" style={{ padding: '0 10px 6px', flexWrap: 'wrap' }}>
        {bays.map((page, index) => (
          <button
            type="button"
            key={page.id}
            className={`button${page.id === plate.pageId ? ' button--primary' : ''}`}
            onClick={() => {
              patchPlate(plate.id, { pageId: page.id })
              onClose()
            }}
          >
            {index + 1}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="menu-item menu-item--danger"
        onClick={() => {
          removePlate(plate.id)
          onClose()
        }}
      >
        {t('plate.remove')}
      </button>
    </Popover>
  )
}

/* ------------------------------------------------------------------ */
/* Folders                                                             */
/* ------------------------------------------------------------------ */

/**
 * What a folder holds, spread open.
 *
 * The board shows a folder as a few marks; this is the folder itself. It opens
 * as a sheet across the middle of the wall rather than a menu beside the tile,
 * because a folder is a place you look into: the board stays visible behind it,
 * stepped back, and what is inside is shown the way the folder shows it — its
 * marks, with their names under them, which is how you recognise a thing you
 * put there by its picture. Each one opens on its own, can be taken back out,
 * and "open all" sits in the corner a page's own button would.
 */
export function FolderPanel({
  plate,
  contents,
  onClose,
  onOpen,
  onOpenAll,
  onUnfile,
}: {
  plate: Plate
  contents: Plate[]
  onClose(): void
  onOpen(item: Plate): void
  onOpenAll(): void
  onUnfile(id: string): void
}) {
  const t = useT()
  const { settings } = useStore()

  /** What a folder's item is called, from its name or from where it points. */
  const nameOf = (item: Plate): string =>
    item.title?.trim() || (item.url ? hostOf(item.url) || item.url : '') || t('common.untitled')

  const title = plate.title?.trim() || t('folder.title')

  return (
    <div className="folder-sheet" role="dialog" aria-label={title}>
      <div className="folder-sheet__veil" onClick={onClose} />

      <div className="folder-sheet__body">
        <div className="folder-sheet__head">
          <span className="folder-sheet__title">{title}</span>
          <span className="folder-sheet__count">{t('folder.count').replace('{n}', String(contents.length))}</span>
          <button type="button" className="folder-sheet__close" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
            ✕
          </button>
        </div>

        {contents.length === 0 ? (
          <p className="folder-sheet__empty">{t('folder.empty')}</p>
        ) : (
          <ul className="folder-sheet__grid">
            {contents.map((item) => (
              <li key={item.id} className="folder-item">
                <button
                  type="button"
                  className="folder-item__open"
                  onClick={() => onOpen(item)}
                  title={item.url ?? nameOf(item)}
                >
                  <span className="folder-item__mark">
                    <FolderMark plate={item} settings={settings} />
                  </span>
                  <span className="folder-item__name">{nameOf(item)}</span>
                </button>
                <button
                  type="button"
                  className="folder-item__drop"
                  aria-label={t('folder.unfile')}
                  title={t('folder.unfile')}
                  onClick={() => onUnfile(item.id)}
                >
                  ↩
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="folder-sheet__foot">
          <button type="button" className="button button--primary" disabled={contents.length === 0} onClick={onOpenAll}>
            {t('folder.openAll')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

const TINTS: TintToken[] = ['blue', 'green', 'amber', 'rose', 'violet', 'slate']

const TINT: Record<TintToken, string> = {
  slate: '#7c848f',
  blue: '#3b82f6',
  green: '#22a06b',
  amber: '#d98a1f',
  rose: '#e5484d',
  violet: '#8b5cf6',
}

const CONTENTS: Array<{ value: Exclude<ViewName, 'board'> | 'board'; label: string }> = [
  { value: 'board', label: 'page.contentBoard' },
  { value: 'bookmarks', label: 'nav.bookmarks' },
  { value: 'history', label: 'nav.history' },
]

/**
 * A page's own settings: what it is called, what colour it is tagged, whether
 * it holds shortcuts or gives the whole page to one view, and whether it
 * exists at all.
 */
export function PageMenu({
  page,
  anchor,
  onClose,
  onPatch,
  onRemove,
  canRemove,
}: {
  page: BoardPage | undefined
  anchor: { x: number; y: number }
  onClose(): void
  onPatch(patch: Partial<BoardPage>): void
  onRemove(): void
  canRemove: boolean
}) {
  const t = useT()
  const [name, setName] = useState(page?.name ?? '')

  if (!page) return null

  return (
    <Popover anchor={anchor} onClose={onClose} minWidth={248}>
      <div className="popover__head">
        <span className="popover__title">{page.name?.trim() || t('page.untitled')}</span>
      </div>

      <div className="menu-label">{t('page.nameField')}</div>
      <div style={{ display: 'flex', gap: 7, padding: '0 10px 4px' }}>
        <input
          className="input input--wide"
          value={name}
          placeholder={t('page.nameHint')}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onPatch({ name: name.trim() })
              onClose()
            }
          }}
        />
        <button
          type="button"
          className="button"
          onClick={() => {
            onPatch({ name: name.trim() })
            onClose()
          }}
        >
          {t('common.save')}
        </button>
      </div>

      <div className="menu-label">{t('page.tint')}</div>
      <div className="swatches" style={{ padding: '0 10px 4px' }}>
        {TINTS.map((tint) => (
          <button
            type="button"
            key={tint}
            className={`swatch${page.tint === tint ? ' swatch--on' : ''}`}
            style={{ background: TINT[tint] }}
            aria-label={t(`tint.${tint}` as 'tint.blue')}
            title={t(`tint.${tint}` as 'tint.blue')}
            onClick={() => onPatch({ tint })}
          />
        ))}
      </div>

      <div className="menu-label">{t('page.content')}</div>
      <div className="buttons" style={{ padding: '0 10px 6px', flexWrap: 'wrap' }}>
        {CONTENTS.map((entry) => (
          <button
            type="button"
            key={entry.value}
            className={`button${(page.view ?? 'board') === entry.value ? ' button--primary' : ''}`}
            onClick={() => {
              onPatch({ view: entry.value === 'board' ? undefined : entry.value })
              onClose()
            }}
          >
            {t(entry.label as 'nav.bookmarks')}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="menu-item menu-item--danger"
        disabled={!canRemove}
        onClick={() => {
          onRemove()
          onClose()
        }}
      >
        {t('page.remove')}
      </button>
    </Popover>
  )
}
