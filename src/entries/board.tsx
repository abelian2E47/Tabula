/**
 * The new tab page.
 *
 * The store and the language are separate providers because the language is
 * itself stored: the copy cannot be resolved until the saved settings have
 * been read back.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Board } from '../board/Board'
import { LocaleProvider } from '../i18n'
import { StoreProvider, useStore } from '../model/store'
import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/board.css'
// A page can be given over to the bookmarks or history view, so the board needs
// the view's own stylesheet too.
import '../styles/collection.css'

function LocalisedBoard() {
  const { settings } = useStore()
  return (
    <LocaleProvider locale={settings.locale}>
      <Board />
    </LocaleProvider>
  )
}

const host = document.getElementById('root')
if (!host) throw new Error('the new tab page has no #root to mount into')

createRoot(host).render(
  <StrictMode>
    <StoreProvider>
      <LocalisedBoard />
    </StoreProvider>
  </StrictMode>,
)
