import { ACTIONS_FIELD, JmpCommandError, JmpError, stepUrls, type AvailableNumber, type CommandStep, type DataForm, type FormField, type Registration } from 'jmp-chat'
import { config } from '../config.ts'
import type { Messages } from '../i18n/index.ts'
import type { XmppAccount } from '../xmpp/account.ts'

// регистрация в JMP — Registration из jmp-chat (ad-hoc команда `jabber:iq:register` на cheogram.com).
// выбор шлюза и fair use policy jmp-chat проходит сам; по стадиям:
//   search   — спрашиваем у человека, что искать (или «показать любые»)
//   choose   — человек выбирает номер из списка (или идёт искать заново)
//   activate — инвайт-код человека (бесплатно) или оплата депозита картой / криптой;
//              к оплате прикладываем реферальный код (свой человека или наш JMP_PROMO_CODE) в поле
//              «Optional referral code» — он даёт бонусный месяц после оплаты
//   unknown  — незнакомая форма: отдаём поля человеку как есть, на случай если JMP поменяет формы

export const PREV = '\0prev'
export const SKIP = '\0skip'
/** shortcut «показать любые номера» на шаге поиска */
export const ANY = '\0any'
/** на шаге активации: «оплатить способом X» — value = PAY + activation_method JMP */
export const PAY = '\0pay:'
/** на шаге оплаты картой: «я оплатил» */
export const PAID = '\0paid'
/** способы оплаты активации, которые бот умеет провести */
export const PAY_METHODS = ['credit_card', 'bitcoin', 'bch'] as const

export interface Choice {
  label: string
  value: string
}

export type Answer =
  | { kind: 'option', value: string }
  | { kind: 'text', text: string }

export type Question =
  /** что искать: текст запроса или один из shortcuts ("показать любые") */
  | { kind: 'search', error?: string, shortcuts: Choice[] }
  /** выбор номера; значение PREV — искать заново */
  | { kind: 'number', numbers: AvailableNumber[] }
  /**
   * инвайт-код текстом — или оплата: value = PAY + метод из methods.
   * deposit — сколько JMP просит внести (из его формы), referral — какой реферальный код приложим к оплате
   */
  | { kind: 'promo', error?: string, methods: string[], deposit: string | null, referral: string | null }
  /** оплата картой на странице JMP: PAID — «я оплатил», PREV — выбрать другой способ */
  | { kind: 'payCard', url: string, deposit: string | null, error?: string }
  /** незнакомое поле формы */
  | { kind: 'generic', title: string, text: string, options: Choice[], extra: Choice[], allowText: boolean }

/** то, как драйвер общается с человеком (реализация — в телеграме) */
export interface Prompter {
  /** тексты на языке юзера */
  tx: Messages
  ask(question: Question): Promise<Answer>
  progress(text: string): Promise<void>
}

export class RegistrationError extends Error {}

/** реквизиты оплаты активации криптой: адрес, минимальная сумма и пояснение JMP */
export interface PaymentDetails {
  method: string
  title: string
  instructions: string
  fields: { label: string, values: string[] }[]
}

export type RegistrationResult =
  /** номер активирован */
  | { kind: 'active', phone: string | null, location: string | null, notes: string }
  /** номер забронирован, JMP ждёт оплату криптой — активирует сам, когда платёж подтвердится */
  | { kind: 'payment', phone: string | null, location: string | null, payment: PaymentDetails }

/** "...deposit $20.00 to your balance..." → "$20.00" */
function depositOf(text: string): string | null {
  return text.match(/\$\s?\d+(?:\.\d+)?/)?.[0] ?? null
}

function paymentDetails(method: string, step: CommandStep): PaymentDetails {
  return {
    method,
    title: step.form?.title ?? '',
    instructions: step.form?.instructions ?? step.notes.map(n => n.text).join('\n'),
    fields: (step.form?.fields ?? [])
      .filter(f => f.var && f.var !== ACTIONS_FIELD && f.type !== 'hidden' && f.values.length > 0)
      .map(f => ({ label: f.label, values: f.values }))
  }
}

const NO_NUMBERS = 'No numbers found, try another search.'

const SEARCH_HINT = 'You can search for a telephone number you like, for example by an area code (like 810) or a state code (like MI).'

/** есть ли у формы поиска кнопка «показать любые» (так же её ищет jmp-chat) */
function canShowAny(reg: Registration): boolean {
  const actions = reg.step.form?.fields.find(f => f.var === ACTIONS_FIELD)
  return actions?.options.some(o => /lucky|any|some/i.test(o.value) || /show me/i.test(o.label)) ?? false
}

export async function registerWithJmp(xmpp: XmppAccount, prompter: Prompter): Promise<RegistrationResult> {
  let reg: Registration | undefined
  // почему JMP не принял введённый человеком код — показываем при повторном вопросе
  let promoError: string | undefined
  // что искали в прошлый раз: если JMP вернул форму поиска — по этому запросу пусто
  let lastQuery: string | null = null
  // выбранный номер — для результата, пока JMP ждёт оплату
  let chosen: AvailableNumber | null = null
  // человек прислал реферальный (а не инвайт) код — приложим его к оплате вместо нашего
  let userReferral: string | null = null
  // сколько JMP просит внести — запоминаем с формы «Activate JMP»: на форме ввода кода этого текста нет
  let deposit: string | null = null
  const tx = prompter.tx.registration
  try {
    reg = await xmpp.jmp.register()

    for (let i = 0; i < 50; i++) {
      switch (reg.stage) {
        case 'done': {
          const result = reg.result()
          return { kind: 'active', phone: result.tel ?? chosen?.tel ?? null, location: result.location ?? chosen?.location ?? null, notes: result.notes.join('\n') }
        }

        case 'canceled':
          throw new RegistrationError(tx.jmpCancelled)

        case 'search': {
          const message = reg.message
          let error = message && message !== SEARCH_HINT ? (message === NO_NUMBERS ? tx.noNumbersFound : message) : undefined
          // после поиска снова форма поиска = ничего не нашлось. на часть запросов (например, ~7777777)
          // JMP возвращает её молча, с пустыми instructions — тогда объясняем сами
          if (lastQuery !== null && (!error || message === NO_NUMBERS)) error = tx.nothingFoundFor(lastQuery)
          const shortcuts = canShowAny(reg) ? [{ label: tx.showAny, value: ANY }] : []

          const answer = await prompter.ask({ kind: 'search', error, shortcuts })
          await prompter.progress(tx.searching)
          lastQuery = answer.kind === 'text' ? answer.text : tx.showAny
          await reg.search(answer.kind === 'text' ? answer.text : { any: true }, { limit: config.jmpSearchLimit })
          continue
        }

        case 'choose': {
          // номера нашлись — «Искать заново» не должно выглядеть как пустой поиск
          lastQuery = null
          const numbers = reg.numbers
          const answer = await prompter.ask({ kind: 'number', numbers })
          if (answer.kind === 'option' && answer.value === PREV) {
            await prompter.progress(prompter.tx.common.second)
            await reg.backToSearch()
            continue
          }
          const tel = answer.kind === 'option' ? answer.value : answer.text
          chosen = numbers.find(n => n.tel === tel) ?? null
          await prompter.progress(tx.taking(chosen?.phone ?? tel))
          await reg.choose(tel)
          continue
        }

        case 'activate': {
          const methods = reg.activationMethods
          deposit = depositOf(reg.message) ?? deposit
          // на форме «Activate JMP» — какие способы оплаты есть; на форме ввода кода их нет, но вернуться к ним можно
          const payMethods = methods.length > 0
            ? PAY_METHODS.filter(m => methods.some(o => o.value === m))
            : [...PAY_METHODS]
          const codeAllowed = methods.length === 0 || methods.some(o => o.value === 'code')
          if (!codeAllowed && payMethods.length === 0) throw new RegistrationError(tx.premium)

          const referral = userReferral ?? (config.jmpPromoCode || null)
          const answer = await prompter.ask({ kind: 'promo', error: promoError, methods: payMethods, deposit, referral })

          // ---- оплата
          if (answer.kind === 'option' && answer.value.startsWith(PAY)) {
            const method = answer.value.slice(PAY.length)
            promoError = undefined
            await prompter.progress(tx.preparingPayment)
            // с формы ввода кода — назад к выбору способа активации
            if (reg.activationMethods.length === 0) await reg.session.prev()
            const { step } = await reg.activate(method, { currency: config.jmpCurrency, values: referral ? { code: referral } : {} })

            if (method === 'credit_card') {
              // карта: JMP даёт ссылку и ждёт «next» после оплаты; результат разберёт следующий круг
              await payByCard(reg, step, prompter, deposit)
              continue
            }
            // крипта: JMP выдал адрес и сумму и сам активирует номер, когда платёж подтвердится
            return { kind: 'payment', phone: chosen?.tel ?? null, location: chosen?.location ?? null, payment: paymentDetails(method, step) }
          }

          // ---- инвайт-код
          const own = answer.kind === 'text' ? answer.text.trim() : ''
          if (!own || !codeAllowed) continue
          await prompter.progress(tx.checkingCode)
          try {
            // второй шаг JMP («Enter Referral Code») jmp-chat проходит сам
            await reg.activateWithCode(own, { currency: config.jmpCurrency })
            promoError = undefined
          } catch (error) {
            // JMP снова спрашивает код — не принял
            if (error instanceof JmpCommandError && reg.stage === 'activate') {
              // 'code rejected' — заглушка jmp-chat, когда JMP ничего не объяснил
              const reason = reg.message || (error.message === 'code rejected' ? '' : error.message)
              // реферальный код бесплатно не активирует, но работает вместе с оплатой
              if (/post-payment referral/i.test(reason)) {
                userReferral = own
                promoError = tx.referralNeedsPayment(own)
              } else {
                promoError = tx.codeRejected(own, reason)
              }
              continue
            }
            // после активации JMP показал незнакомый шаг — разберёмся на следующем круге
            if (!(error instanceof JmpError) || error instanceof JmpCommandError || reg.stage === 'activate') throw error
          }
          continue
        }

        case 'unknown': {
          const form = reg.step.form
          const values: Record<string, string[]> = {}
          for (const field of form?.fields ?? []) {
            if (field.type === 'fixed' || field.type === 'hidden' || field.var === ACTIONS_FIELD) continue
            const value = await askGeneric(prompter, form!, field)
            if (value !== null) values[field.var] = value
          }
          await prompter.progress(prompter.tx.common.second)
          await reg.submit(values)
          continue
        }
      }
    }

    throw new RegistrationError(tx.tooManySteps)
  } catch (error) {
    await reg?.cancel()
    // ошибку JMP прислал текстом (note type=error) — её и показываем человеку
    if (error instanceof JmpCommandError) throw new RegistrationError(error.message)
    throw error
  }
}

/**
 * оплата картой: JMP прислал ссылку на pay.jmp.chat и ждёт, пока человек оплатит и сохранит карту,
 * а потом скажет «next» в этой же сессии. пока JMP отвечает той же ссылкой — оплаты ещё нет.
 * «другой способ» — назад к форме активации
 */
async function payByCard(reg: Registration, step: CommandStep, prompter: Prompter, deposit: string | null): Promise<void> {
  const tx = prompter.tx.registration
  let url = stepUrls(step)[0]
  if (!url) return
  let error: string | undefined
  for (let i = 0; i < 20; i++) {
    const answer = await prompter.ask({ kind: 'payCard', url, deposit, error })
    if (answer.kind === 'option' && answer.value === PREV) {
      await reg.session.prev()
      return
    }
    await prompter.progress(tx.checkingPayment)
    await reg.session.submit({}, { action: 'next' })
    const again = reg.session.executing ? stepUrls(reg.step)[0] : undefined
    if (!again) return
    url = again
    error = tx.notPaidYet
  }
}

/** спросить у человека значение поля формы; askFilled — спрашивать и поля со значением по умолчанию */
export async function askGeneric(
  prompter: Prompter,
  form: DataForm,
  field: FormField,
  opts: { askFilled?: boolean } = {}
): Promise<string[] | null> {
  // уже заполненное и необязательное текстовое не трогаем
  if (field.values.length > 0 && !opts.askFilled) return null
  if (!field.required && field.type.startsWith('text')) return null

  let options: Choice[] = []
  const tx = prompter.tx.common
  if (field.type === 'boolean') options = [{ label: tx.yes, value: 'true' }, { label: tx.no, value: 'false' }]
  else if (field.type.startsWith('list')) options = field.options

  const answer = await prompter.ask({
    kind: 'generic',
    title: [form.title, field.label].filter(Boolean).join(' — '),
    text: [form.instructions, field.desc].filter(Boolean).join('\n\n'),
    options,
    extra: field.required ? [] : [{ label: tx.skip, value: SKIP }],
    allowText: options.length === 0
  })

  if (answer.kind === 'text') return [answer.text]
  return answer.value === SKIP ? null : [answer.value]
}
