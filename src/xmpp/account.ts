import { client, jid as parseJid, xml, type Client } from '@xmpp/client'
import { JmpClient } from 'jmp-chat'
import { config } from '../config.ts'

type Element = ReturnType<typeof xml>

/** живое подключение одного джаббер-аккаунта; всё про JMP (SMS, команды) — через `jmp` */
export class XmppAccount {
  readonly client: Client
  readonly jmp: JmpClient

  /** service: null — наш ejabberd по внутреннему адресу; иначе внешний сервер (домен или xmpp://host:port) */
  constructor(readonly id: number, readonly jid: string, password: string, service: string | null = null) {
    const { local, domain } = parseJid(jid)
    this.client = client({
      service: service ?? config.xmppService,
      domain,
      username: local,
      password,
      resource: 'jmpbot'
    })

    this.client.on('error', (error: Error) => {
      console.error(`[xmpp ${jid}]`, error.message)
    })

    this.client.on('online', () => {
      // без available-презенса сервер не отдаст нам сообщения (в т.ч. офлайновые)
      this.client.send(xml('presence')).catch(() => {})
    })

    if (config.xmppDebug) {
      this.client.on('send', (el: Element) => console.log(`[xmpp ${jid}] >>`, el.toString()))
      this.client.on('element', (el: Element) => console.log(`[xmpp ${jid}] <<`, el.toString()))
    }

    // подписку шлюза jmp-chat подтверждает сам
    this.jmp = JmpClient.attach(this.client, { gateway: config.jmpJid })
  }

  async start(): Promise<void> {
    await this.client.start()
  }

  async stop(): Promise<void> {
    this.jmp.removeAllListeners()
    await this.jmp.close()
    await this.client.stop().catch(() => {})
  }
}
