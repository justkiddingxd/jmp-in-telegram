import { EventEmitter } from 'node:events'
import type { GatewayNotice, Sms, SmsError } from 'jmp-chat'
import type { Account } from '../db.ts'
import { XmppAccount } from './account.ts'
import { describeError } from './errors.ts'

interface Events {
  sms: [account: XmppAccount, sms: Sms]
  smsError: [account: XmppAccount, error: SmsError]
  notice: [account: XmppAccount, notice: GatewayNotice]
}

/** держит подключения всех аккаунтов и пробрасывает входящие наружу */
class XmppPool extends EventEmitter<Events> {
  private readonly connections = new Map<number, XmppAccount>()

  get(accountId: number): XmppAccount | undefined {
    return this.connections.get(accountId)
  }

  async connect(account: Account): Promise<XmppAccount> {
    const existing = this.connections.get(account.id)
    if (existing) return existing

    const connection = new XmppAccount(account.id, account.jid, account.password, account.service)
    connection.jmp.on('sms', sms => this.emit('sms', connection, sms))
    connection.jmp.on('smsError', error => this.emit('smsError', connection, error))
    connection.jmp.on('notice', notice => this.emit('notice', connection, notice))
    this.connections.set(account.id, connection)

    await this.start(connection)
    return connection
  }

  // после первого успешного входа переподключением занимается xmpp.js (@xmpp/reconnect),
  // а неудачный первый старт перезапускаем сами
  private async start(connection: XmppAccount): Promise<void> {
    try {
      await connection.start()
    } catch (error) {
      console.error(`[pool] ${connection.jid} не подключился:`, describeError(error))
      setTimeout(() => {
        if (this.connections.get(connection.id) === connection) this.start(connection).catch(() => {})
      }, 30_000)
      throw error
    }
  }

  /** отключить и забыть аккаунт — отложенный перезапуск тоже не сработает */
  async disconnect(accountId: number): Promise<void> {
    const connection = this.connections.get(accountId)
    if (!connection) return
    this.connections.delete(accountId)
    await connection.stop()
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.connections.values()].map(c => c.stop()))
    this.connections.clear()
  }
}

export const pool = new XmppPool()
