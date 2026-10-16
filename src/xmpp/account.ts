import { client, jid as parseJid, xml, type Client } from '@xmpp/client'
import { JmpClient } from 'jmp-chat'
import { config } from '../config.ts'
import { describeError } from './errors.ts'

type Element = ReturnType<typeof xml>

// сколько ждать ответа сервера на открытие потока и прочие шаги входа. у xmpp.js по умолчанию 2 с —
// внешние серверы (особенно сразу после рестарта бота, пока висит старая сессия) отвечают дольше
export const XMPP_TIMEOUT = 15_000

// SASL-обмен в отладочный лог не пишем: при PLAIN там пароль в base64
const SASL = /^urn:(ietf:params:xml:ns:xmpp-sasl|xmpp:sasl:2)$/

function debugText(el: Element): string {
  return SASL.test(el.attrs.xmlns ?? '') ? `<${el.name} xmlns="${el.attrs.xmlns}"> [скрыто] </${el.name}>` : el.toString()
}

/** живое подключение одного джаббер-аккаунта; всё про JMP (SMS, команды) — через `jmp` */
export class XmppAccount {
  readonly client: Client
  readonly jmp: JmpClient

  /**
   * service: null — наш ejabberd по внутреннему адресу; иначе внешний сервер (домен или xmpp://host:port).
   * resource: другой ресурс — для временных проверок, чтобы не выбить живую сессию бота на этом же джаббере
   */
  constructor(readonly id: number, readonly jid: string, password: string, service: string | null = null, resource = 'jmpbot') {
    const { local, domain } = parseJid(jid)
    this.client = client({
      service: service ?? config.xmppService,
      domain,
      username: local,
      password,
      resource,
      timeout: XMPP_TIMEOUT
    })

    this.client.on('error', (error: Error) => {
      console.error(`[xmpp ${jid}]`, describeError(error))
    })

    this.client.on('online', () => {
      // без available-презенса сервер не отдаст нам сообщения (в т.ч. офлайновые)
      this.client.send(xml('presence')).catch(() => {})
    })

    if (config.xmppDebug) {
      this.client.on('send', (el: Element) => console.log(`[xmpp ${jid}] >>`, debugText(el)))
      this.client.on('element', (el: Element) => console.log(`[xmpp ${jid}] <<`, debugText(el)))
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
