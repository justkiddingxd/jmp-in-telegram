import { BotCommands } from 'puregram'
import { accounts } from './db.ts'
import { pool } from './xmpp/pool.ts'
import { tg } from './bot/tg.ts'
import './bot/panel.ts'
import { startReminders } from './bot/reminders.ts'

// поднимаем подключения всех уже созданных джабберов — чтобы SMS шли сразу
const all = accounts.all()
await Promise.allSettled(all.map(a => pool.connect(a)))
console.log(`[xmpp] аккаунтов: ${all.length}`)

await tg.api.setMyCommands({
  commands: [
    BotCommands.command('start', 'Панель номеров'),
    BotCommands.command('cancel', 'Отменить текущий шаг')
  ],
  suppress: true
})

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
