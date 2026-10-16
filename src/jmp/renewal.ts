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

/** YYYY-MM-DD + n месяцев (UTC); 31 января + 1 → 28/29 февраля */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const first = new Date(Date.UTC(y!, m! - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d!, last))
  return first.toISOString().slice(0, 10)
}

const cents = (x: number) => Math.ceil(x * 100 - 1e-6) / 100

export interface Coverage {
  /** цена продления за месяц */
  price: number
  /** сколько продлений оплатит текущий баланс */
  renewals: number
  /** номер оплачен до этой даты (YYYY-MM-DD): дата продления + оплаченные месяцы */
  paidUntil: string
  /** сколько не хватает на следующее продление (в дату paidUntil) */
  shortfall: number
}

/**
 * калькулятор продления: JMP в дату продления списывает тариф, пока баланса хватает.
 * null — номер не активен или не знаем цену / баланс / дату
 */
export function coverage(info: AccountInfo): Coverage | null {
  if (!info.active || !info.expiresAt || !info.renewal || !info.balance || info.renewal.amount <= 0) return null
  const price = info.renewal.amount
  const balance = Math.max(0, info.balance.amount)
  const renewals = Math.floor(balance / price + 1e-9)
  return {
    price,
    renewals,
    paidUntil: addMonths(info.expiresAt, renewals),
    shortfall: cents(price * (renewals + 1) - balance)
  }
}

/** сколько пополнить, чтобы оплатить ещё `extra` продлений, и до какой даты это хватит */
export function topUpFor(c: Coverage, extra: number): { amount: number, until: string } {
  return { amount: cents(c.shortfall + c.price * (extra - 1)), until: addMonths(c.paidUntil, extra) }
}
