import { config } from '../config.ts'
import { users } from '../db.ts'
import { en } from './en.ts'
import { ru, type Messages } from './ru.ts'

// язык интерфейса: русский для тех, у кого телега на русском, остальным — английский.
// запоминаем в базе, чтобы уведомления о SMS и напоминания шли на том же языке

export type Lang = 'ru' | 'en'
export type { Messages }

const dictionaries: Record<Lang, Messages> = { ru, en }
const cache = new Map<number, Lang>()

export function langFromTelegram(code: string | undefined): Lang {
  return code?.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

/** язык из update телеги; пишем в базу, только когда он поменялся */
export function rememberLang(userId: number, code: string | undefined) {
  if (!code) return
  const lang = langFromTelegram(code)
  if (langOf(userId) === lang && cache.has(userId)) return
  cache.set(userId, lang)
  users.setLang(userId, lang)
}

export function langOf(userId: number): Lang {
  const cached = cache.get(userId)
  if (cached) return cached
  const stored = users.lang(userId)
  const lang: Lang = stored === 'ru' || stored === 'en' ? stored : config.defaultLang
  if (stored) cache.set(userId, lang)
  return lang
}

/** тексты для юзера (по id) или для языка */
export function t(who: number | Lang): Messages {
  return dictionaries[typeof who === 'number' ? langOf(who) : who]
}
