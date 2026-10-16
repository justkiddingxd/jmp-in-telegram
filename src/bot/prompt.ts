import { InlineKeyboard, type MessageUpdate, type TelegramInlineKeyboardButton } from 'puregram'
import { defineCallbackData } from '@puregram/callback-data'
import { bold, format, italic, type Formatted } from '@puregram/markup'
import { ANY, OUR_CODE, PREV, type Answer, type Choice, type Prompter, type Question } from '../jmp/register.ts'
import { t, type Messages } from '../i18n/index.ts'
import { icon, withIcon, type IconName } from './icons.ts'
import { progressScreen, render, type Panel, type Screen } from './ui.ts'
import { tg } from './tg.ts'

// вопросы, которые задаются человеку посреди долгого флоу (регистрация, отправка SMS).
// рисуются в той же панели; ответ — кнопкой или текстом (текст потом удаляем, чтобы не мусорить).
// на пользователя одновременно максимум один вопрос

const AnswerButton = defineCallbackData('ans').number('p').number('i')
const PageButton = defineCallbackData('ansp').number('p').number('page')

const CANCEL = -1
const TIMEOUT = 15 * 60_000
const PAGE_SIZE = 10

/** вопрос закрыт без ответа: человек нажал «Отмена» или не ответил вовремя */
export class PromptCancelled extends Error {
  constructor(readonly reason: 'cancel' | 'timeout' = 'cancel') {
    super(reason)
  }
}

/** вопрос в свободной форме — для флоу внутри бота (отправка SMS и т.п.) */
export interface SimpleQuestion {
  title: Formatted | string
  text: Formatted | string
  options?: Choice[]
  allowText?: boolean
}

/** вариант ответа; icon — кастомная иконка перед подписью кнопки */
type ViewChoice = Choice & { icon?: IconName }

interface View {
  title: Formatted
  text: Formatted
  /** листаемые варианты */
  options: ViewChoice[]
  /** по 2 в ряд (короткие подписи) */
  twoColumns: boolean
  /** кнопки под списком, на каждой странице */
  extra: ViewChoice[]
  allowText: boolean
}

interface Pending {
  id: number
  view: View
  tx: Messages
  panel: Panel
  page: number
  resolve: (answer: Answer) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const pending = new Map<number, Pending>()
let lastId = 0

function settle(userId: number, entry: Pending) {
  clearTimeout(entry.timer)
  if (pending.get(userId) === entry) pending.delete(userId)
}

export function hasPrompt(userId: number): boolean {
  return pending.has(userId)
}

export function cancelPrompt(userId: number, reason?: 'cancel' | 'timeout') {
  const entry = pending.get(userId)
  if (!entry) return
  settle(userId, entry)
  entry.reject(new PromptCancelled(reason))
}

// ---------- вид вопросов регистрации ----------

function viewOf(question: Question, tx: Messages): View {
  const r = tx.registration
  switch (question.kind) {
    case 'search':
      return {
        title: r.searchTitle,
        text: format`${question.error ? format`${icon('warning')} ${question.error}\n\n` : ''}${r.searchText}`,
        options: [],
        twoColumns: false,
        extra: question.shortcuts.map(s => (s.value === ANY ? { ...s, icon: 'random' as const } : s)),
        allowText: true
      }

    case 'number': {
      const numbers = question.numbers
      const locations = new Set(numbers.map(n => n.location))
      const sameLocation = locations.size === 1 ? numbers[0]?.location : null

      return {
        title: r.numberTitle,
        text: format`${r.found(numbers.length)}${sameLocation ? format`${'\n'}${icon('location')} ${sameLocation}` : ''}`,
        options: numbers.map(n => ({
          label: sameLocation || !n.location ? n.phone : `${n.phone} · ${n.location}`,
          value: n.tel
        })),
        twoColumns: Boolean(sameLocation),
        extra: [{ label: r.searchAgain, value: PREV, icon: 'search' }],
        allowText: false
      }
    }

    case 'promo':
      return {
        title: r.promoTitle,
        text: format`${question.error ? format`${icon('warning')} ${question.error}\n\n` : ''}${r.promoText}`,
        options: [],
        twoColumns: false,
        extra: [{ label: r.noOwnCode, value: OUR_CODE, icon: 'ok' }],
        allowText: true
      }

    case 'generic':
      return {
        title: format`${bold(question.title)}`,
        text: format`${question.text}`,
        options: question.options,
        twoColumns: false,
        extra: question.extra,
        allowText: question.allowText
      }
  }
}

function pageCount(view: View) {
  return Math.max(1, Math.ceil(view.options.length / PAGE_SIZE))
}

function screenOf(id: number, view: View, page: number, tx: Messages): Screen {
  const pages = pageCount(view)
  const keyboard: TelegramInlineKeyboardButton[][] = []

  const slice = view.options.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  slice.forEach((o, i) => {
    const plain = AnswerButton.button({ text: o.label, p: id, i: page * PAGE_SIZE + i })
    const button = o.icon ? withIcon(plain, o.icon) : plain
    const row = keyboard.at(-1)
    if (view.twoColumns && row && i % 2 === 1) row.push(button)
    else keyboard.push([button])
  })

  if (pages > 1) {
    keyboard.push([
      page > 0 ? PageButton.button({ text: '◀️', p: id, page: page - 1 }) : InlineKeyboard.disabledButton({ text: '·' }),
      InlineKeyboard.disabledButton({ text: `${page + 1} / ${pages}` }),
      page < pages - 1 ? PageButton.button({ text: '▶️', p: id, page: page + 1 }) : InlineKeyboard.disabledButton({ text: '·' })
    ])
  }

  view.extra.forEach((o, i) => {
    const button = AnswerButton.button({ text: o.label, p: id, i: view.options.length + i })
    keyboard.push([o.icon ? withIcon(button, o.icon) : button])
  })
  keyboard.push([withIcon(AnswerButton.button({ text: tx.common.cancel, p: id, i: CANCEL }), 'cancel')])

  return { text: format`${view.title}\n\n${view.text}`, keyboard }
}

// ---------- prompter ----------

function ask(userId: number, panel: Panel, view: View, tx: Messages): Promise<Answer> {
  cancelPrompt(userId)

  const id = ++lastId
  return new Promise<Answer>((resolve, reject) => {
    const entry: Pending = {
      id,
      view,
      tx,
      panel,
      page: 0,
      resolve,
      reject,
      timer: setTimeout(() => {
        settle(userId, entry)
        reject(new PromptCancelled('timeout'))
      }, TIMEOUT)
    }
    pending.set(userId, entry)

    render(panel, screenOf(id, view, 0, tx)).catch((error) => {
      settle(userId, entry)
      reject(error)
    })
  })
}

export interface PanelPrompter extends Prompter {
  /** вопрос в свободной форме — для флоу внутри бота */
  askSimple(question: SimpleQuestion): Promise<Answer>
}

export function createPrompter(userId: number, panel: Panel): PanelPrompter {
  const tx = t(userId)
  return {
    tx,
    ask: question => ask(userId, panel, viewOf(question, tx), tx),
    askSimple: question => ask(userId, panel, {
      title: format`${question.title}`,
      text: format`${question.text}`,
      options: question.options ?? [],
      twoColumns: false,
      extra: [],
      allowText: question.allowText ?? true
    }, tx),
    progress: text => render(panel, progressScreen(text))
  }
}

// ---------- ответы ----------

tg.onCallbackQuery(AnswerButton.filter, async (query) => {
  const entry = pending.get(query.senderId)
  if (!entry || entry.id !== query.payload.p) {
    return query.answer({ text: t(query.senderId).prompt.stale })
  }

  settle(query.senderId, entry)

  if (query.payload.i === CANCEL) {
    entry.reject(new PromptCancelled())
    return query.answer()
  }

  const option = [...entry.view.options, ...entry.view.extra][query.payload.i]
  if (!option) return query.answer({ text: entry.tx.prompt.noOption })

  entry.resolve({ kind: 'option', value: option.value })
  return query.answer()
})

tg.onCallbackQuery(PageButton.filter, async (query) => {
  const entry = pending.get(query.senderId)
  if (!entry || entry.id !== query.payload.p) {
    return query.answer({ text: t(query.senderId).prompt.stale })
  }

  entry.page = Math.min(Math.max(query.payload.page, 0), pageCount(entry.view) - 1)
  await render(entry.panel, screenOf(entry.id, entry.view, entry.page, entry.tx))
  return query.answer()
})

/** текстовый ответ на открытый вопрос; true — сообщение съедено */
export async function handlePromptText(message: MessageUpdate): Promise<boolean> {
  const userId = message.senderId
  const entry = userId !== undefined ? pending.get(userId) : undefined
  if (!entry || !message.text) return false

  // ответы человека убираем — вся переписка живёт в панели
  await tg.api.deleteMessage({ chat_id: message.chat.id, message_id: message.id, suppress: true })

  if (!entry.view.allowText) {
    const screen = screenOf(entry.id, entry.view, entry.page, entry.tx)
    await render(entry.panel, { ...screen, text: format`${screen.text}\n\n${icon('up')} ${italic(entry.tx.prompt.useButtons)}` })
    return true
  }

  settle(userId!, entry)
  entry.resolve({ kind: 'text', text: message.text.trim() })
  return true
}
