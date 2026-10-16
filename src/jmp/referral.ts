import { formRows } from 'jmp-chat'
import type { XmppAccount } from '../xmpp/account.ts'

// команда JMP `referral codes`. ответ бывает двух видов:
//   - только note с текстом и реферальным кодом в конце фразы «...sign up and pay: CODE»
//   - форма-результат: тот же текст в instructions и таблица «Invite Code» с одноразовыми инвайтами

export interface ReferralCodes {
  /** многоразовый код: другу месяц после оплаты, тебе месяц, когда его оплата пройдёт */
  referral: string | null
  /** одноразовые инвайты: каждый даёт бесплатный месяц */
  invites: string[]
  /** текст JMP как есть */
  text: string
}

export async function fetchReferralCodes(xmpp: XmppAccount): Promise<ReferralCodes> {
  const step = await xmpp.jmp.runCommand('referral codes')
  const text = [...step.notes.map(n => n.text), step.form?.instructions ?? '']
    .map(t => t.trim())
    .filter(Boolean)
    .join('\n\n')

  return {
    referral: text.match(/pay:\s*([A-Z0-9]{4,})/)?.[1] ?? null,
    invites: formRows(step.form).map(row => row.code ?? Object.values(row)[0] ?? '').map(c => c.trim()).filter(Boolean),
    text
  }
}
