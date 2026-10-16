import type { AccountInfo } from 'jmp-chat'

// напоминания о продлении номера: за сколько дней до даты продления писать
export const REMINDER_DAYS = [7, 3, 2, 1] as const

/** сколько календарных дней (UTC) до даты YYYY-MM-DD */
export function daysUntil(date: string, now = new Date()): number {
  const [y, m, d] = date.split('-').map(Number)
  const end = Date.UTC(y!, m! - 1, d!)
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((end - today) / 86_400_000)
}

export interface ReminderDue {
  /** дней до продления */
  days: number
  /** порог из REMINDER_DAYS, под которым это напоминание запоминаем */
  threshold: number
  expiresAt: string
  /** сколько не хватает на продление; null — цена продления неизвестна */
  shortfall: number | null
}

/**
 * пора ли напомнить о продлении. null — рано/поздно, номер неактивен или на балансе хватает денег.
 * порог — ближайший сверху: бот лежал на 3-й день, а сейчас 2 — напомним за 2, а не промолчим
 */
export function reminderDue(info: AccountInfo, now = new Date()): ReminderDue | null {
  if (!info.active || !info.expiresAt) return null
  const days = daysUntil(info.expiresAt, now)
  if (days < 1 || days > REMINDER_DAYS[0]) return null

  const shortfall = info.renewal ? info.renewal.amount - (info.balance?.amount ?? 0) : null
  // денег хватает — JMP продлит сам
  if (shortfall !== null && shortfall <= 0) return null

  const threshold = Math.min(...REMINDER_DAYS.filter(t => t >= days))
  return { days, threshold, expiresAt: info.expiresAt, shortfall }
}
