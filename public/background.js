// Tabula — background event page (MV3, Firefox / Zen).
//
// Deliberately dependency-free and un-bundled: Firefox MV3 runs this as an
// event page via background.scripts, and a plain file with no imports avoids
// both a second build step and a code-split chunk that could not be
// interpreted as a classic script.
//
// The only job here is the standalone entry point: the toolbar button opens
// the same board as an ordinary tab, for people who want it beside their work
// instead of replacing every new tab.

const api = globalThis.browser ?? globalThis.chrome

const BOARD_URL = api.runtime.getURL('index.html')

api.action.onClicked.addListener(() => {
  api.tabs.create({ url: BOARD_URL })
})
