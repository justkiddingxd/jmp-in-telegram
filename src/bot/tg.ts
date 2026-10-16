import { Telegram } from 'puregram'
import { markup } from '@puregram/markup'
import { config } from '../config.ts'

export const tg = new Telegram({
  token: config.botToken,
  autoAnswerCallbackQuery: true,
  retryOnFloodWait: { max: 3, maxWaitMs: 30_000 }
}).extend(markup())

tg.catch((error, ctx) => {
  console.error(`[bot] ошибка в обработчике (update ${ctx.raw.update_id}):`, error)
})
