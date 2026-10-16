import { ApiError, InlineKeyboard, type TelegramInlineKeyboardButton } from 'puregram'
import { defineCallbackData } from '@puregram/callback-data'
import { bold, code, format, italic, join, link, spoiler, type Formatted } from '@puregram/markup'
import { config } from '../config.ts'
import { accounts, messages, type Account, type StoredMessage } from '../db.ts'
import { extractOtp, formatPhone, type AccountInfo } from 'jmp-chat'
import type { ReminderDue } from '../jmp/renewal.ts'
import { CRYPTO, type CommandResult, type Crypto, type TopUpOptions } from '../jmp/topup.ts'
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

export function accountTitle(account: Account): string {
  return account.phone ? formatPhone(account.phone) : 'номер не оформлен'
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const hours = Math.floor(min / 60)
  if (hours < 24 && new Date(ts).getDate() === new Date().getDate()) return `${hours} ч назад`

  const date = new Date(ts)
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(Date.now() - 86_400_000)
  if (date.toDateString() === yesterday.toDateString()) return `вчера, ${time}`
  return `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${time}`
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function messageItem(m: StoredMessage, max = 280): Formatted {
  const head = m.direction === 'in'
    ? format`${bold(peerTitle(m.peer))} · ${italic(relativeTime(m.created_at))}`
    : format`${icon('outgoing')} ${bold(peerTitle(m.peer))} · ${italic(relativeTime(m.created_at))}`
  const otp = m.direction === 'in' ? extractOtp(m.body) : null
  return format`${head}\n${truncate(m.body, max)}${otp ? format`${'\n'}${icon('otp')} ${code(otp)}` : ''}`
}

function statusLine(info: AccountInfo | null | undefined): Formatted | null {
  if (!info) return null
  const active = info.active
  const renewal = info.expiresAt
    ? new Date(`${info.expiresAt}T00:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : null
  return active
    ? format`${icon('active')} Активен${renewal ? ` · продление ${renewal}` : ''}`
    : format`${icon('inactive')} ${info.status ?? 'неактивен'}${renewal ? ` · до ${renewal}` : ''}`
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function longDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

/** «Исходный код» внизу главного меню */
function sourceFooter(): Formatted | '' {
  // format отбрасывает перевод строки в начале шаблона — поэтому он передан значением
  return config.sourceUrl ? format`${'\n\n'}${icon('source')} ${italic(link('Исходный код', config.sourceUrl))}` : ''
}

/** "$0.0000" → "$0.00", "$4.9900 / month" → "$4.99 в месяц" */
export function money(value: string): string {
  return value.replace(/(\d+\.\d{2})\d+/g, '$1').replace(/\s*\/\s*month$/i, ' в месяц')
}

// ---------- экраны ----------

export function canAddNumber(userId: number): boolean {
  if (config.adminIds.has(userId)) return true
  return accounts.ofUser(userId).filter(a => a.status === 'active').length < config.maxNumbersPerUser
}

/** можно ли ещё привязать свой джаббер */
export function canImport(userId: number): boolean {
  if (config.adminIds.has(userId)) return true
  return accounts.ofUser(userId).filter(a => a.service !== null).length < config.maxImportsPerUser
}

function importRow(userId: number): Keyboard {
  return canImport(userId) ? [[withIcon(Cb.importJabber.button({ text: 'Подключить свой джаббер' }), 'linkAdd')]] : []
}

/** когда номер один и больше нельзя — главный экран и есть карточка номера */
export function singleNumber(userId: number): Account | undefined {
  const active = accounts.ofUser(userId).filter(a => a.status === 'active')
  return active.length === 1 && !canAddNumber(userId) ? active[0] : undefined
}

export function homeScreen(userId: number, info?: (account: Account) => AccountInfo | null | undefined, notice?: Formatted): Screen {
  const single = singleNumber(userId)
  if (single) return numberScreen(single, info?.(single), notice)

  const own = accounts.ofUser(userId)
  const active = own.filter(a => a.status === 'active')
  const pending = own.find(a => a.status === 'pending')
  const prefix = notice ? format`${notice}\n\n` : ''

  const addButton = canAddNumber(userId)
    ? [[pending
      ? withIcon(Cb.newNumber.button({ text: 'Дооформить номер' }), 'wait')
      : withIcon(Cb.newNumber.button({ text: 'Получить номер' }), 'add')]]
    : []

  if (active.length === 0) {
    return {
      text: format`${prefix}${icon('hello')} ${bold('Привет!')}\n\nЗдесь можно получить американский номер от JMP.chat — все SMS на него будут приходить прямо в этот чат.\n\nПодходит для кодов подтверждения: код подсвечивается и копируется одним нажатием.${sourceFooter()}`,
      keyboard: [...addButton, ...importRow(userId)]
    }
  }

  const lines = active.map((a) => {
    const last = messages.last(a.id)
    const meta = last ? `${messages.count(a.id)} · последнее ${relativeTime(last.created_at)}` : 'сообщений пока нет'
    return format`${icon('phone')} ${bold(accountTitle(a))}${a.location ? ` · ${a.location}` : ''}\n${icon('chat')} ${italic(meta)}`
  })

  return {
    text: format`${prefix}${icon('numbers')} ${bold('Мои номера')}\n\n${join(lines, '\n\n')}${sourceFooter()}`,
    keyboard: [
      ...active.map(a => [withIcon(Cb.number.button({ text: accountTitle(a), id: a.id }), 'phone')]),
      ...addButton,
      ...importRow(userId)
    ]
  }
}

export function numberScreen(account: Account, info?: AccountInfo | null, notice?: Formatted): Screen {
  const last = messages.page(account.id, 3)
  const total = messages.count(account.id)
  const status = statusLine(info)

  const header = [
    format`${icon('phone')} ${bold(accountTitle(account))}`,
    account.location ? format`${icon('location')} ${account.location}` : null,
    status,
    info?.balance ? format`${icon('balance')} Баланс: ${bold(money(info.balance.text))}` : null,
    format`${icon('jid')} ${code(account.jid)}`
  ].filter((x): x is Formatted => x !== null)

  const body = last.length === 0
    ? italic('Сообщений пока нет — как только придёт SMS, я сразу пришлю его сюда.')
    : join(last.map(m => messageItem(m)), '\n\n')

  const keyboard: Keyboard = [
    [
      withIcon(Cb.refresh.button({ text: 'Обновить', id: account.id }), 'refresh'),
      withIcon(Cb.history.button({ text: `Все (${total})`, id: account.id, page: 0 }), 'history')
    ],
    [withIcon(Cb.write.button({ text: 'Написать SMS', id: account.id }), 'write')]
  ]
  if (account.phone) keyboard[1]!.push(withIcon(InlineKeyboard.copyButton({ text: 'Номер', copy: account.phone }), 'copy'))
  keyboard.push([
    withIcon(Cb.topUp.button({ text: 'Пополнить баланс', id: account.id }), 'topUp'),
    account.reminders
      ? withIcon(Cb.reminders.button({ text: 'Напоминания', id: account.id, on: false }), 'bell')
      : withIcon(Cb.reminders.button({ text: 'Без напоминаний', id: account.id, on: true }), 'bellOff')
  ])
  const jabberRow = [withIcon(Cb.jabber.button({ text: 'Данные джаббера', id: account.id }), 'credentials')]
  // отвязать можно только свой джаббер; наши аккаунты живут, пока жив номер
  if (account.service !== null) jabberRow.push(withIcon(Cb.unlink.button({ text: 'Отвязать', id: account.id, confirm: false }), 'unlink'))
  keyboard.push(jabberRow)
  // с одним номером главного экрана нет — привязка своего джаббера и ссылка на код живут тут
  const single = singleNumber(account.tg_id)
  if (single) keyboard.push(...importRow(account.tg_id))
  else keyboard.push([withIcon(Cb.home.button({ text: 'Мои номера' }), 'back')])

  return {
    text: format`${notice ? format`${notice}\n\n` : ''}${join(header, '\n')}\n\n${icon('chat')} ${bold('Последние сообщения')}\n\n${body}${single ? sourceFooter() : ''}`,
    keyboard
  }
}

const HISTORY_PAGE = 6

export function historyScreen(account: Account, page: number): Screen {
  const total = messages.count(account.id)
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE))
  page = Math.min(Math.max(page, 0), pages - 1)

  const list = messages.page(account.id, HISTORY_PAGE, page * HISTORY_PAGE)
  const body = list.length === 0 ? italic('Пусто') : join(list.map(m => messageItem(m, 1000)), '\n\n')

  const nav: TelegramInlineKeyboardButton[] = []
  if (page > 0) nav.push(Cb.history.button({ text: '◀️', id: account.id, page: page - 1 }))
  if (pages > 1) nav.push(InlineKeyboard.disabledButton({ text: `${page + 1} / ${pages}` }))
  if (page < pages - 1) nav.push(Cb.history.button({ text: '▶️', id: account.id, page: page + 1 }))

  return {
    text: format`${icon('history')} ${bold(accountTitle(account))} · все сообщения\n\n${body}`,
    keyboard: [nav, [withIcon(Cb.number.button({ text: 'Назад', id: account.id }), 'back')]].filter(r => r.length > 0)
  }
}

/** логин и пароль джаббера — чтобы зайти в него обычным XMPP-клиентом */
export function jabberScreen(account: Account): Screen {
  const own = account.service === null
  const lines = [
    format`JID: ${code(account.jid)}`,
    format`Пароль: ${spoiler(account.password)}`,
    own ? format`Сервер: ${code(config.xmppDomain)}, порт 5222` : null
  ].filter((x): x is Formatted => x !== null)

  const hint = own
    ? `Зайди с этими данными в любой XMPP-клиент (Conversations, Monal, Gajim, Dino): SMS будут приходить и туда, и сюда, а писать можно прямо из клиента — на +15551234567@${config.jmpJid}.`
    : 'Это твой джаббер, бот подключён к нему как ещё один клиент. Если сменишь пароль, бот перестанет получать SMS.'

  const copy: TelegramInlineKeyboardButton[] = [withIcon(InlineKeyboard.copyButton({ text: 'JID', copy: account.jid }), 'copy')]
  // copy_text у телеги до 256 символов
  if (account.password.length <= 256) copy.push(withIcon(InlineKeyboard.copyButton({ text: 'Пароль', copy: account.password }), 'copy'))

  return {
    text: format`${icon('credentials')} ${bold('Джаббер')} · ${accountTitle(account)}\n\n${join(lines, '\n')}\n\n${italic(hint)}`,
    keyboard: [copy, [withIcon(Cb.number.button({ text: 'Назад', id: account.id }), 'back')]]
  }
}

export function topUpScreen(account: Account, info: AccountInfo | null | undefined, options: TopUpOptions): Screen {
  const lines = [
    info?.balance ? format`Баланс: ${bold(money(info.balance.text))}` : null,
    info?.renewal ? format`Тариф: ${money(info.renewal.text)}` : null,
    statusLine(info)
  ].filter((x): x is Formatted => x !== null)

  const ways = [
    options.cardUrl ? format`${icon('card')} ${bold('Картой')} — на странице JMP: там же можно привязать карту и включить автопополнение.` : null,
    options.savedCard ? format`${icon('card')} ${bold('С привязанной карты')} — прямо отсюда, сумму выберешь на следующем шаге.` : null,
    format`${icon('crypto')} ${bold('Криптой')} — дам адрес, деньги зачислятся после подтверждения в сети.`
  ].filter((x): x is Formatted => x !== null)

  const crypto = (Object.keys(CRYPTO) as Crypto[]).map(cur => withIcon(Cb.topUpCrypto.button({ text: CRYPTO[cur], id: account.id, cur }), 'crypto'))
  const keyboard: Keyboard = []
  if (options.cardUrl) keyboard.push([withIcon(InlineKeyboard.urlButton({ text: 'Оплатить картой', url: options.cardUrl }), 'card')])
  if (options.savedCard) keyboard.push([withIcon(Cb.topUpCard.button({ text: 'С привязанной карты', id: account.id }), 'card')])
  keyboard.push(crypto.slice(0, 2), crypto.slice(2))
  keyboard.push([withIcon(Cb.number.button({ text: 'Назад', id: account.id }), 'back')])

  return {
    text: format`${icon('topUp')} ${bold('Пополнение')} · ${accountTitle(account)}\n\n${lines.length ? format`${join(lines, '\n')}\n\n` : ''}${join(ways, '\n\n')}`,
    keyboard
  }
}

/** итог команды JMP: адрес для крипты, результат оплаты */
export function topUpResultScreen(account: Account, heading: string, result: CommandResult): Screen {
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
    text: format`${icon(result.error ? 'error' : 'topUp')} ${bold(heading)} · ${accountTitle(account)}\n\n${parts.length ? join(parts, '\n\n') : italic('JMP ничего не ответил')}`,
    keyboard: [...copy, [withIcon(Cb.topUp.button({ text: 'К пополнению', id: account.id }), 'back')]]
  }
}

/** напоминание: скоро продление номера, а на балансе не хватает */
export function reminderScreen(account: Account, info: AccountInfo, due: ReminderDue): Screen {
  const when = `${due.days} ${plural(due.days, 'день', 'дня', 'дней')}`
  const price = info.renewal ? format` JMP спишет ${bold(money(info.renewal.text).replace(/ в месяц$/, ''))} за следующий месяц.` : ''
  const balance = info.balance ? money(info.balance.text) : null
  const short = due.shortfall !== null && balance
    ? format`${'\n'}На балансе ${bold(balance)}, не хватает ${bold(`$${due.shortfall.toFixed(2)}`)}.`
    : ''

  return {
    text: format`${icon('wait')} ${bold('Скоро продление номера')} · ${accountTitle(account)}\n\nЧерез ${when}, ${longDate(due.expiresAt)}.${price}${short}\n\nПополни баланс заранее, иначе номер может отключиться.\n\n${italic('Напоминаю за 7, 3, 2 и 1 день, пока на балансе не хватает на продление.')}`,
    keyboard: [[
      withIcon(Cb.topUp.button({ text: 'Пополнить баланс', id: account.id }), 'topUp'),
      withIcon(Cb.reminders.button({ text: 'Не напоминать', id: account.id, on: false }), 'bellOff')
    ]]
  }
}

export function unlinkScreen(account: Account): Screen {
  return {
    text: format`${icon('unlink')} ${bold('Отвязать джаббер?')}\n\n${code(account.jid)} · ${accountTitle(account)}\n\nБот отключится от него, SMS перестанут приходить сюда, а история сообщений в боте удалится.\n\n${italic('Сам джаббер и номер JMP останутся у тебя — их можно будет подключить снова.')}`,
    keyboard: [
      [withIcon(Cb.unlink.button({ text: 'Да, отвязать', id: account.id, confirm: true }), 'unlink')],
      [withIcon(Cb.number.button({ text: 'Отмена', id: account.id }), 'back')]
    ]
  }
}

export function progressScreen(text: string): Screen {
  return { text: format`${icon('wait')} ${text}`, keyboard: [] }
}

export function errorScreen(text: string, retry?: TelegramInlineKeyboardButton): Screen {
  return {
    text: format`${icon('error')} ${bold('Не получилось')}\n\n${text}`,
    keyboard: [...(retry ? [[retry]] : []), [withIcon(Cb.home.button({ text: 'В меню' }), 'back')]]
  }
}

/** уведомление о входящем SMS — отдельным сообщением */
export function smsNotification(account: Account, m: StoredMessage): Screen {
  const otp = extractOtp(m.body)
  const to = italic(`на ${accountTitle(account)}`)

  const text = otp
    ? format`${icon('otp')} ${code(otp)}\n\n${bold(peerTitle(m.peer))} · ${to}\n${m.body}`
    : format`${icon('sms')} ${bold(peerTitle(m.peer))} · ${to}\n\n${m.body}`

  const row: TelegramInlineKeyboardButton[] = []
  if (otp) row.push(withIcon(InlineKeyboard.copyButton({ text: otp, copy: otp }), 'copy'))
  row.push(withIcon(Cb.reply.button({ text: 'Ответить', msg: m.id }), 'reply'))

  return { text, keyboard: [row] }
}
