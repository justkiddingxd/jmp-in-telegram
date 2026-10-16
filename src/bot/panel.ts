import { InlineKeyboard, type CallbackQueryUpdate } from 'puregram'
import { bold, format, type Formatted } from '@puregram/markup'
import { formatPhone, jidToPhone, phoneToJid as gatewayJid } from 'jmp-chat'
import { config } from '../config.ts'
import { accounts, messages, type Account } from '../db.ts'
import { importAccount, parseUserJid } from '../jmp/import.ts'
import { cachedJmpInfo, isJmpInfoFresh, refreshJmpInfo } from '../jmp/info.ts'
import { registerWithJmp, RegistrationError } from '../jmp/register.ts'
import { CRYPTO, cryptoAddress, isCrypto, topUpOptions, topUpWithSavedCard } from '../jmp/topup.ts'
import { registerAccount } from '../xmpp/ejabberd.ts'
import { pool } from '../xmpp/pool.ts'
import { cancelPrompt, createPrompter, handlePromptText, hasPrompt, PromptCancelled } from './prompt.ts'
import { icon, withIcon } from './icons.ts'
import { tg } from './tg.ts'
import {
  accountTitle,
  canAddNumber,
  canImport,
  Cb,
  errorScreen,
  historyScreen,
  homeScreen,
  jabberScreen,
  numberScreen,
  peerTitle,
  progressScreen,
  referralScreen,
  render,
  singleNumber,
  smsNotification,
  topUpResultScreen,
  topUpScreen,
  unlinkScreen,
  type Panel
} from './ui.ts'

/** что ввёл человек → jid получателя SMS на шлюзе */
function phoneToJid(input: string): string | null {
  return gatewayJid(input, config.jmpJid)
}

// ---------- доступ ----------

tg.use(async (update, next) => {
  if (config.allowedUsers.size === 0) return next()
  const userId = 'senderId' in update ? update.senderId : undefined
  if (userId !== undefined && (config.allowedUsers.has(userId) || config.adminIds.has(userId))) return next()
  if (update.is('message')) await update.send(format`${icon('forbidden')} Бот закрытый`)
})

// ---------- панели ----------

// последняя панель юзера — на /start старую удаляем, чтобы в чате была одна живая
const panels = new Map<number, Panel>()

async function freshPanel(userId: number, chatId: number): Promise<Panel> {
  const old = panels.get(userId)
  if (old?.messageId) await tg.api.deleteMessage({ chat_id: old.chatId, message_id: old.messageId, suppress: true })
  const panel: Panel = { chatId, messageId: 0 }
  panels.set(userId, panel)
  return panel
}

function panelOf(query: CallbackQueryUpdate): Panel {
  const panel: Panel = { chatId: query.message?.chat.id ?? query.senderId, messageId: query.message?.message_id ?? 0 }
  panels.set(query.senderId, panel)
  return panel
}

function ownAccount(userId: number, id: number): Account | undefined {
  const account = accounts.get(id)
  return account?.tg_id === userId ? account : undefined
}

/** статус из JMP (активен / продление) — с кэшем; не дождались — рисуем без него */
async function jmpInfo(account: Account, force = false) {
  const xmpp = pool.get(account.id)
  if (!xmpp || account.status !== 'active') return undefined
  if (!force && isJmpInfoFresh(account.id)) return cachedJmpInfo(account.id)

  const timeout = new Promise<undefined>(resolve => setTimeout(resolve, force ? 15_000 : 4_000))
  const fresh = refreshJmpInfo(xmpp).catch(() => undefined)
  return await Promise.race([fresh, timeout]) ?? cachedJmpInfo(account.id)
}

async function showHome(userId: number, panel: Panel, notice?: Formatted) {
  const single = singleNumber(userId)
  if (single) return render(panel, numberScreen(single, await jmpInfo(single), notice))
  return render(panel, homeScreen(userId, undefined, notice))
}

async function showNumber(panel: Panel, account: Account, opts: { force?: boolean, notice?: Formatted } = {}) {
  return render(panel, numberScreen(account, await jmpInfo(account, opts.force), opts.notice))
}

// ---------- регистрация номера ----------

// юзер в долгом флоу (регистрация / отправка) — второй параллельно не запускаем
const busy = new Set<number>()

async function startRegistration(userId: number, panel: Panel) {
  if (busy.has(userId)) return
  busy.add(userId)

  const retry = withIcon(Cb.newNumber.button({ text: 'Попробовать ещё раз' }), 'refresh')
  try {
    // недооформленный аккаунт переиспользуем: JMP помнит выбранный на нём номер
    let account = accounts.ofUser(userId).find(a => a.status === 'pending')
    await render(panel, progressScreen('Подключаюсь к JMP…'))
    if (!account) {
      const credentials = await registerAccount(userId)
      account = accounts.create(userId, credentials.jid, credentials.password)
    }

    const xmpp = await pool.connect(account)
    const result = await registerWithJmp(xmpp, createPrompter(userId, panel))

    accounts.activate(account.id, result.phone, result.location)
    console.log(`[reg] ${account.jid} → ${result.phone}`)

    await showNumber(panel, accounts.get(account.id)!, {
      force: true,
      notice: format`${icon('party')} ${bold('Номер готов!')} Все SMS на него будут приходить в этот чат.`
    })
  } catch (error) {
    if (error instanceof PromptCancelled) {
      await showHome(userId, panel, error.message === 'отменено'
        ? format`${icon('cancel')} Отменено`
        : format`${icon('wait')} Регистрация на паузе: ${error.message}`)
    } else if (error instanceof RegistrationError) {
      await render(panel, errorScreen(error.message, retry))
    } else {
      console.error('[reg] ошибка регистрации', error)
      await render(panel, errorScreen('JMP не ответил или что-то сломалось. Попробуй ещё раз через минуту.', retry))
      await notifyAdmins(`регистрация ${userId}: ${(error as Error).message}`)
    }
  } finally {
    busy.delete(userId)
  }
}

async function notifyAdmins(text: string) {
  for (const id of config.adminIds) {
    await tg.api.sendMessage({ chat_id: id, text: format`${icon('warning')} ${text}`, suppress: true })
  }
}

// ---------- отправка SMS ----------

async function sendSms(account: Account, toJid: string, body: string) {
  const xmpp = pool.get(account.id)
  if (!xmpp) throw new Error('номер ещё не подключён')
  await xmpp.jmp.sendSms(toJid, body)
  messages.add(account.id, 'out', jidToPhone(toJid)!, body)
}

async function writeFlow(userId: number, panel: Panel, account: Account, presetPeer?: string) {
  if (busy.has(userId)) return
  busy.add(userId)

  const prompter = createPrompter(userId, panel)
  const title = format`${icon('write')} ${bold('Новое SMS')} · с ${accountTitle(account)}`
  try {
    let toJid = presetPeer ? phoneToJid(presetPeer) : null
    let hint: Formatted | '' = ''
    while (!toJid) {
      const to = await prompter.askSimple({
        title,
        text: format`${hint}Кому? Пришли номер сообщением:\n\n• +15551234567 или 5551234567\n• короткий номер, например 22000`
      })
      toJid = to.kind === 'text' ? phoneToJid(to.text) : null
      hint = format`${icon('warning')} Не похоже на номер, попробуй ещё раз.\n\n`
    }

    const peer = jidToPhone(toJid)!
    const body = await prompter.askSimple({
      title,
      text: format`Кому: ${bold(peerTitle(peer))}\n\nНапиши текст сообщения ${icon('down')}`
    })
    if (body.kind !== 'text' || !body.text) return

    await render(panel, progressScreen('Отправляю…'))
    await sendSms(account, toJid, body.text)
    await showNumber(panel, account, { notice: format`${icon('ok')} Отправлено на ${bold(peerTitle(peer))}` })
  } catch (error) {
    if (error instanceof PromptCancelled) {
      await showNumber(panel, account)
      return
    }
    console.error('[sms] ошибка отправки', error)
    await render(panel, errorScreen(`Не удалось отправить: ${(error as Error).message}`))
  } finally {
    busy.delete(userId)
  }
}

// ---------- свой джаббер ----------

/** проверить вход, привязать и подключить; без номера JMP — только если его можно дооформить */
async function linkJabber(userId: number, jid: string, password: string) {
  const requireNumber = !config.adminIds.has(userId)
    && (!canAddNumber(userId) || accounts.ofUser(userId).some(a => a.status === 'pending'))
  const result = await importAccount(userId, jid, password, { requireNumber })
  // не подключился сразу — пул сам повторит позже
  await pool.connect(result.account).catch(() => {})
  console.log(`[import] ${userId} → ${result.account.jid}${result.info?.tel ? ` (${result.info.tel})` : ''}`)
  return result
}

function linkedNotice(account: Account): Formatted {
  return account.status === 'active'
    ? format`${icon('ok')} ${bold(account.jid)} подключён — SMS на него будут приходить сюда.`
    : format`${icon('ok')} ${bold(account.jid)} подключён. Номера JMP на нём нет — его можно оформить кнопкой ниже.`
}

async function importFlow(userId: number, panel: Panel) {
  if (busy.has(userId)) return
  busy.add(userId)

  const prompter = createPrompter(userId, panel)
  const title = format`${icon('link')} ${bold('Свой джаббер')}`
  const retry = withIcon(Cb.importJabber.button({ text: 'Попробовать ещё раз' }), 'refresh')
  try {
    let jid: string | null = null
    let hint: Formatted | '' = ''
    while (!jid) {
      const answer = await prompter.askSimple({
        title,
        text: format`${hint}Можно подключить джаббер, который у тебя уже есть, например с номером JMP: SMS на него будут приходить в этот чат.\n\nПришли JID, например name@server.org`
      })
      jid = answer.kind === 'text' ? parseUserJid(answer.text) : null
      hint = format`${icon('warning')} Не похоже на JID, нужно вида name@server.org\n\n`
    }

    const password = await prompter.askSimple({
      title,
      text: format`JID: ${bold(jid)}\n\nТеперь пароль. Сообщение с ним я сразу удалю.`
    })
    if (password.kind !== 'text' || !password.text) return

    await render(panel, progressScreen('Захожу в джаббер и спрашиваю JMP…'))
    const { account } = await linkJabber(userId, jid, password.text)

    if (account.status === 'active') await showNumber(panel, account, { force: true, notice: linkedNotice(account) })
    else await render(panel, homeScreen(userId, undefined, linkedNotice(account)))
  } catch (error) {
    if (error instanceof PromptCancelled) {
      await showHome(userId, panel)
      return
    }
    await render(panel, errorScreen((error as Error).message, retry))
  } finally {
    busy.delete(userId)
  }
}

// ---------- пополнение баланса ----------

async function cardTopUpFlow(userId: number, panel: Panel, account: Account) {
  if (busy.has(userId)) return
  busy.add(userId)

  const back = withIcon(Cb.topUp.button({ text: 'К пополнению', id: account.id }), 'back')
  try {
    const xmpp = pool.get(account.id)
    if (!xmpp) throw new Error('номер ещё не подключён, попробуй через минуту')

    await render(panel, progressScreen('Спрашиваю JMP…'))
    const result = await topUpWithSavedCard(xmpp, createPrompter(userId, panel))
    // баланс в карточке должен сразу показать пополнение
    await refreshJmpInfo(xmpp).catch(() => {})
    console.log(`[topup] ${account.jid} картой: ${result.error ? 'ошибка' : 'ok'} ${result.notes.join(' | ')}`)
    await render(panel, topUpResultScreen(account, 'Оплата картой', result))
  } catch (error) {
    if (error instanceof PromptCancelled) {
      await showNumber(panel, account)
      return
    }
    console.error('[topup] ошибка оплаты картой', error)
    await render(panel, errorScreen(`JMP не ответил: ${(error as Error).message}`, back))
  } finally {
    busy.delete(userId)
  }
}

// ---------- входящие ----------

// jmp-chat отдаёт только то, что пришло через шлюз JMP; остальное игнорится

/** peer: null — сообщение от самого cheogram.com (а не от номера), служебное */
async function forwardIncoming(accountId: number, peer: string | null, body: string) {
  const account = accounts.get(accountId)
  if (!account) return

  const stored = messages.get(messages.add(account.id, 'in', peer ?? config.jmpJid, body))!

  const screen = peer
    ? smsNotification(account, stored)
    : { text: format`ℹ️ ${bold('JMP')} · ${accountTitle(account)}\n\n${body}`, keyboard: [] }

  const sent = await tg.api.sendMessage({
    chat_id: account.tg_id,
    text: screen.text,
    reply_markup: InlineKeyboard.keyboard(screen.keyboard),
    link_preview_options: { is_disabled: true },
    suppress: true
  })
  if ('message_id' in sent) messages.setTgMessage(stored.id, sent.message_id)
}

// у MMS текста может не быть — тогда в чат идут ссылки на картинки
pool.on('sms', (xmpp, sms) => forwardIncoming(xmpp.id, sms.from, [sms.body, ...sms.media].filter(Boolean).join('\n')))
pool.on('notice', (xmpp, notice) => forwardIncoming(xmpp.id, null, notice.body))

pool.on('smsError', async (xmpp, error) => {
  const account = accounts.get(xmpp.id)
  if (!account) return
  await tg.api.sendMessage({
    chat_id: account.tg_id,
    text: format`${icon('warning')} SMS на ${bold(error.to ? peerTitle(error.to) : config.jmpJid)} не доставлено\n\n${error.text}`,
    suppress: true
  })
})

// ---------- команды ----------

tg.command('start', async (message) => {
  const userId = message.senderId!
  cancelPrompt(userId)
  await tg.api.deleteMessage({ chat_id: message.chat.id, message_id: message.id, suppress: true })
  await showHome(userId, await freshPanel(userId, message.chat.id))
})

tg.command('cancel', async (message) => {
  await tg.api.deleteMessage({ chat_id: message.chat.id, message_id: message.id, suppress: true })
  if (hasPrompt(message.senderId!)) cancelPrompt(message.senderId!)
})

// /import jid пароль — привязать существующий джаббер (то же, что кнопка «Подключить свой джаббер»)
tg.command('import', async (message) => {
  const userId = message.senderId!
  // сообщение с паролем сразу убираем
  await tg.api.deleteMessage({ chat_id: message.chat.id, message_id: message.id, suppress: true })

  const [jid, password] = (message.text ?? '').split(/\s+/).slice(1)
  if (!jid || !password) return message.send('Формат: /import jid пароль')
  if (!canImport(userId)) return message.send(format`${icon('error')} Можно подключить не больше ${String(config.maxImportsPerUser)} своих джабберов`)
  if (busy.has(userId)) return

  busy.add(userId)
  try {
    const { account, info } = await linkJabber(userId, jid, password)
    await message.send(info?.tel
      ? format`${icon('ok')} ${bold(account.jid)} добавлен, номер ${bold(formatPhone(info.tel))}`
      : format`${icon('ok')} ${bold(account.jid)} добавлен, номера JMP на нём нет — можно оформить из /start`)
  } catch (error) {
    await message.send(format`${icon('error')} ${(error as Error).message}`)
  } finally {
    busy.delete(userId)
  }
})

tg.onMessage(async (message) => {
  if (message.text?.startsWith('/')) return
  if (await handlePromptText(message)) return

  const userId = message.senderId!

  // реплай на уведомление о SMS — отвечаем этому номеру
  const replyTo = message.replyToMessage?.id
  const original = replyTo ? messages.byTgMessage(userId, replyTo) : undefined
  if (original && message.text) {
    const account = accounts.get(original.account_id)!
    const toJid = phoneToJid(original.peer)
    try {
      if (!toJid) throw new Error('на этот номер ответить нельзя')
      await sendSms(account, toJid, message.text)
      await message.react('👌')
    } catch (error) {
      await message.reply(format`${icon('error')} Не отправилось: ${(error as Error).message}`)
    }
    return
  }

  await showHome(userId, await freshPanel(userId, message.chat.id))
})

// ---------- кнопки ----------

tg.onCallbackQuery(Cb.home.filter, async (query) => {
  cancelPrompt(query.senderId)
  await showHome(query.senderId, panelOf(query))
})

tg.onCallbackQuery(Cb.newNumber.filter, async (query) => {
  await query.answer()
  // регистрация длится минутами (ждёт ответов человека) — не держим dispatch
  void startRegistration(query.senderId, panelOf(query))
})

tg.onCallbackQuery(Cb.number.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: 'Номер не найден' })
  await showNumber(panelOf(query), account)
})

tg.onCallbackQuery(Cb.reminders.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: 'Номер не найден' })
  const on = query.payload.on
  accounts.setReminders(account.id, on)

  await query.answer({ text: on ? 'Напоминания включены' : 'Напоминания выключены' })
  // и из карточки, и из самого напоминания — показываем карточку номера с новым состоянием
  await showNumber(panelOf(query), accounts.get(account.id)!, {
    notice: on
      ? format`${icon('bell')} Напомню о продлении за 7, 3, 2 и 1 день, если на балансе не будет хватать денег.`
      : format`${icon('bellOff')} Напоминания о продлении выключены. Включить обратно можно кнопкой ниже.`
  })
})

tg.onCallbackQuery(Cb.refresh.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: 'Номер не найден' })
  await showNumber(panelOf(query), account, { force: true })
  await query.answer({ text: 'Обновлено' })
})

tg.onCallbackQuery(Cb.history.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: 'Номер не найден' })
  await render(panelOf(query), historyScreen(account, query.payload.page))
})

tg.onCallbackQuery(Cb.write.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: 'Номер не найден' })
  await query.answer()
  void writeFlow(query.senderId, panelOf(query), account)
})

tg.onCallbackQuery(Cb.jabber.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: 'Номер не найден' })
  await render(panelOf(query), jabberScreen(account))
})

tg.onCallbackQuery(Cb.unlink.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account || account.service === null) return query.answer({ text: 'Джаббер не найден' })

  const panel = panelOf(query)
  if (!query.payload.confirm) return render(panel, unlinkScreen(account))

  await pool.disconnect(account.id)
  accounts.remove(account.id)
  console.log(`[unlink] ${query.senderId} ✕ ${account.jid}`)
  await showHome(query.senderId, panel, format`${icon('ok')} ${bold(account.jid)} отвязан`)
})

tg.onCallbackQuery(Cb.referral.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: 'Номер не найден' })
  const xmpp = pool.get(account.id)
  if (!xmpp) return query.answer({ text: 'Номер ещё не подключён, попробуй через минуту', show_alert: true })

  await query.answer()
  const panel = panelOf(query)
  await render(panel, progressScreen('Спрашиваю JMP…'))
  try {
    await render(panel, referralScreen(account, await xmpp.jmp.account.referralCode()))
  } catch (error) {
    console.error('[referral] ошибка', error)
    await render(panel, errorScreen(`JMP не ответил: ${(error as Error).message}`, withIcon(Cb.number.button({ text: 'Назад', id: account.id }), 'back')))
  }
})

tg.onCallbackQuery(Cb.topUp.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: 'Номер не найден' })
  const xmpp = pool.get(account.id)
  if (!xmpp) return query.answer({ text: 'Номер ещё не подключён, попробуй через минуту', show_alert: true })

  await query.answer()
  const panel = panelOf(query)
  await render(panel, progressScreen('Спрашиваю JMP…'))
  const [info, options] = await Promise.all([jmpInfo(account, true), topUpOptions(xmpp)])
  await render(panel, topUpScreen(account, info, options))
})

tg.onCallbackQuery(Cb.topUpCrypto.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  const currency = query.payload.cur
  if (!account || !isCrypto(currency)) return query.answer({ text: 'Номер не найден' })
  const xmpp = pool.get(account.id)
  if (!xmpp) return query.answer({ text: 'Номер ещё не подключён, попробуй через минуту', show_alert: true })

  await query.answer()
  const panel = panelOf(query)
  await render(panel, progressScreen(`Получаю адрес ${CRYPTO[currency]}…`))
  try {
    const result = await cryptoAddress(xmpp, currency)
    await render(panel, topUpResultScreen(account, `Пополнение ${CRYPTO[currency]}`, result))
  } catch (error) {
    console.error('[topup] ошибка адреса', currency, error)
    await render(panel, errorScreen((error as Error).message, withIcon(Cb.topUp.button({ text: 'К пополнению', id: account.id }), 'back')))
  }
})

tg.onCallbackQuery(Cb.topUpCard.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: 'Номер не найден' })
  await query.answer()
  // ждёт ответов человека — не держим dispatch
  void cardTopUpFlow(query.senderId, panelOf(query), account)
})

tg.onCallbackQuery(Cb.importJabber.filter, async (query) => {
  if (!canImport(query.senderId)) {
    return query.answer({ text: `Можно подключить не больше ${config.maxImportsPerUser} своих джабберов`, show_alert: true })
  }
  await query.answer()
  // ждёт ответов человека — не держим dispatch
  void importFlow(query.senderId, panelOf(query))
})

// «ответить» под уведомлением — флоу в новой панели, само уведомление не трогаем
tg.onCallbackQuery(Cb.reply.filter, async (query) => {
  const original = messages.get(query.payload.msg)
  const account = original ? ownAccount(query.senderId, original.account_id) : undefined
  if (!original || !account) return query.answer({ text: 'Сообщение не найдено' })

  await query.answer()
  const panel = await freshPanel(query.senderId, query.message?.chat.id ?? query.senderId)
  void writeFlow(query.senderId, panel, account, original.peer)
})
