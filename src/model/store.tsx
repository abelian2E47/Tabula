/**
 * The board's single source of truth.
 *
 * Everything the interface mutates goes through here, and everything written
 * here is persisted to `storage.local` shortly afterwards. Reads on mount are
 * merged over the defaults, so a save written by an older version still opens
 * instead of failing.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { surface } from '../platform/browser'
import { defaultSettings, sampleBoard } from './defaults'
import { readSaved, SCHEMA, STATE_KEY, type SavedState } from './persist'
import { type Board, type BoardPage, type Plate, type Settings } from './types'

interface Store {
  ready: boolean
  board: Board
  settings: Settings
  bays: BoardPage[]
  /** The bay currently on screen. Session state: a new tab opens on the first. */
  bayId: string
  bayIndex: number
  goToBay(id: string): void
  addBay(): void
  removeBay(id: string): void
  patchBay(id: string, patch: Partial<BoardPage>): void
  patchSettings(patch: Partial<Settings>): void
  addPlate(plate: Omit<Plate, 'id'> & { id?: string }): string | null
  patchPlate(id: string, patch: Partial<Plate>): void
  /** Several plates at once, for relocating whatever a resize displaced. */
  patchPlates(updates: Array<{ id: string } & Partial<Plate>>): void
  /** Gather plates into a folder that did not exist before. */
  groupPlates(ids: string[]): void
  removePlate(id: string): void
  restoreSamples(): void
  resetEverything(): void
}

const StoreContext = createContext<Store | null>(null)

/** A plate id that will not collide with one already on the board. */
function newPlateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [board, setBoard] = useState<Board>(() => sampleBoard())
  const [settings, setSettings] = useState<Settings>(() => defaultSettings())
  const [bayId, setBayId] = useState<string>('')

  // The first load wins: later renders must not clobber what is on disk.
  const loaded = useRef(false)
  const writeTimer = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const all = await surface.storage.get()
        if (cancelled) return
        const saved = readSaved(all[STATE_KEY])
        const nextBoard = saved?.board ?? sampleBoard()
        const nextSettings = saved?.settings ?? defaultSettings()
        setBoard(nextBoard)
        setSettings(nextSettings)
        setBayId(nextBoard.pages[0]?.id ?? '')
        loaded.current = true
      } catch (error) {
        // A failed read opens the sample board and says so, rather than
        // leaving the page blank with nothing to explain it. `loaded` stays
        // false so the writer below cannot overwrite a save we could not read.
        console.error('[tabula] could not read the saved board', error)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // One debounced writer for the whole document: dragging produces a burst of
  // moves and each one must not become its own round trip to disk.
  useEffect(() => {
    if (!loaded.current) return
    if (writeTimer.current !== null) globalThis.clearTimeout(writeTimer.current)
    writeTimer.current = globalThis.setTimeout(() => {
      void surface.storage.set({ [STATE_KEY]: { schema: SCHEMA, board, settings } satisfies SavedState })
    }, 220)
    return () => {
      if (writeTimer.current !== null) globalThis.clearTimeout(writeTimer.current)
    }
  }, [board, settings])

  const bayIndex = Math.max(0, board.pages.findIndex((page) => page.id === bayId))

  const goToBay = useCallback((id: string) => setBayId(id), [])

  const addBay = useCallback(() => {
    setBoard((current) => {
      const id = `bay-${Date.now().toString(36)}`
      const tints: BoardPage['tint'][] = ['blue', 'green', 'amber', 'rose', 'violet', 'slate']
      const page: BoardPage = { id, tint: tints[current.pages.length % tints.length] }
      const next = { ...current, pages: [...current.pages, page] }
      setBayId(id)
      return next
    })
  }, [])

  const removeBay = useCallback(
    (id: string) => {
      setBoard((current) => {
        if (current.pages.length <= 1) return current
        const pages = current.pages.filter((page) => page.id !== id)
        const plates = current.plates.filter((plate) => plate.pageId !== id)
        setBayId((openId) => (openId === id ? pages[0].id : openId))
        return { ...current, pages, plates }
      })
    },
    [],
  )

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }))
  }, [])

  const patchBay = useCallback((id: string, patch: Partial<BoardPage>) => {
    setBoard((current) => ({
      ...current,
      pages: current.pages.map((bay) => (bay.id === id ? { ...bay, ...patch } : bay)),
    }))
  }, [])

  const addPlate = useCallback<Store['addPlate']>((plate) => {
    let createdId: string | null = null
    setBoard((current) => {
      const id = plate.id ?? newPlateId('plate')
      createdId = id
      return { ...current, plates: [...current.plates, { ...plate, id } as Plate] }
    })
    return createdId
  }, [])

  const patchPlate = useCallback((id: string, patch: Partial<Plate>) => {
    setBoard((current) => ({
      ...current,
      plates: current.plates.map((plate) => (plate.id === id ? { ...plate, ...patch } : plate)),
    }))
  }, [])

  const patchPlates = useCallback((updates: Array<{ id: string } & Partial<Plate>>) => {
    if (updates.length === 0) return
    const byId = new Map(updates.map((update) => [update.id, update]))
    setBoard((current) => ({
      ...current,
      plates: current.plates.map((plate) => {
        const update = byId.get(plate.id)
        return update ? { ...plate, ...update } : plate
      }),
    }))
  }, [])

  const groupPlates = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    setBoard((current) => {
      const picked = current.plates.filter((plate) => ids.includes(plate.id))
      if (picked.length === 0) return current
      // The folder opens where the first thing it gathers was, and takes that
      // plate's place. Grouping should not scatter what it gathers, and the
      // gathering is the only thing on the board that knows where they were.
      const anchor = picked[0]
      const folder: Plate = {
        id: newPlateId('folder'),
        pageId: anchor.pageId,
        kind: 'folder',
        shape: 'tile',
        x: anchor.x,
        y: anchor.y,
        // Two cells across holds four marks legibly. If the 2x2 box does not
        // fit where the anchor was, the board's own relocation pass finds it an
        // opening, which is better than a folder built too small to read.
        w: 2,
        h: 2,
      }
      return {
        ...current,
        plates: [folder, ...current.plates.map((plate) => (ids.includes(plate.id) ? { ...plate, folderId: folder.id } : plate))],
      }
    })
  }, [])

  const removePlate = useCallback((id: string) => {
    setBoard((current) => ({
      ...current,
      plates: current.plates
        .filter((plate) => plate.id !== id)
        // What a folder held goes back on the grid where it already sits,
        // rather than staying filed under a folder that no longer exists.
        .map((plate) => (plate.folderId === id ? { ...plate, folderId: undefined } : plate)),
    }))
  }, [])

  const restoreSamples = useCallback(() => {
    const fresh = sampleBoard()
    setBoard(fresh)
    setBayId(fresh.pages[0].id)
  }, [])

  const resetEverything = useCallback(() => {
    const fresh = sampleBoard()
    setBoard(fresh)
    setSettings(defaultSettings())
    setBayId(fresh.pages[0].id)
  }, [])

  const value = useMemo<Store>(
    () => ({
      ready,
      board,
      settings,
      bays: board.pages,
      bayId: board.pages[bayIndex]?.id ?? board.pages[0]?.id ?? '',
      bayIndex,
      goToBay,
      addBay,
      removeBay,
      patchBay,
      patchSettings,
      addPlate,
      patchPlate,
      patchPlates,
      groupPlates,
      removePlate,
      restoreSamples,
      resetEverything,
    }),
    [
      ready,
      board,
      settings,
      bayIndex,
      goToBay,
      addBay,
      removeBay,
      patchBay,
      patchSettings,
      addPlate,
      patchPlate,
      patchPlates,
      groupPlates,
      removePlate,
      restoreSamples,
      resetEverything,
    ],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside StoreProvider')
  return store
}

/** Plates of one bay, in a stable order. */
export function platesOnBay(board: Board, bayId: string): Plate[] {
  return board.plates.filter((plate) => plate.pageId === bayId)
}
