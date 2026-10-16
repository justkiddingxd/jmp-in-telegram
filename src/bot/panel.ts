import { BotCommands, InlineKeyboard, type CallbackQueryUpdate } from 'puregram'
import { bold, format, type Formatted } from '@puregram/markup'
import { formatPhone, jidToPhone, phoneToJid as gatewayJid } from 'jmp-chat'
import { config } from '../config.ts'
import { accessRequests, accounts, messages, users, type Account } from '../db.ts'
import { AlreadyLinkedError, importAccount, parseUserJid } from '../jmp/import.ts'
import { cachedJmpInfo, isJmpInfoFresh, refreshJmpInfo } from '../jmp/info.ts'
import { registerWithJmp, RegistrationError } from '../jmp/register.ts'
import { CRYPTO, cryptoAddress, isCrypto, topUpOptions, topUpWithSavedCard } from '../jmp/topup.ts'
import { registerAccount } from '../xmpp/ejabberd.ts'
import { pool } from '../xmpp/pool.ts'
import { chooseLang, langOf, otherLang, rememberLang, rememberName, t, type Lang } from '../i18n/index.ts'
import { cancelPrompt, createPrompter, handlePromptText, hasPrompt, PromptCancelled } from './prompt.ts'
import { icon, withIcon } from './icons.ts'
import { tg } from './tg.ts'
import {
  accessRequestScreen,
  accessScreen,
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

// ---------- язык и доступ ----------

// язык интерфейса — из language_code автора апдейта (сообщения, нажатия кнопки)
tg.use(async (update, next) => {
  const from = (update.raw as { from?: { id: number, language_code?: string, first_name?: string, last_name?: string, username?: string } }).from
  if (from) {
    rememberLang(from.id, from.language_code)
    rememberName(from.id, from)
  }
  return next()
})

tg.use(async (update, next) => {
  if (config.allowedUsers.size === 0) return next()
  const userId = 'senderId' in update ? update.senderId : undefined
  if (userId !== undefined && (config.allowedUsers.has(userId) || config.adminIds.has(userId))) return next()
  if (update.is('message')) await update.send(format`${icon('forbidden')} ${t(userId ?? 0).common.closedBot}`)
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

/** аккаунт, к которому у юзера есть доступ: свой или общий */
function ownAccount(userId: number, id: number): Account | undefined {
  const account = accounts.get(id)
  return account && accounts.hasAccess(account, userId) ? account : undefined
}

/** только свой: доступом и отвязкой целиком распоряжается владелец */
function ownedAccount(userId: number, id: number): Account | undefined {
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
  if (single) return render(panel, numberScreen(userId, single, await jmpInfo(single), notice))
  return render(panel, homeScreen(userId, undefined, notice))
}

// панели живут в личке, поэтому id чата — это и есть юзер, который смотрит
async function showNumber(panel: Panel, account: Account, opts: { force?: boolean, notice?: Formatted } = {}) {
  return render(panel, numberScreen(panel.chatId, account, await jmpInfo(account, opts.force), opts.notice))
}

// ---------- регистрация номера ----------

// юзер в долгом флоу (регистрация / отправка) — второй параллельно не запускаем
const busy = new Set<number>()

async function startRegistration(userId: number, panel: Panel) {
  if (busy.has(userId)) return
  busy.add(userId)

  const tx = t(userId)
  const retry = withIcon(Cb.newNumber.button({ text: tx.common.tryAgain }), 'refresh')
  try {
    // недооформленный аккаунт переиспользуем: JMP помнит выбранный на нём номер
    let account = accounts.ownedBy(userId).find(a => a.status === 'pending')
    await render(panel, progressScreen(tx.registration.connecting))
    if (!account) {
      const credentials = await registerAccount(userId)
      account = accounts.create(userId, credentials.jid, credentials.password)
    }

    const xmpp = await pool.connect(account)
    const result = await registerWithJmp(xmpp, createPrompter(userId, panel))

    accounts.activate(account.id, result.phone, result.location, true)
    console.log(`[reg] ${account.jid} → ${result.phone}`)

    await showNumber(panel, accounts.get(account.id)!, {
      force: true,
      notice: tx.registration.ready
    })
  } catch (error) {
    if (error instanceof PromptCancelled) {
      await showHome(userId, panel, error.reason === 'cancel'
        ? tx.registration.cancelled
        : tx.registration.paused(tx.registration.timedOut))
    } else if (error instanceof RegistrationError) {
      await render(panel, errorScreen(tx, error.message, retry))
    } else {
      console.error('[reg] ошибка регистрации', error)
      await render(panel, errorScreen(tx, tx.registration.failed, retry))
      await notifyAdmins(id => t(id).admin.registrationFailed(userId, (error as Error).message))
    }
  } finally {
    busy.delete(userId)
  }
}

async function notifyAdmins(text: (adminId: number) => string) {
  for (const id of config.adminIds) {
    await tg.api.sendMessage({ chat_id: id, text: format`${icon('warning')} ${text(id)}`, suppress: true })
  }
}

// ---------- отправка SMS ----------

async function sendSms(sender: number, account: Account, toJid: string, body: string) {
  const xmpp = pool.get(account.id)
  if (!xmpp) throw new Error(t(sender).common.notConnectedShort)
  await xmpp.jmp.sendSms(toJid, body)
  messages.add(account.id, 'out', jidToPhone(toJid)!, body)
}

async function writeFlow(userId: number, panel: Panel, account: Account, presetPeer?: string) {
  if (busy.has(userId)) return
  busy.add(userId)

  const prompter = createPrompter(userId, panel)
  const tx = prompter.tx
  const title = tx.sms.newSms(accountTitle(account, tx))
  try {
    let toJid = presetPeer ? phoneToJid(presetPeer) : null
    let hint: Formatted | '' = ''
    while (!toJid) {
      const to = await prompter.askSimple({
        title,
        text: format`${hint}${tx.sms.toPrompt}`
      })
      toJid = to.kind === 'text' ? phoneToJid(to.text) : null
      hint = tx.sms.notANumber
    }

    const peer = jidToPhone(toJid)!
    const body = await prompter.askSimple({
      title,
      text: tx.sms.bodyPrompt(peerTitle(peer))
    })
    if (body.kind !== 'text' || !body.text) return

    await render(panel, progressScreen(tx.sms.sending))
    await sendSms(userId, account, toJid, body.text)
    await showNumber(panel, account, { notice: tx.sms.sent(peerTitle(peer)) })
  } catch (error) {
    if (error instanceof PromptCancelled) {
      await showNumber(panel, account)
      return
    }
    console.error('[sms] ошибка отправки', error)
    await render(panel, errorScreen(tx, tx.sms.sendFailed((error as Error).message)))
  } finally {
    busy.delete(userId)
  }
}

// ---------- свой джаббер ----------

/** проверить вход, привязать и подключить; без номера JMP — только если его можно дооформить */
async function linkJabber(userId: number, jid: string, password: string) {
  const requireNumber = !config.adminIds.has(userId)
    && (!canAddNumber(userId) || accounts.ownedBy(userId).some(a => a.status === 'pending'))
  const result = await importAccount(userId, jid, password, { requireNumber })
  // не подключился сразу — пул сам повторит позже
  await pool.connect(result.account).catch(() => {})
  console.log(`[import] ${userId} → ${result.account.jid}${result.info?.tel ? ` (${result.info.tel})` : ''}`)
  return result
}

function linkedNotice(account: Account): Formatted {
  const tx = t(account.tg_id).import
  return account.status === 'active' ? tx.linkedActive(account.jid) : tx.linkedPending(account.jid)
}

async function importFlow(userId: number, panel: Panel) {
  if (busy.has(userId)) return
  busy.add(userId)

  const prompter = createPrompter(userId, panel)
  const tx = prompter.tx
  const title = tx.import.title
  const retry = withIcon(Cb.importJabber.button({ text: tx.common.tryAgain }), 'refresh')
  try {
    let jid: string | null = null
    let hint: Formatted | '' = ''
    while (!jid) {
      const answer = await prompter.askSimple({
        title,
        text: format`${hint}${tx.import.intro}`
      })
      jid = answer.kind === 'text' ? parseUserJid(answer.text) : null
      hint = tx.import.notAJid
    }

    const password = await prompter.askSimple({
      title,
      text: tx.import.passwordPrompt(jid)
    })
    if (password.kind !== 'text' || !password.text) return

    await render(panel, progressScreen(tx.import.loggingIn))
    const { account } = await linkJabber(userId, jid, password.text)

    if (account.status === 'active') await showNumber(panel, account, { force: true, notice: linkedNotice(account) })
    else await render(panel, homeScreen(userId, undefined, linkedNotice(account)))
  } catch (error) {
    if (error instanceof PromptCancelled) {
      await showHome(userId, panel)
      return
    }
    if (error instanceof AlreadyLinkedError) {
      await showHome(userId, panel, await requestAccess(userId, error.account))
      return
    }
    await render(panel, errorScreen(tx, (error as Error).message, retry))
  } finally {
    busy.delete(userId)
  }
}

/**
 * джаббер уже у другого человека, пароль верный: отправляем владельцу запрос доступа.
 * возвращает, что сказать тому, кто просил
 */
async function requestAccess(userId: number, account: Account): Promise<Formatted> {
  const tx = t(userId).access
  if (accessRequests.pending(account.id, userId)) return tx.requestPending(account.jid)

  const request = accessRequests.create(account.id, userId)
  const screen = accessRequestScreen(account.tg_id, account, request)
  const sent = await tg.api.sendMessage({
    chat_id: account.tg_id,
    text: screen.text,
    reply_markup: InlineKeyboard.keyboard(screen.keyboard),
    suppress: true
  })
  if ('message_id' in sent) accessRequests.setOwnerMessage(request.id, sent.message_id)
  console.log(`[access] ${userId} просит доступ к ${account.jid} у ${account.tg_id}`)
  return tx.requestSent(account.jid)
}

// ---------- пополнение баланса ----------

async function cardTopUpFlow(userId: number, panel: Panel, account: Account) {
  if (busy.has(userId)) return
  busy.add(userId)

  const tx = t(userId)
  const back = withIcon(Cb.topUp.button({ text: tx.common.toTopUp, id: account.id }), 'back')
  try {
    const xmpp = pool.get(account.id)
    if (!xmpp) throw new Error(tx.common.notConnected)

    await render(panel, progressScreen(tx.common.askingJmp))
    const result = await topUpWithSavedCard(xmpp, createPrompter(userId, panel))
    // баланс в карточке должен сразу показать пополнение
    await refreshJmpInfo(xmpp).catch(() => {})
    console.log(`[topup] ${account.jid} картой: ${result.error ? 'ошибка' : 'ok'} ${result.notes.join(' | ')}`)
    await render(panel, topUpResultScreen(userId, account, tx.topUp.cardPayment, result))
  } catch (error) {
    if (error instanceof PromptCancelled) {
      await showNumber(panel, account)
      return
    }
    console.error('[topup] ошибка оплаты картой', error)
    await render(panel, errorScreen(tx, tx.common.jmpNoAnswer((error as Error).message), back))
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

  // владельцу и всем, у кого общий доступ, — каждому на его языке
  for (const recipient of accounts.recipients(account)) {
    const screen = peer
      ? smsNotification(recipient, account, stored)
      : { text: format`ℹ️ ${bold('JMP')} · ${accountTitle(account, t(recipient))}\n\n${body}`, keyboard: [] }

    const sent = await tg.api.sendMessage({
      chat_id: recipient,
      text: screen.text,
      reply_markup: InlineKeyboard.keyboard(screen.keyboard),
      link_preview_options: { is_disabled: true },
      suppress: true
    })
    if ('message_id' in sent) messages.addNotification(stored.id, recipient, sent.message_id)
  }
}

// у MMS текста может не быть — тогда в чат идут ссылки на картинки
pool.on('sms', (xmpp, sms) => forwardIncoming(xmpp.id, sms.from, [sms.body, ...sms.media].filter(Boolean).join('\n')))
pool.on('notice', (xmpp, notice) => forwardIncoming(xmpp.id, null, notice.body))

pool.on('smsError', async (xmpp, error) => {
  const account = accounts.get(xmpp.id)
  if (!account) return
  for (const recipient of accounts.recipients(account)) {
    await tg.api.sendMessage({
      chat_id: recipient,
      text: t(recipient).sms.notDelivered(error.to ? peerTitle(error.to) : config.jmpJid, error.text),
      suppress: true
    })
  }
})

// ---------- язык ----------

/** язык выбран вручную: запоминаем, меню команд в этом чате — на нём же, панель перерисовываем */
async function switchLanguage(userId: number, lang: Lang, panel: Panel) {
  chooseLang(userId, lang)
  const tx = t(lang).commands
  await tg.api.setMyCommands({
    commands: [BotCommands.command('start', tx.start), BotCommands.command('lang', tx.lang), BotCommands.command('cancel', tx.cancel)],
    scope: BotCommands.scope.chat(userId),
    suppress: true
  })
  await showHome(userId, panel, t(lang).language.changed)
}

// ---------- команды ----------

tg.command('start', async (message) => {
  const userId = message.senderId!
  cancelPrompt(userId)
  await tg.api.deleteMessage({ chat_id: message.chat.id, message_id: message.id, suppress: true })
  await showHome(userId, await freshPanel(userId, message.chat.id))
})

tg.command('lang', async (message) => {
  const userId = message.senderId!
  cancelPrompt(userId)
  await tg.api.deleteMessage({ chat_id: message.chat.id, message_id: message.id, suppress: true })
  await switchLanguage(userId, otherLang(langOf(userId)), await freshPanel(userId, message.chat.id))
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

  const tx = t(userId)
  const [jid, password] = (message.text ?? '').split(/\s+/).slice(1)
  if (!jid || !password) return message.send(tx.import.usage)
  if (!canImport(userId)) return message.send(format`${icon('error')} ${tx.import.limit(config.maxImportsPerUser)}`)
  if (busy.has(userId)) return

  busy.add(userId)
  try {
    const { account, info } = await linkJabber(userId, jid, password)
    await message.send(info?.tel
      ? tx.import.addedWithNumber(account.jid, formatPhone(info.tel))
      : tx.import.addedNoNumber(account.jid))
  } catch (error) {
    if (error instanceof AlreadyLinkedError) await message.send(await requestAccess(userId, error.account))
    else await message.send(format`${icon('error')} ${(error as Error).message}`)
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
      if (!accounts.hasAccess(account, userId)) throw new Error(t(userId).common.numberNotFound)
      if (!toJid) throw new Error(t(userId).sms.cantReply)
      await sendSms(userId, account, toJid, message.text)
      await message.react('👌')
    } catch (error) {
      await message.reply(t(userId).sms.notSent((error as Error).message))
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

tg.onCallbackQuery(Cb.lang.filter, async (query) => {
  const to = query.payload.to
  if (to !== 'ru' && to !== 'en') return query.answer()
  cancelPrompt(query.senderId)
  await query.answer()
  await switchLanguage(query.senderId, to, panelOf(query))
})

tg.onCallbackQuery(Cb.newNumber.filter, async (query) => {
  await query.answer()
  // регистрация длится минутами (ждёт ответов человека) — не держим dispatch
  void startRegistration(query.senderId, panelOf(query))
})

tg.onCallbackQuery(Cb.number.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: t(query.senderId).common.numberNotFound })
  await showNumber(panelOf(query), account)
})

tg.onCallbackQuery(Cb.reminders.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: t(query.senderId).common.numberNotFound })
  const on = query.payload.on
  accounts.setReminders(account.id, on)

  const tx = t(query.senderId).reminder
  await query.answer({ text: on ? tx.toastOn : tx.toastOff })
  // и из карточки, и из самого напоминания — показываем карточку номера с новым состоянием
  await showNumber(panelOf(query), accounts.get(account.id)!, { notice: on ? tx.noticeOn : tx.noticeOff })
})

tg.onCallbackQuery(Cb.refresh.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: t(query.senderId).common.numberNotFound })
  await showNumber(panelOf(query), account, { force: true })
  await query.answer({ text: t(query.senderId).common.refreshed })
})

tg.onCallbackQuery(Cb.history.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: t(query.senderId).common.numberNotFound })
  await render(panelOf(query), historyScreen(query.senderId, account, query.payload.page))
})

tg.onCallbackQuery(Cb.write.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: t(query.senderId).common.numberNotFound })
  await query.answer()
  void writeFlow(query.senderId, panelOf(query), account)
})

tg.onCallbackQuery(Cb.jabber.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: t(query.senderId).common.numberNotFound })
  await render(panelOf(query), jabberScreen(query.senderId, account))
})

tg.onCallbackQuery(Cb.unlink.filter, async (query) => {
  const userId = query.senderId
  const account = ownAccount(userId, query.payload.id)
  const owner = account?.tg_id === userId
  // владелец отвязывает целиком только внешний джаббер; участник — любой, но лишь у себя
  if (!account || (owner && account.service === null)) return query.answer({ text: t(userId).common.jabberNotFound })

  const panel = panelOf(query)
  if (!query.payload.confirm) return render(panel, unlinkScreen(userId, account))

  if (!owner) {
    accounts.removeMember(account.id, userId)
    console.log(`[access] ${userId} вышел из ${account.jid}`)
    return showHome(userId, panel, t(userId).access.left(account.jid))
  }

  const members = accounts.members(account.id)
  await pool.disconnect(account.id)
  accounts.remove(account.id)
  console.log(`[unlink] ${userId} ✕ ${account.jid}`)
  for (const member of members) {
    await tg.api.sendMessage({ chat_id: member, text: t(member).access.ownerUnlinked(account.jid), suppress: true })
  }
  await showHome(userId, panel, t(userId).unlink.done(account.jid))
})

// ---------- общий доступ ----------

tg.onCallbackQuery(Cb.access.filter, async (query) => {
  const account = ownedAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: t(query.senderId).common.numberNotFound })
  await render(panelOf(query), accessScreen(query.senderId, account))
})

tg.onCallbackQuery(Cb.revoke.filter, async (query) => {
  const account = ownedAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: t(query.senderId).common.numberNotFound })
  const member = query.payload.member
  accounts.removeMember(account.id, member)
  console.log(`[access] ${query.senderId} отозвал доступ ${member} к ${account.jid}`)
  await tg.api.sendMessage({ chat_id: member, text: t(member).access.revokedMember(account.jid), suppress: true })
  await query.answer()
  await render(panelOf(query), accessScreen(query.senderId, account))
})

tg.onCallbackQuery(Cb.request.filter, async (query) => {
  const owner = query.senderId
  const request = accessRequests.get(query.payload.id)
  const account = request ? accounts.get(request.account_id) : undefined
  if (!request || !account || account.tg_id !== owner || request.status !== 'pending') {
    return query.answer({ text: t(owner).access.requestGone })
  }

  const approve = query.payload.approve
  const who = users.name(request.tg_id) ?? `id ${request.tg_id}`
  accessRequests.setStatus(request.id, approve ? 'approved' : 'denied')
  if (approve) accounts.addMember(account.id, request.tg_id)
  console.log(`[access] ${owner} ${approve ? 'разрешил' : 'отклонил'} ${request.tg_id} → ${account.jid}`)

  await query.answer()
  // само сообщение с запросом превращается в итог, кнопки убираем
  if (query.message) {
    await tg.api.editMessageText({
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      text: approve ? t(owner).access.approvedOwner(who) : t(owner).access.deniedOwner(who),
      suppress: true
    })
  }
  const tx = t(request.tg_id)
  await tg.api.sendMessage({
    chat_id: request.tg_id,
    text: approve ? tx.access.granted(account.jid) : tx.access.denied(account.jid),
    reply_markup: approve ? InlineKeyboard.keyboard([[withIcon(Cb.home.button({ text: tx.common.myNumbers }), 'numbers')]]) : undefined,
    suppress: true
  })
})

tg.onCallbackQuery(Cb.referral.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: t(query.senderId).common.numberNotFound })
  const xmpp = pool.get(account.id)
  if (!xmpp) return query.answer({ text: t(query.senderId).common.notConnected, show_alert: true })

  await query.answer()
  const tx = t(query.senderId)
  const panel = panelOf(query)
  await render(panel, progressScreen(tx.common.askingJmp))
  try {
    await render(panel, referralScreen(query.senderId, account, await xmpp.jmp.account.referralCode()))
  } catch (error) {
    console.error('[referral] ошибка', error)
    await render(panel, errorScreen(tx, tx.common.jmpNoAnswer((error as Error).message), withIcon(Cb.number.button({ text: tx.common.back, id: account.id }), 'back')))
  }
})

tg.onCallbackQuery(Cb.topUp.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: t(query.senderId).common.numberNotFound })
  const xmpp = pool.get(account.id)
  if (!xmpp) return query.answer({ text: t(query.senderId).common.notConnected, show_alert: true })

  await query.answer()
  const panel = panelOf(query)
  await render(panel, progressScreen(t(query.senderId).common.askingJmp))
  const [info, options] = await Promise.all([jmpInfo(account, true), topUpOptions(xmpp)])
  await render(panel, topUpScreen(query.senderId, account, info, options))
})

tg.onCallbackQuery(Cb.topUpCrypto.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  const currency = query.payload.cur
  if (!account || !isCrypto(currency)) return query.answer({ text: t(query.senderId).common.numberNotFound })
  const xmpp = pool.get(account.id)
  if (!xmpp) return query.answer({ text: t(query.senderId).common.notConnected, show_alert: true })

  await query.answer()
  const tx = t(query.senderId)
  const panel = panelOf(query)
  await render(panel, progressScreen(tx.topUp.gettingAddress(CRYPTO[currency])))
  try {
    const result = await cryptoAddress(xmpp, currency, tx)
    await render(panel, topUpResultScreen(query.senderId, account, tx.topUp.cryptoTitle(CRYPTO[currency]), result))
  } catch (error) {
    console.error('[topup] ошибка адреса', currency, error)
    await render(panel, errorScreen(tx, (error as Error).message, withIcon(Cb.topUp.button({ text: tx.common.toTopUp, id: account.id }), 'back')))
  }
})

tg.onCallbackQuery(Cb.topUpCard.filter, async (query) => {
  const account = ownAccount(query.senderId, query.payload.id)
  if (!account) return query.answer({ text: t(query.senderId).common.numberNotFound })
  await query.answer()
  // ждёт ответов человека — не держим dispatch
  void cardTopUpFlow(query.senderId, panelOf(query), account)
})

tg.onCallbackQuery(Cb.importJabber.filter, async (query) => {
  if (!canImport(query.senderId)) {
    return query.answer({ text: t(query.senderId).import.limit(config.maxImportsPerUser), show_alert: true })
  }
  await query.answer()
  // ждёт ответов человека — не держим dispatch
  void importFlow(query.senderId, panelOf(query))
})

// «ответить» под уведомлением — флоу в новой панели, само уведомление не трогаем
tg.onCallbackQuery(Cb.reply.filter, async (query) => {
  const original = messages.get(query.payload.msg)
  const account = original ? ownAccount(query.senderId, original.account_id) : undefined
  if (!original || !account) return query.answer({ text: t(query.senderId).common.messageNotFound })

  await query.answer()
  const panel = await freshPanel(query.senderId, query.message?.chat.id ?? query.senderId)
  void writeFlow(query.senderId, panel, account, original.peer)
})
