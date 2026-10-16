import { config } from '../config.ts'
import { users } from '../db.ts'
import { en } from './en.ts'
import { ru, type Messages } from './ru.ts'

// язык интерфейса: по умолчанию — из языка телеги (русский для ru, остальным английский),
// но человек может выбрать его сам кнопкой или /lang — тогда автоопределение его не трогает.
// храним в базе, чтобы уведомления о SMS и напоминания шли на том же языке

export type Lang = 'ru' | 'en'
export type { Messages }

const dictionaries: Record<Lang, Messages> = { ru, en }
const cache = new Map<number, { lang: Lang, manual: boolean }>()

export function langFromTelegram(code: string | undefined): Lang {
  return code?.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

function stored(userId: number): { lang: Lang, manual: boolean } | undefined {
  const cached = cache.get(userId)
  if (cached) return cached
  const row = users.get(userId)
  if (!row) return undefined
  const entry = { lang: row.lang === 'ru' ? 'ru' as const : 'en' as const, manual: row.manual }
  cache.set(userId, entry)
  return entry
}

/** язык из update телеги; пишем в базу, только когда он поменялся и человек не выбирал язык сам */
export function rememberLang(userId: number, code: string | undefined) {
  if (!code) return
  const current = stored(userId)
  if (current?.manual) return
  const lang = langFromTelegram(code)
  if (current?.lang === lang) return
  cache.set(userId, { lang, manual: false })
  users.setLang(userId, lang)
}

/** язык, выбранный человеком вручную */
export function chooseLang(userId: number, lang: Lang) {
  cache.set(userId, { lang, manual: true })
  users.setLang(userId, lang, true)
}

export function langOf(userId: number): Lang {
  return stored(userId)?.lang ?? config.defaultLang
}

export function otherLang(lang: Lang): Lang {
  return lang === 'ru' ? 'en' : 'ru'
}

/** тексты для юзера (по id) или для языка */
export function t(who: number | Lang): Messages {
  return dictionaries[typeof who === 'number' ? langOf(who) : who]
}
