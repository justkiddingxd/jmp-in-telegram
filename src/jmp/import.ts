import { jid as parseJid } from '@xmpp/client'
import type { AccountInfo } from 'jmp-chat'
import { accounts, type Account } from '../db.ts'
import { t, type Messages } from '../i18n/index.ts'
import { describeError } from '../xmpp/errors.ts'
import { XmppAccount } from '../xmpp/account.ts'

// только публичные домены: без ip и внутренних имён вроде «ejabberd» из docker-сети
const PUBLIC_HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/i
const LOGIN_TIMEOUT = 20_000

/** что прислал человек → bare jid; null — не похоже на jid */
export function parseUserJid(input: string): string | null {
  input = input.trim()
  if (/\s/.test(input)) return null
  try {
    const jid = parseJid(input)
    if (!jid.local || !PUBLIC_HOST.test(jid.domain)) return null
    return jid.bare().toString().toLowerCase()
  } catch {
    return null
  }
}

function loginError(error: unknown, domain: string, tx: Messages['import']): Error {
  const e = error as Error & { condition?: string, code?: string }
  if (e.name === 'SASLError' || e.condition === 'not-authorized') return new Error(tx.wrongCredentials)
  if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH') return new Error(tx.cantConnect(domain))
  if (e.name === 'TimeoutError') return new Error(tx.noAnswer(domain))
  return new Error(tx.loginFailed(e.message || describeError(e)))
}

/**
 * привязать к телеграм-юзеру уже существующий джаббер (на любом сервере).
 * если на нём уже есть номер JMP — аккаунт сразу активный, иначе его можно дооформить из бота.
 * requireNumber — не привязывать джаббер без номера JMP
 */
/** джаббер уже привязан у другого человека, а пароль верный — можно просить доступ у владельца */
export class AlreadyLinkedError extends Error {
  constructor(readonly account: Account) {
    super(`${account.jid} is linked by another user`)
  }
}

/**
 * временный вход: проверяем пароль и спрашиваем JMP о номере.
 * resource отдельный — у уже привязанного джаббера бот держит сессию на «jmpbot»
 */
async function checkLogin(bare: string, password: string, service: string | null, domain: string, tx: Messages['import']): Promise<AccountInfo | null> {
  const xmpp = new XmppAccount(0, bare, password, service, 'jmpbot-check')
  let timer: NodeJS.Timeout | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(tx.noAnswer(domain))), LOGIN_TIMEOUT)
    })
    await Promise.race([xmpp.start().catch((error) => { throw loginError(error, domain, tx) }), timeout])
    return await xmpp.jmp.account.info().catch(() => null)
  } finally {
    clearTimeout(timer)
    await xmpp.stop()
  }
}

export async function importAccount(
  tgId: number,
  jid: string,
  password: string,
  opts: { requireNumber?: boolean } = {}
): Promise<{ account: Account, info: AccountInfo | null }> {
  const tx = t(tgId).import
  const bare = parseUserJid(jid)
  if (!bare) throw new Error(tx.badJid)
  const { domain } = parseJid(bare)

  const existing = accounts.byJid(bare)
  if (existing) {
    if (accounts.hasAccess(existing, tgId)) throw new Error(t(tgId).access.alreadyHave(bare))
    // чужой джаббер: доступ просим у владельца, но только если человек знает пароль
    await checkLogin(bare, password, existing.service, domain, tx)
    throw new AlreadyLinkedError(existing)
  }

  const info = await checkLogin(bare, password, domain, domain, tx)

  if (opts.requireNumber && !info?.tel) throw new Error(tx.noJmpNumber)

  const account = accounts.create(tgId, bare, password, domain)
  if (info?.tel) accounts.activate(account.id, info.tel)
  return { account: accounts.get(account.id)!, info }
}
