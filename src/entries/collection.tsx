/**
 * The standalone views' mount point.
 *
 * Bookmarks and history are the same page reading a different source, so they
 * are one bundle with the source named by the document rather than two entries
 * that would drift apart.
 */

import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Collection } from '../collection/Collection'
import { LocaleProvider } from '../i18n'
import { useLoadedSettings } from '../lib/hooks'
import type { ViewName } from '../model/types'
import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/collection.css'

type Source = Exclude<ViewName, 'board'>

function isSource(value: string | undefined): value is Source {
  return value === 'bookmarks' || value === 'history'
}

function LocalisedCollection({ source }: { source: Source }) {
  const settings = useLoadedSettings()

  // The board writes this attribute from its own effect; here nothing else
  // would, and the page is styled entirely from it.
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  return (
    <LocaleProvider locale={settings.locale}>
      <Collection source={source} />
    </LocaleProvider>
  )
}

const host = document.getElementById('root')
if (!host) throw new Error('a standalone view has no #root to mount into')

const source = host.dataset.view
if (!isSource(source)) throw new Error('a standalone view must name its source in data-view')

createRoot(host).render(
  <StrictMode>
    <LocalisedCollection source={source} />
  </StrictMode>,
)
