import { randomBytes } from 'node:crypto'
import { config } from '../config.ts'

// mod_http_api: POST /api/<command> с json-телом
async function call(command: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${config.ejabberdApi}/${command}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`ejabberd ${command}: ${response.status} ${text}`)
  return text ? JSON.parse(text) : null
}

export interface Credentials {
  jid: string
  username: string
  password: string
}

/** регает новый аккаунт на нашем сервере под телеграм-юзера */
export async function registerAccount(tgId: number): Promise<Credentials> {
  const username = `tg${tgId}-${randomBytes(3).toString('hex')}`
  const password = randomBytes(18).toString('base64url')

  await call('register', { user: username, host: config.xmppDomain, password })

  return { jid: `${username}@${config.xmppDomain}`, username, password }
}

export async function unregisterAccount(username: string): Promise<void> {
  await call('unregister', { user: username, host: config.xmppDomain })
}
