import type { AccountInfo } from 'jmp-chat'
import type { XmppAccount } from '../xmpp/account.ts'

// статус аккаунта JMP (команда `info`) — через jmp-chat; null — аккаунта в JMP нет

// кэш, чтобы не дёргать JMP на каждое открытие карточки номера
const cache = new Map<number, { info: AccountInfo | null, at: number }>()
const TTL = 5 * 60_000

export function cachedJmpInfo(accountId: number): AccountInfo | null | undefined {
  return cache.get(accountId)?.info
}

export function isJmpInfoFresh(accountId: number): boolean {
  const entry = cache.get(accountId)
  return entry !== undefined && Date.now() - entry.at < TTL
}

export async function refreshJmpInfo(xmpp: XmppAccount): Promise<AccountInfo | null> {
  const info = await xmpp.jmp.account.info()
  cache.set(xmpp.id, { info, at: Date.now() })
  return info
}
