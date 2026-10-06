import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { dicts, type DictKey } from './dict'
import type { Locale } from '../model/types'

const LocaleContext = createContext<Locale>('zh')

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}

export function useLocale(): Locale {
  return useContext(LocaleContext)
}

/**
 * `t('keys.multiActive', { n: 3 })` substitutes `{n}`. Missing keys fall back
 * to the key itself, which makes a gap loud in the interface instead of silent.
 */
export function useT(): (key: DictKey, vars?: Record<string, string | number>) => string {
  const locale = useLocale()
  return useMemo(() => {
    const table = dicts[locale] ?? dicts.zh
    return (key, vars) => {
      const raw = table[key] ?? key
      if (!vars) return raw
      return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match,
      )
    }
  }, [locale])
}
