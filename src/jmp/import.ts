import { jid as parseJid } from '@xmpp/client'
import type { AccountInfo } from 'jmp-chat'
import { accounts, type Account } from '../db.ts'
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

function loginError(error: unknown, domain: string): Error {
  const e = error as Error & { condition?: string, code?: string }
  if (e.name === 'SASLError' || e.condition === 'not-authorized') return new Error('неверный JID или пароль')
  if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH') {
    return new Error(`не удалось подключиться к серверу ${domain}`)
  }
  return new Error(`не удалось войти: ${e.message}`)
}

/**
 * привязать к телеграм-юзеру уже существующий джаббер (на любом сервере).
 * если на нём уже есть номер JMP — аккаунт сразу активный, иначе его можно дооформить из бота.
 * requireNumber — не привязывать джаббер без номера JMP
 */
export async function importAccount(
  tgId: number,
  jid: string,
  password: string,
  opts: { requireNumber?: boolean } = {}
): Promise<{ account: Account, info: AccountInfo | null }> {
  const bare = parseUserJid(jid)
  if (!bare) throw new Error('не похоже на JID, нужно вида name@server.org')
  if (accounts.byJid(bare)) throw new Error(`${bare} уже добавлен в бота`)

  const { domain } = parseJid(bare)
  // временное подключение: проверяем пароль и спрашиваем JMP о номере
  const xmpp = new XmppAccount(0, bare, password, domain)
  let timer: NodeJS.Timeout | undefined
  let info: AccountInfo | null
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`сервер ${domain} не ответил`)), LOGIN_TIMEOUT)
    })
    await Promise.race([xmpp.start().catch((error) => { throw loginError(error, domain) }), timeout])
    info = await xmpp.jmp.account.info().catch(() => null)
  } finally {
    clearTimeout(timer)
    await xmpp.stop()
  }

  if (opts.requireNumber && !info?.tel) throw new Error('на этом джаббере нет номера JMP')

  const account = accounts.create(tgId, bare, password, domain)
  if (info?.tel) accounts.activate(account.id, info.tel)
  return { account: accounts.get(account.id)!, info }
}
