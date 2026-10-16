import { BotCommands } from 'puregram'
import { accounts } from './db.ts'
import { t } from './i18n/index.ts'
import { pool } from './xmpp/pool.ts'
import { tg } from './bot/tg.ts'
import './bot/panel.ts'
import { startReminders } from './bot/reminders.ts'

// поднимаем подключения всех уже созданных джабберов — чтобы SMS шли сразу
const all = accounts.all()
await Promise.allSettled(all.map(a => pool.connect(a)))
console.log(`[xmpp] аккаунтов: ${all.length}`)

// команды в меню телеги: английские по умолчанию, русские — тем, у кого телега на русском
for (const [lang, languageCode] of [['en', undefined], ['ru', 'ru']] as const) {
  const tx = t(lang).commands
  await tg.api.setMyCommands({
    commands: [BotCommands.command('start', tx.start), BotCommands.command('lang', tx.lang), BotCommands.command('cancel', tx.cancel)],
    ...(languageCode ? { language_code: languageCode } : {}),
    suppress: true
  })
}

await tg.startPolling({ allowedUpdates: ['message', 'callback_query'] })
console.log(`[bot] @${tg.bot.username} запущен`)

startReminders()

async function shutdown() {
  tg.stopPolling()
  await pool.stopAll()
  await tg.shutdown()
  process.exit(0)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
