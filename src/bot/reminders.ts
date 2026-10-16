import { InlineKeyboard, Telegram } from 'puregram'
import { accounts, reminders } from '../db.ts'
import { refreshJmpInfo } from '../jmp/info.ts'
import { reminderDue } from '../jmp/renewal.ts'
import { pool } from '../xmpp/pool.ts'
import { tg } from './tg.ts'
import { reminderScreen } from './ui.ts'

// раз в час смотрим дату продления и баланс каждого номера и пишем, если скоро продление, а денег не хватает
const CHECK_EVERY = 60 * 60_000
const FIRST_CHECK = 2 * 60_000

let running = false

export async function checkReminders(now = new Date()): Promise<void> {
  if (running) return
  running = true
  try {
    for (const account of accounts.all()) {
      if (account.status !== 'active' || !account.reminders) continue
      const xmpp = pool.get(account.id)
      if (!xmpp) continue

      const info = await refreshJmpInfo(xmpp).catch(() => null)
      const due = info ? reminderDue(info, now) : null
      if (!info || !due || reminders.wasSent(account.id, due.expiresAt, due.threshold)) continue

      // владельцу и всем с общим доступом. сеть/телега прилегли — попробуем в следующий раз
      // (тогда напоминание может прийти кому-то повторно); заблокировавшему бота повторять незачем
      let failed = false
      for (const recipient of accounts.recipients(account)) {
        const screen = reminderScreen(recipient, account, info, due)
        const sent = await tg.api.sendMessage({
          chat_id: recipient,
          text: screen.text,
          reply_markup: InlineKeyboard.keyboard(screen.keyboard),
          link_preview_options: { is_disabled: true },
          suppress: true
        })
        if (Telegram.isErrorResponse(sent) && sent.error_code !== 403) failed = true
      }
      if (failed) continue
      reminders.markSent(account.id, due.expiresAt, due.threshold)
      console.log(`[remind] ${account.jid}: продление через ${due.days} дн., не хватает ${due.shortfall ?? '?'}`)
    }
  } catch (error) {
    console.error('[remind] ошибка проверки', error)
  } finally {
    running = false
  }
}

export function startReminders() {
  // первая проверка — когда подключения уже поднялись
  setTimeout(() => void checkReminders(), FIRST_CHECK)
  setInterval(() => void checkReminders(), CHECK_EVERY)
}
