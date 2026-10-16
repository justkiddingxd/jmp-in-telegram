import { ACTIONS_FIELD, CRYPTO_CURRENCIES, JmpCommandError, type CommandStep, type CryptoCurrency } from 'jmp-chat'
import type { XmppAccount } from '../xmpp/account.ts'
import { askGeneric, type Prompter } from './register.ts'

// пополнение баланса JMP — через jmp-chat (команды `credit cards`, `top up`, `alt top up` на cheogram.com).
// здесь только то, что нужно телеграм-интерфейсу: подписи, вопросы человеку и вид результата

export const CRYPTO: Record<CryptoCurrency, string> = {
  BTC: 'Bitcoin',
  BCH: 'Bitcoin Cash',
  XMR: 'Monero',
  ETH: 'Ethereum'
}

export type Crypto = CryptoCurrency

export function isCrypto(value: string): value is Crypto {
  return (CRYPTO_CURRENCIES as readonly string[]).includes(value)
}

export interface ResultField {
  label: string
  values: string[]
  desc: string
}

/** итог команды JMP в виде, удобном для показа */
export interface CommandResult {
  title: string
  instructions: string
  fields: ResultField[]
  notes: string[]
  error: boolean
}

function describe(step: CommandStep): CommandResult {
  const form = step.form
  return {
    title: form?.title ?? '',
    instructions: form?.instructions ?? '',
    fields: (form?.fields ?? [])
      .filter(f => f.type !== 'hidden' && f.var !== ACTIONS_FIELD && f.values.length > 0)
      .map(f => ({ label: f.var ? f.label : '', values: f.values, desc: f.desc })),
    notes: step.notes.map(n => n.text),
    error: step.notes.some(n => n.type === 'error')
  }
}

export interface TopUpOptions {
  /** личная страница оплаты картой на pay.jmp.chat */
  cardUrl: string | null
  /** привязана карта — можно списать прямо из бота */
  savedCard: boolean
}

export async function topUpOptions(xmpp: XmppAccount): Promise<TopUpOptions> {
  const [cardUrl, savedCard] = await Promise.all([
    xmpp.jmp.topUp.cardUrl().catch(() => null),
    xmpp.jmp.topUp.hasSavedCard().catch(() => false)
  ])
  return { cardUrl, savedCard }
}

/** адрес для пополнения криптой */
export async function cryptoAddress(xmpp: XmppAccount, currency: Crypto): Promise<CommandResult> {
  const address = await xmpp.jmp.topUp.crypto(currency).catch((error: unknown) => {
    if (error instanceof Error && error.message.startsWith('JMP does not accept')) {
      throw new Error(`JMP сейчас не принимает ${CRYPTO[currency]}`)
    }
    throw error
  })
  return {
    title: address.title,
    instructions: '',
    // условия JMP (минимальная сумма и т.п.) — подписью под адресами
    fields: [{ label: '', values: address.addresses, desc: address.description }],
    notes: [],
    error: false
  }
}

/** списание с привязанной карты: формы JMP (сумма и т.п.) отдаём человеку как есть */
export async function topUpWithSavedCard(xmpp: XmppAccount, prompter: Prompter): Promise<CommandResult> {
  try {
    const step = await xmpp.jmp.topUp.withSavedCard(async (form) => {
      const values: Record<string, string[]> = {}
      for (const field of form.fields) {
        if (field.type === 'fixed' || field.type === 'hidden') continue
        if (field.var === ACTIONS_FIELD && field.options.length <= 1) continue
        // сумму спрашиваем всегда, даже если у JMP есть значение по умолчанию — это списание денег
        const value = await askGeneric(prompter, form, field, { askFilled: true })
        if (value !== null) values[field.var] = value
      }
      await prompter.progress('Оплачиваю…')
      return values
    })
    return describe(step)
  } catch (error) {
    // JMP ответил ошибкой (карту отклонили и т.п.) — показываем её как результат
    if (error instanceof JmpCommandError) return describe(error.step)
    throw error
  }
}
