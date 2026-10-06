/**
 * Site icons.
 *
 * Firefox has no `_favicon/` equivalent to Chromium's, so an automatic icon
 * means an external service — which is exactly why the setting that turns it
 * off exists, and why the provider is a setting rather than a constant. When
 * it is off, or when a plate has a locally stored icon, nothing is fetched.
 *
 * A plate with no icon at all falls back to a stencilled initial. That is not
 * a failure state: on a shadow board the label is painted, not attached.
 */

import type { Plate, Settings } from '../model/types'
import { hostOf } from './data'

export interface IconProvider {
  id: string
  label: string
  /** `%h` is the bare host. */
  template: string
}

/**
 * Where icons are asked for, best first.
 *
 * These are not interchangeable. Measured against the same six hosts, one
 * answers with a 512px picture and another with the 32px file the site happens
 * to ship — and a 32px file drawn across a wide tile is exactly what "this icon
 * looks soft" means. So the list is ordered by what comes back, not by
 * geography, and the first entry is the default.
 *
 * Every one of them can also refuse a host outright, which is why a mark is
 * allowed a second address rather than falling straight to a letter.
 */
export const ICON_PROVIDERS: IconProvider[] = [
  { id: 'faviconim', label: 'favicon.im', template: 'https://favicon.im/%h?larger=true' },
  { id: 'cccyun', label: 'favicon.cccyun.cc', template: 'https://favicon.cccyun.cc/%h' },
  { id: 'google', label: 'Google s2', template: 'https://www.google.com/s2/favicons?domain=%h&sz=128' },
  { id: 'duckduckgo', label: 'DuckDuckGo', template: 'https://icons.duckduckgo.com/ip3/%h.ico' },
]

/**
 * How many services a single mark may ask.
 *
 * Two: one refusal is worth answering somewhere else, but a mark that has to
 * ask four places to be told nothing is worse than the letter it ends up with.
 */
const ICON_TRIES = 2

export function providerById(id: string): IconProvider {
  return ICON_PROVIDERS.find((provider) => provider.id === id) ?? ICON_PROVIDERS[0]
}

export function siteIconUrl(url: string, providerId: string): string | null {
  const host = hostOf(url)
  if (!host || host === url) return null
  return providerById(providerId).template.replace('%h', encodeURIComponent(host))
}

/**
 * What a link plate should draw, best address first.
 *
 * Three answers in an order that is the user's rather than the board's. `stored`
 * is a file of theirs on this machine and wins outright — there is nowhere else
 * to look for it. `chosen` is an address they picked out of what the board could
 * reach, or pasted, and it is asked next: having answered the question once, a
 * plate does not go back to asking a service on its own. Only then does the board
 * fetch, and with fetching switched off it fetches nothing at all.
 */
export function linkIconSources(
  url: string | undefined,
  settings: Settings,
  stored?: string | null,
  chosen?: string | null,
): string[] {
  if (stored) return [stored]
  if (chosen) return [chosen]
  if (!url || settings.iconSource === 'off') return []
  const host = hostOf(url)
  if (!host || host === url) return []
  const picked = providerById(settings.iconProvider)
  const rest = ICON_PROVIDERS.filter((provider) => provider.id !== picked.id)
  return [picked, ...rest]
    .slice(0, ICON_TRIES)
    .map((provider) => provider.template.replace('%h', encodeURIComponent(host)))
}

/**
 * Everything the board can reach for one host, for the picker.
 *
 * The list is longer than the one a mark walks on its own, because the two are
 * different questions. A mark has to answer in one request and gives up after
 * two; a person browsing is willing to wait for six pictures and can throw away
 * the ones that do not arrive — which is the whole reason a list is worth showing
 * at all, since the services disagree about which sites they answer for and what
 * size they answer with.
 *
 * Every provider is asked, then the two files a site keeps beside itself, and the
 * first entry is the one a plain mark would have drawn, so the picker opens on
 * the answer the board had already given.
 */
export function iconCandidates(url: string | undefined, providerId: string): string[] {
  const host = hostOf(url ?? '')
  if (!host || host === url) return []
  const trimmed = host.replace(/^www\./, '')
  const list = [
    ...ICON_PROVIDERS.map((provider) => provider.template.replace('%h', encodeURIComponent(host))),
    `https://${host}/apple-touch-icon.png`,
    `https://${host}/favicon.ico`,
    `https://${trimmed}/favicon.ico`,
  ]
  // The chosen service moves to the front, so the grid opens on the one the
  // board would have used.
  const picked = providerById(providerId)
  const preferred = picked.template.replace('%h', encodeURIComponent(host))
  return [...new Set([preferred, ...list])].filter(Boolean)
}

/** First meaningful character, for the stencilled fallback. */
export function initialOf(plate: Plate): string {
  const source = plate.title?.trim() || (plate.url ? hostOf(plate.url) : '')
  const match = source.match(/[\p{L}\p{N}]/u)
  return (match?.[0] ?? '?').toUpperCase()
}
