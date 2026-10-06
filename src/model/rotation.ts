/**
 * Which of a set is showing now.
 *
 * A rotation keeps no state of its own. What it holds is a rule, and the answer to
 * "which one" is worked out from the clock every time it is asked — so a board
 * reloaded at eleven o'clock shows what it would have shown at eleven o'clock, and
 * a wallpaper that changes every half hour changes on the half hour rather than
 * half an hour after somebody opened the tab.
 *
 * That is also why nothing here has to be saved or ticked in the background: a
 * timer only has to say when the answer *may* have changed, and the answer itself
 * is a pure function of the time.
 */

import { ROTATION_EVERY_MAX, ROTATION_EVERY_MIN, type Rotation } from './types'

/** Minutes since midnight, local. */
function minutesOfDay(now: number): number {
  const at = new Date(now)
  return at.getHours() * 60 + at.getMinutes()
}

/** `HH:MM` as minutes, or null when it is not a time. */
export function minutesAt(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * Which of `count` is in force at `now`.
 *
 * Nought whenever there is nothing to take turns between, when no rule was given,
 * and when the rule is off — the first one is the one a set shows until it is told
 * otherwise.
 */
export function turnOf(rotation: Rotation | undefined, count: number, now: number): number {
  if (!rotation || count <= 1 || rotation.mode === 'off') return 0
  if (rotation.mode === 'interval') {
    const every = Math.min(ROTATION_EVERY_MAX, Math.max(ROTATION_EVERY_MIN, Math.round(rotation.every) || 60))
    const passed = minutesOfDay(now)
    return Math.floor(passed / every) % count
  }
  // The last moment that has already passed, and before the first one of the day
  // the last one of them — the evening's answer is still the answer at two in the
  // morning, which is what makes a list of moments cover the whole day.
  const moments = rotation.at
    .map((moment) => ({ at: minutesAt(moment.time), index: moment.index }))
    .filter((moment): moment is { at: number; index: number } => moment.at !== null)
    .sort((one, two) => one.at - two.at)
  if (!moments.length) return 0
  const now_ = minutesOfDay(now)
  let chosen = moments[moments.length - 1].index
  for (const moment of moments) {
    if (moment.at <= now_) chosen = moment.index
  }
  return Math.min(count - 1, Math.max(0, chosen))
}

/**
 * How long until the answer may change, in ms.
 *
 * The tick is what a timer waits for: an interval waits for its own next step, and
 * a list of moments waits for the next one on the clock. A rotation that is off
 * waits for nothing.
 */
export function nextTurnIn(rotation: Rotation | undefined, now: number): number | null {
  if (!rotation || rotation.mode === 'off') return null
  if (rotation.mode === 'interval') {
    const every = Math.min(ROTATION_EVERY_MAX, Math.max(ROTATION_EVERY_MIN, Math.round(rotation.every) || 60))
    const passed = minutesOfDay(now)
    return (every - (passed % every)) * 60_000 - (now % 60_000)
  }
  const next = rotation.at
    .map((moment) => minutesAt(moment.time))
    .filter((at): at is number => at !== null)
    .map((at) => at - minutesOfDay(now))
    .filter((wait) => wait > 0)
    .sort((one, two) => one - two)[0]
  // Nothing left today: the first moment of tomorrow, which is a day away minus
  // however much of today is left.
  const wait = next ?? 24 * 60 - minutesOfDay(now)
  return wait * 60_000 - (now % 60_000)
}
