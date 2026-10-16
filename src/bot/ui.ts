import { ApiError, InlineKeyboard, type TelegramInlineKeyboardButton } from 'puregram'
import { defineCallbackData } from '@puregram/callback-data'
import { bold, code, expandableBlockquote, format, italic, join, link, spoiler, type Formatted } from '@puregram/markup'
import { config } from '../config.ts'
import { accounts, messages, users, type AccessRequest, type Account, type StoredMessage } from '../db.ts'
import { extractOtp, formatPhone, type AccountInfo, type ReferralCode } from 'jmp-chat'
import type { PaymentDetails } from '../jmp/register.ts'
import { coverage, topUpFor, type ReminderDue } from '../jmp/renewal.ts'
import { CRYPTO, type CommandResult, type Crypto, type TopUpOptions } from '../jmp/topup.ts'
import { langOf, otherLang, t, type Messages } from '../i18n/index.ts'
import { icon, withIcon } from './icons.ts'
import { tg } from './tg.ts'

// весь интерфейс живёт в одном сообщении-«панели», которое редактируется на месте

export type Keyboard = TelegramInlineKeyboardButton[][]

export interface Screen {
  text: Formatted
  keyboard: Keyboard
}

export interface Panel {
  chatId: number
  /** 0 — панели ещё нет, render() отправит новое сообщение */
  messageId: number
}

export const Cb = {
  home: defineCallbackData('home'),
  newNumber: defineCallbackData('new'),
  number: defineCallbackData('num').number('id'),
  refresh: defineCallbackData('refresh').number('id'),
  history: defineCallbackData('hist').number('id').number('page'),
  write: defineCallbackData('write').number('id'),
  /** данные для входа в джаббер номера */
  jabber: defineCallbackData('jabber').number('id'),
  /** привязать свой джаббер */
  importJabber: defineCallbackData('import'),
  /** отвязать свой джаббер: confirm — уже подтвердили */
  unlink: defineCallbackData('unlink').number('id').boolean('confirm'),
  /** пополнение баланса JMP: экран со способами */
  topUp: defineCallbackData('topup').number('id'),
  /** адрес для пополнения криптой */
  topUpCrypto: defineCallbackData('topupc').number('id').string('cur'),
  /** списать с привязанной карты */
  topUpCard: defineCallbackData('topupk').number('id'),
  /** включить/выключить напоминания о продлении номера */
  reminders: defineCallbackData('remind').number('id').boolean('on'),
  /** реферальный код и инвайты JMP (команда `referral codes`) */
  referral: defineCallbackData('ref').number('id'),
  /** сменить язык интерфейса: to — ru / en */
  lang: defineCallbackData('lang').string('to'),
  /** список людей с общим доступом (для владельца) */
  access: defineCallbackData('access').number('id'),
  /** отозвать доступ: id аккаунта, member — у кого */
  revoke: defineCallbackData('revoke').number('id').number('member'),
  /** ответ владельца на запрос доступа */
  request: defineCallbackData('req').number('id').boolean('approve'),
  /** ответить на SMS: id сообщения в нашей базе */
  reply: defineCallbackData('reply').number('msg')
}

export async function render(panel: Panel, screen: Screen): Promise<void> {
  const reply_markup = InlineKeyboard.keyboard(screen.keyboard)

  if (panel.messageId) {
    try {
      await tg.api.editMessageText({
        chat_id: panel.chatId,
        message_id: panel.messageId,
        text: screen.text,
        reply_markup,
        link_preview_options: { is_disabled: true }
      })
      return
    } catch (error) {
      if (error instanceof ApiError && error.message.includes('message is not modified')) return
      // сообщение удалили / слишком старое — шлём новую панель
    }
  }

  const sent = await tg.send(panel.chatId, screen.text, {
    reply_markup,
    link_preview_options: { is_disabled: true }
  })
  panel.messageId = sent.message_id
}

// ---------- форматирование ----------

export function peerTitle(peer: string): string {
  if (peer === config.jmpJid) return 'JMP'
  return formatPhone(peer)
}

export function accountTitle(account: Account, tx: Messages = t(account.tg_id)): string {
  return account.phone ? formatPhone(account.phone) : tx.home.noNumber
}

export function relativeTime(ts: number, tx: Messages): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60_000)
  if (min < 1) return tx.time.justNow
  if (min < 60) return tx.time.minutesAgo(min)
  const hours = Math.floor(min / 60)
  if (hours < 24 && new Date(ts).getDate() === new Date().getDate()) return tx.time.hoursAgo(hours)

  const date = new Date(ts)
  const time = date.toLocaleTimeString(tx.locale, { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(Date.now() - 86_400_000)
  if (date.toDateString() === yesterday.toDateString()) return tx.time.yesterday(time)
  return `${date.toLocaleDateString(tx.locale, { day: 'numeric', month: 'short' })}, ${time}`
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function messageItem(m: StoredMessage, tx: Messages, max = 280): Formatted {
  const head = m.direction === 'in'
    ? format`${bold(peerTitle(m.peer))} · ${italic(relativeTime(m.created_at, tx))}`
    : format`${icon('outgoing')} ${bold(peerTitle(m.peer))} · ${italic(relativeTime(m.created_at, tx))}`
  const otp = m.direction === 'in' ? extractOtp(m.body) : null
  return format`${head}\n${truncate(m.body, max)}${otp ? format`${'\n'}${icon('otp')} ${code(otp)}` : ''}`
}

function longDate(date: string, tx: Messages, year = false): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(tx.locale, {
    day: 'numeric',
    month: 'long',
    ...(year ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC'
  })
}

function statusLine(info: AccountInfo | null | undefined, tx: Messages): Formatted | null {
  if (!info) return null
  const renewal = info.expiresAt ? longDate(info.expiresAt, tx, true) : null
  return info.active
    ? format`${icon('active')} ${tx.card.active}${renewal ? tx.card.renewsOn(renewal) : ''}`
    : format`${icon('inactive')} ${info.status ?? tx.card.inactive}${renewal ? tx.card.until(renewal) : ''}`
}

/** «🔗 Исходный код — py.md/jmp-in-tele» внизу главного меню */
function sourceFooter(tx: Messages): Formatted | '' {
  if (!config.sourceUrl) return ''
  const shown = config.sourceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
  // format отбрасывает перевод строки в начале шаблона — поэтому он передан значением
  return format`${'\n\n'}${icon('source')} ${tx.home.sourceCode} — ${link(shown, config.sourceUrl)}`
}

const usd = (x: number) => `$${x.toFixed(2)}`

/** до какой даты баланса хватит на продления — строка в карточке номера */
function coverageLine(info: AccountInfo | null | undefined, tx: Messages): Formatted | null {
  const c = info && coverage(info)
  if (!c || !info?.expiresAt) return null
  return c.renewals > 0
    ? format`${icon('calendar')} ${tx.card.paidUntil(longDate(c.paidUntil, tx, true))}`
    : format`${icon('calendar')} ${tx.card.notEnough(longDate(info.expiresAt, tx), usd(c.shortfall))}`
}

/** калькулятор: сколько пополнить, чтобы номер был оплачен ещё на 1, 2, 3 месяца */
function calculator(info: AccountInfo | null | undefined, tx: Messages): Formatted | null {
  const c = info && coverage(info)
  if (!c) return null
  const rows = [1, 2, 3].map((n) => {
    const { amount, until } = topUpFor(c, n)
    return format`+${bold(usd(amount))} → ${tx.topUp.until(longDate(until, tx, true))}`
  })
  return format`${icon('calendar')} ${bold(tx.topUp.calculator)}\n${tx.topUp.paidNow(longDate(c.paidUntil, tx, true))}\n${join(rows, '\n')}`
}

/** "$0.0000" → "$0.00", "$4.9900 / month" → "$4.99 в месяц" / "$4.99/month" */
export function money(value: string, tx: Messages): string {
  return value.replace(/(\d+\.\d{2})\d+/g, '$1').replace(/\s*\/\s*month$/i, tx.time.perMonth)
}

/** только сумма, без «в месяц» */
function amount(value: string): string {
  return value.replace(/(\d+\.\d{2})\d+/g, '$1').replace(/\s*\/\s*month$/i, '')
}

// ---------- экраны ----------

export function canAddNumber(userId: number): boolean {
  if (config.adminIds.has(userId)) return true
  // лимит — на номера, оформленные через бота; подключённые свои джабберы и общие (по доступу) не считаются
  return accounts.ownedBy(userId).filter(a => a.status === 'active' && a.via_bot === 1).length < config.maxNumbersPerUser
}

/** можно ли ещё привязать свой джаббер */
export function canImport(userId: number): boolean {
  if (config.adminIds.has(userId)) return true
  return accounts.ownedBy(userId).filter(a => a.service !== null).length < config.maxImportsPerUser
}

function importRow(userId: number): Keyboard {
  return canImport(userId) ? [[withIcon(Cb.importJabber.button({ text: t(userId).home.importJabber }), 'linkAdd')]] : []
}

/** кнопка смены языка внизу главного меню: название другого языка на нём самом */
function languageRow(userId: number): Keyboard {
  return [[withIcon(Cb.lang.button({ text: t(userId).language.switchTo, to: otherLang(langOf(userId)) }), 'language')]]
}

/** когда номер один и больше нельзя — главный экран и есть карточка номера */
export function singleNumber(userId: number): Account | undefined {
  const active = accounts.ofUser(userId).filter(a => a.status === 'active')
  return active.length === 1 && !canAddNumber(userId) ? active[0] : undefined
}

export function homeScreen(userId: number, info?: (account: Account) => AccountInfo | null | undefined, notice?: Formatted): Screen {
  const single = singleNumber(userId)
  if (single) return numberScreen(userId, single, info?.(single), notice)

  const tx = t(userId)
  const own = accounts.ofUser(userId)
  const active = own.filter(a => a.status === 'active')
  // дооформлять можно только свою регистрацию
  const pending = accounts.ownedBy(userId).find(a => a.status === 'pending')
  const prefix = notice ? format`${notice}\n\n` : ''

  const addButton = canAddNumber(userId)
    ? [[pending
      ? withIcon(Cb.newNumber.button({ text: tx.home.finishNumber }), 'wait')
      : withIcon(Cb.newNumber.button({ text: tx.home.getNumber }), 'add')]]
    : []

  if (active.length === 0) {
    return {
      text: format`${prefix}${tx.home.hello}${sourceFooter(tx)}`,
      keyboard: [...addButton, ...importRow(userId), ...languageRow(userId)]
    }
  }

  const lines = active.map((a) => {
    const last = messages.last(a.id)
    const meta = last ? tx.home.messagesMeta(messages.count(a.id), relativeTime(last.created_at, tx)) : tx.home.noMessagesYet
    return format`${icon('phone')} ${bold(accountTitle(a, tx))}${a.location ? ` · ${a.location}` : ''}\n${icon('chat')} ${italic(meta)}`
  })

  return {
    text: format`${prefix}${icon('numbers')} ${bold(tx.home.myNumbers)}\n\n${join(lines, '\n\n')}${sourceFooter(tx)}`,
    keyboard: [
      ...active.map(a => [withIcon(Cb.number.button({ text: accountTitle(a, tx), id: a.id }), 'phone')]),
      ...addButton,
      ...importRow(userId),
      ...languageRow(userId)
    ]
  }
}

export function numberScreen(viewer: number, account: Account, info?: AccountInfo | null, notice?: Formatted): Screen {
  const tx = t(viewer)
  const last = messages.page(account.id, 3)
  const total = messages.count(account.id)

  const header = [
    format`${icon('phone')} ${bold(accountTitle(account, tx))}`,
    account.location ? format`${icon('location')} ${account.location}` : null,
    statusLine(info, tx),
    info?.balance ? format`${icon('balance')} ${tx.card.balance}: ${bold(money(info.balance.text, tx))}` : null,
    coverageLine(info, tx),
    format`${icon('jid')} ${code(account.jid)}`
  ].filter((x): x is Formatted => x !== null)

  const body = last.length === 0
    ? italic(tx.card.noMessages)
    : join(last.map(m => messageItem(m, tx)), '\n\n')

  const keyboard: Keyboard = [
    [
      withIcon(Cb.refresh.button({ text: tx.card.refresh, id: account.id }), 'refresh'),
      withIcon(Cb.history.button({ text: tx.card.all(total), id: account.id, page: 0 }), 'history')
    ],
    [withIcon(Cb.write.button({ text: tx.card.writeSms, id: account.id }), 'write')]
  ]
  if (account.phone) keyboard[1]!.push(withIcon(InlineKeyboard.copyButton({ text: tx.card.copyNumber, copy: account.phone }), 'copy'))
  keyboard.push(
    [
      withIcon(Cb.topUp.button({ text: tx.card.topUp, id: account.id }), 'topUp'),
      account.reminders
        ? withIcon(Cb.reminders.button({ text: tx.card.reminders, id: account.id, on: false }), 'bell')
        : withIcon(Cb.reminders.button({ text: tx.card.noReminders, id: account.id, on: true }), 'bellOff')
    ],
    [
      withIcon(Cb.referral.button({ text: tx.card.promo, id: account.id }), 'promo'),
      withIcon(Cb.jabber.button({ text: tx.card.credentials, id: account.id }), 'credentials')
    ]
  )
  const owner = account.tg_id === viewer
  const members = owner ? accounts.members(account.id).length : 0
  const accessRow: TelegramInlineKeyboardButton[] = []
  // у кого есть общий доступ — владелец видит и может отозвать
  if (members > 0) accessRow.push(withIcon(Cb.access.button({ text: tx.access.button(members), id: account.id }), 'group'))
  // владелец отвязывает только свой (внешний) джаббер — наши аккаунты живут, пока жив номер;
  // участник «отвязывает» любой: убирает его только у себя
  if (!owner || account.service !== null) accessRow.push(withIcon(Cb.unlink.button({ text: tx.card.unlink, id: account.id, confirm: false }), 'unlink'))
  if (accessRow.length > 0) keyboard.push(accessRow)
  // с одним номером главного экрана нет — привязка своего джаббера и ссылка на код живут тут
  const single = singleNumber(viewer)
  if (single) keyboard.push(...importRow(viewer), ...languageRow(viewer))
  else keyboard.push([withIcon(Cb.home.button({ text: tx.common.myNumbers }), 'back')])

  return {
    text: format`${notice ? format`${notice}\n\n` : ''}${join(header, '\n')}\n\n${icon('chat')} ${bold(tx.card.lastMessages)}\n\n${body}${single ? sourceFooter(tx) : ''}`,
    keyboard
  }
}

const HISTORY_PAGE = 6

export function historyScreen(viewer: number, account: Account, page: number): Screen {
  const tx = t(viewer)
  const total = messages.count(account.id)
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE))
  page = Math.min(Math.max(page, 0), pages - 1)

  const list = messages.page(account.id, HISTORY_PAGE, page * HISTORY_PAGE)
  const body = list.length === 0 ? italic(tx.history.empty) : join(list.map(m => messageItem(m, tx, 1000)), '\n\n')

  const nav: TelegramInlineKeyboardButton[] = []
  if (page > 0) nav.push(Cb.history.button({ text: '◀️', id: account.id, page: page - 1 }))
  if (pages > 1) nav.push(InlineKeyboard.disabledButton({ text: `${page + 1} / ${pages}` }))
  if (page < pages - 1) nav.push(Cb.history.button({ text: '▶️', id: account.id, page: page + 1 }))

  return {
    text: format`${icon('history')} ${bold(accountTitle(account, tx))}${tx.history.title}\n\n${body}`,
    keyboard: [nav, [withIcon(Cb.number.button({ text: tx.common.back, id: account.id }), 'back')]].filter(r => r.length > 0)
  }
}

/** логин и пароль джаббера — чтобы зайти в него обычным XMPP-клиентом */
export function jabberScreen(viewer: number, account: Account): Screen {
  const tx = t(viewer)
  const own = account.service === null
  const lines = [
    format`JID: ${code(account.jid)}`,
    format`${tx.jabber.password}: ${spoiler(account.password)}`,
    own ? tx.jabber.server(config.xmppDomain) : null
  ].filter((x): x is Formatted => x !== null)

  const hint = own ? tx.jabber.hintOwn(config.jmpJid) : tx.jabber.hintImported

  const copy: TelegramInlineKeyboardButton[] = [withIcon(InlineKeyboard.copyButton({ text: 'JID', copy: account.jid }), 'copy')]
  // copy_text у телеги до 256 символов
  if (account.password.length <= 256) copy.push(withIcon(InlineKeyboard.copyButton({ text: tx.jabber.copyPassword, copy: account.password }), 'copy'))

  return {
    text: format`${icon('credentials')} ${bold(tx.jabber.title)} · ${accountTitle(account, tx)}\n\n${join(lines, '\n')}\n\n${italic(hint)}`,
    keyboard: [copy, [withIcon(Cb.number.button({ text: tx.common.back, id: account.id }), 'back')]]
  }
}

export function topUpScreen(viewer: number, account: Account, info: AccountInfo | null | undefined, options: TopUpOptions): Screen {
  const tx = t(viewer)
  const lines = [
    info?.balance ? format`${tx.topUp.balance}: ${bold(money(info.balance.text, tx))}` : null,
    info?.renewal ? format`${tx.topUp.plan}: ${money(info.renewal.text, tx)}` : null,
    statusLine(info, tx)
  ].filter((x): x is Formatted => x !== null)

  const calc = calculator(info, tx)
  const ways = [
    options.cardUrl ? tx.topUp.byCard : null,
    options.savedCard ? tx.topUp.bySavedCard : null,
    tx.topUp.byCrypto
  ].filter((x): x is Formatted => x !== null)

  const crypto = (Object.keys(CRYPTO) as Crypto[]).map(cur => withIcon(Cb.topUpCrypto.button({ text: CRYPTO[cur], id: account.id, cur }), 'crypto'))
  const keyboard: Keyboard = []
  if (options.cardUrl) keyboard.push([withIcon(InlineKeyboard.urlButton({ text: tx.topUp.payByCard, url: options.cardUrl }), 'card')])
  if (options.savedCard) keyboard.push([withIcon(Cb.topUpCard.button({ text: tx.topUp.savedCard, id: account.id }), 'card')])
  keyboard.push(crypto.slice(0, 2), crypto.slice(2))
  keyboard.push([withIcon(Cb.number.button({ text: tx.common.back, id: account.id }), 'back')])

  return {
    text: format`${icon('topUp')} ${bold(tx.topUp.title)} · ${accountTitle(account, tx)}\n\n${lines.length ? format`${join(lines, '\n')}\n\n` : ''}${calc ? format`${calc}\n\n` : ''}${join(ways, '\n\n')}`,
    keyboard
  }
}

/** итог команды JMP: адрес для крипты, результат оплаты */
export function topUpResultScreen(viewer: number, account: Account, heading: string, result: CommandResult): Screen {
  const tx = t(viewer)
  const fields = result.fields.map(f => join([
    ...(f.label ? [format`${bold(f.label)}:`] : []),
    ...f.values.map(v => code(v)),
    ...(f.desc ? [italic(f.desc)] : [])
  ], '\n'))
  const parts = [
    result.instructions ? format`${result.instructions}` : null,
    ...fields,
    ...result.notes.map(n => format`${n}`)
  ].filter((x): x is Formatted => x !== null)

  const copy = result.fields
    .flatMap(f => f.values)
    // копируем только то, что похоже на адрес/код, а не фразы
    .filter(v => v.length <= 256 && !/\s/.test(v))
    .slice(0, 3)
    .map(v => [withIcon(InlineKeyboard.copyButton({ text: v.length > 24 ? `${v.slice(0, 10)}…${v.slice(-8)}` : v, copy: v }), 'copy')])

  return {
    text: format`${icon(result.error ? 'error' : 'topUp')} ${bold(heading)} · ${accountTitle(account, tx)}\n\n${parts.length ? join(parts, '\n\n') : italic(tx.topUp.noAnswer)}`,
    keyboard: [...copy, [withIcon(Cb.topUp.button({ text: tx.common.toTopUp, id: account.id }), 'back')]]
  }
}

/** напоминание: скоро продление номера, а на балансе не хватает */
export function reminderScreen(recipient: number, account: Account, info: AccountInfo, due: ReminderDue): Screen {
  const tx = t(recipient)
  const price = info.renewal ? tx.reminder.price(amount(info.renewal.text)) : ''
  const balance = info.balance ? amount(info.balance.text) : null
  const short = due.shortfall !== null && balance ? tx.reminder.shortfall(balance, `$${due.shortfall.toFixed(2)}`) : ''

  return {
    text: format`${icon('wait')} ${bold(tx.reminder.title)} · ${accountTitle(account, tx)}\n\n${tx.reminder.when(tx.time.days(due.days), longDate(due.expiresAt, tx))}${price}${short}\n\n${tx.reminder.action}\n\n${italic(tx.reminder.footer)}`,
    keyboard: [[
      withIcon(Cb.topUp.button({ text: tx.card.topUp, id: account.id }), 'topUp'),
      withIcon(Cb.reminders.button({ text: tx.reminder.stop, id: account.id, on: false }), 'bellOff')
    ]]
  }
}

/** реферальный код и одноразовые инвайты JMP */
export function referralScreen(viewer: number, account: Account, codes: ReferralCode): Screen {
  const tx = t(viewer)
  const parts: Formatted[] = []
  if (codes.code) {
    parts.push(format`${bold(tx.referral.code)}: ${code(codes.code)}\n${italic(tx.referral.codeDesc)}`)
  }
  if (codes.invites.length > 0) {
    parts.push(format`${bold(tx.referral.invites(codes.invites.length))}\n${italic(tx.referral.invitesDesc)}\n${join(codes.invites.map(c => code(c)), '\n')}`)
  }
  if (parts.length === 0) parts.push(italic(tx.referral.none))
  if (codes.text) parts.push(format`${italic(tx.referral.jmpAnswer)}\n${expandableBlockquote(codes.text)}`)

  // copy_text — первые несколько кодов, остальные копируются тапом по коду в тексте
  const copy = [codes.code, ...codes.invites]
    .filter((c): c is string => Boolean(c))
    .slice(0, 6)
    .map(c => withIcon(InlineKeyboard.copyButton({ text: c, copy: c }), 'copy'))
  const rows: Keyboard = []
  for (let i = 0; i < copy.length; i += 2) rows.push(copy.slice(i, i + 2))

  return {
    text: format`${icon('promo')} ${bold(tx.referral.title)} · ${accountTitle(account, tx)}\n\n${join(parts, '\n\n')}`,
    keyboard: [...rows, [withIcon(Cb.number.button({ text: tx.common.back, id: account.id }), 'back')]]
  }
}

/** номер забронирован, JMP ждёт оплату криптой: адрес и сумма с кнопками «скопировать» */
export function paymentScreen(viewer: number, account: Account, payment: PaymentDetails): Screen {
  const tx = t(viewer)
  const r = tx.registration
  const fields = payment.fields.map(f => format`${bold(f.label)}:\n${join(f.values.map(v => code(v)), '\n')}`)
  const copy = payment.fields
    .flatMap(f => f.values)
    .filter(v => v.length <= 256 && !/\s/.test(v))
    .slice(0, 3)
    .map(v => [withIcon(InlineKeyboard.copyButton({ text: v.length > 24 ? `${v.slice(0, 10)}…${v.slice(-8)}` : v, copy: v }), 'copy')])

  return {
    text: format`${icon('crypto')} ${bold(r.paymentTitle)}${payment.title ? ` · ${payment.title}` : ''}\n\n${account.phone ? format`${r.reserved(formatPhone(account.phone))}\n\n` : ''}${join(fields, '\n\n')}${payment.instructions ? format`${'\n\n'}${italic(payment.instructions)}` : ''}\n\n${r.paymentWait}`,
    keyboard: [...copy, [withIcon(Cb.home.button({ text: tx.common.toMenu }), 'back')]]
  }
}

/** кому владелец открыл доступ, с кнопками «отозвать» */
export function accessScreen(viewer: number, account: Account): Screen {
  const tx = t(viewer)
  const members = accounts.members(account.id)
  const names = members.map(id => users.name(id) ?? `id ${id}`)
  const list = members.length === 0
    ? italic(tx.access.nobody)
    : join(names.map(name => format`• ${name}`), '\n')
  return {
    text: format`${icon('group')} ${bold(tx.access.title)} · ${accountTitle(account, tx)}\n\n${list}\n\n${italic(tx.access.hint)}`,
    keyboard: [
      ...members.map((id, i) => [withIcon(Cb.revoke.button({ text: tx.access.revoke(names[i]!), id: account.id, member: id }), 'cancel')]),
      [withIcon(Cb.number.button({ text: tx.common.back, id: account.id }), 'back')]
    ]
  }
}

/** запрос доступа — владельцу */
export function accessRequestScreen(owner: number, account: Account, request: AccessRequest): Screen {
  const tx = t(owner)
  const who = users.name(request.tg_id) ?? `id ${request.tg_id}`
  return {
    text: tx.access.request(who, request.tg_id, account.jid, accountTitle(account, tx)),
    keyboard: [[
      withIcon(Cb.request.button({ text: tx.access.approve, id: request.id, approve: true }), 'ok'),
      withIcon(Cb.request.button({ text: tx.access.deny, id: request.id, approve: false }), 'cancel')
    ]]
  }
}

export function unlinkScreen(viewer: number, account: Account): Screen {
  const tx = t(viewer)
  const owner = account.tg_id === viewer
  return {
    text: owner
      ? format`${icon('unlink')} ${bold(tx.unlink.title)}\n\n${code(account.jid)} · ${accountTitle(account, tx)}\n\n${tx.unlink.body}${accounts.members(account.id).length > 0 ? format`${'\n\n'}${tx.access.unlinkNote}` : ''}\n\n${italic(tx.unlink.keep)}`
      : format`${icon('unlink')} ${bold(tx.access.leaveTitle)}\n\n${code(account.jid)} · ${accountTitle(account, tx)}\n\n${tx.access.leaveBody}`,
    keyboard: [
      [withIcon(Cb.unlink.button({ text: tx.unlink.confirm, id: account.id, confirm: true }), 'unlink')],
      [withIcon(Cb.number.button({ text: tx.common.cancel, id: account.id }), 'back')]
    ]
  }
}

export function progressScreen(text: string): Screen {
  return { text: format`${icon('wait')} ${text}`, keyboard: [] }
}

export function errorScreen(tx: Messages, text: string, retry?: TelegramInlineKeyboardButton): Screen {
  return {
    text: format`${icon('error')} ${bold(tx.common.failed)}\n\n${text}`,
    keyboard: [...(retry ? [[retry]] : []), [withIcon(Cb.home.button({ text: tx.common.toMenu }), 'back')]]
  }
}

/** уведомление о входящем SMS — отдельным сообщением */
export function smsNotification(recipient: number, account: Account, m: StoredMessage): Screen {
  const tx = t(recipient)
  const otp = extractOtp(m.body)
  const to = italic(tx.sms.to(accountTitle(account, tx)))

  const text = otp
    ? format`${icon('otp')} ${code(otp)}\n\n${bold(peerTitle(m.peer))} · ${to}\n${m.body}`
    : format`${icon('sms')} ${bold(peerTitle(m.peer))} · ${to}\n\n${m.body}`

  const row: TelegramInlineKeyboardButton[] = []
  if (otp) row.push(withIcon(InlineKeyboard.copyButton({ text: otp, copy: otp }), 'copy'))
  row.push(withIcon(Cb.reply.button({ text: tx.sms.reply, msg: m.id }), 'reply'))

  return { text, keyboard: [row] }
}
