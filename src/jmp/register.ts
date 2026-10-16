import { ACTIONS_FIELD, JmpCommandError, JmpError, type AvailableNumber, type DataForm, type FormField, type Registration } from 'jmp-chat'
import { config } from '../config.ts'
import type { XmppAccount } from '../xmpp/account.ts'

// регистрация в JMP — Registration из jmp-chat (ad-hoc команда `jabber:iq:register` на cheogram.com).
// выбор шлюза и fair use policy jmp-chat проходит сам; по стадиям:
//   search   — спрашиваем у человека, что искать (или «показать любые»)
//   choose   — человек выбирает номер из списка (или идёт искать заново)
//   activate — спрашиваем промокод/инвайт человека; нет своего — активируем нашим JMP_PROMO_CODE
//   unknown  — незнакомая форма: отдаём поля человеку как есть, на случай если JMP поменяет формы

export const PREV = '\0prev'
export const SKIP = '\0skip'
/** shortcut «показать любые номера» на шаге поиска */
export const ANY = '\0any'
/** на шаге активации: своего кода нет — активировать нашим промокодом */
export const OUR_CODE = '\0ours'

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
  /** свой промокод или инвайт-код текстом; значение OUR_CODE — активировать нашим */
  | { kind: 'promo', error?: string }
  /** незнакомое поле формы */
  | { kind: 'generic', title: string, text: string, options: Choice[], extra: Choice[], allowText: boolean }

/** то, как драйвер общается с человеком (реализация — в телеграме) */
export interface Prompter {
  ask(question: Question): Promise<Answer>
  progress(text: string): Promise<void>
}

export class RegistrationError extends Error {}

export interface RegistrationResult {
  phone: string | null
  location: string | null
  notes: string
}

const ERRORS: Record<string, string> = {
  'No numbers found, try another search.': 'Ничего не нашлось — попробуй другой запрос.'
}

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
  try {
    reg = await xmpp.jmp.register()

    for (let i = 0; i < 50; i++) {
      switch (reg.stage) {
        case 'done': {
          const result = reg.result()
          return { phone: result.tel, location: result.location, notes: result.notes.join('\n') }
        }

        case 'canceled':
          throw new RegistrationError('JMP отменил регистрацию')

        case 'search': {
          const message = reg.message
          const error = message && message !== SEARCH_HINT ? ERRORS[message] ?? message : undefined
          const shortcuts = canShowAny(reg) ? [{ label: 'Показать любые', value: ANY }] : []

          const answer = await prompter.ask({ kind: 'search', error, shortcuts })
          await prompter.progress('Ищу номера…')
          // ничего не нашлось — остаёмся на поиске, JMP объяснит почему в reg.message
          await reg.search(answer.kind === 'text' ? answer.text : { any: true }, { limit: config.jmpSearchLimit })
          continue
        }

        case 'choose': {
          const numbers = reg.numbers
          const answer = await prompter.ask({ kind: 'number', numbers })
          if (answer.kind === 'option' && answer.value === PREV) {
            await prompter.progress('Секунду…')
            await reg.backToSearch()
            continue
          }
          const tel = answer.kind === 'option' ? answer.value : answer.text
          await prompter.progress(`Оформляю ${numbers.find(n => n.tel === tel)?.phone ?? tel}…`)
          await reg.choose(tel)
          continue
        }

        case 'activate': {
          const methods = reg.activationMethods
          if (methods.length > 0 && !methods.some(o => o.value === 'code')) {
            throw new RegistrationError('Этот номер платный в JMP — промокодом его не активировать. Выбери другой.')
          }

          const answer = await prompter.ask({ kind: 'promo', error: promoError })
          const own = answer.kind === 'text' ? answer.text.trim() : ''
          await prompter.progress(own ? 'Проверяю твой код…' : 'Активирую номер по промокоду…')
          try {
            await reg.activateWithCode(own || config.jmpPromoCode, { currency: config.jmpCurrency })
          } catch (error) {
            // JMP снова спрашивает код — не принял промокод
            if (error instanceof JmpCommandError && reg.stage === 'activate') {
              // 'code rejected' — заглушка jmp-chat, когда JMP ничего не объяснил
              const reason = reg.message || (error.message === 'code rejected' ? '' : error.message)
              // свой код не подошёл — спросим снова на той же сессии: можно ввести другой или взять наш
              if (own) {
                promoError = `JMP не принял код ${own}${reason ? `: ${reason}` : ''}`
                continue
              }
              throw new RegistrationError(`JMP не принял промокод${reason ? `: ${reason}` : ''}`)
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
          await prompter.progress('Секунду…')
          await reg.submit(values)
          continue
        }
      }
    }

    throw new RegistrationError('Слишком много шагов регистрации')
  } catch (error) {
    await reg?.cancel()
    // ошибку JMP прислал текстом (note type=error) — её и показываем человеку
    if (error instanceof JmpCommandError) throw new RegistrationError(error.message)
    throw error
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
  if (field.type === 'boolean') options = [{ label: 'Да', value: 'true' }, { label: 'Нет', value: 'false' }]
  else if (field.type.startsWith('list')) options = field.options

  const answer = await prompter.ask({
    kind: 'generic',
    title: [form.title, field.label].filter(Boolean).join(' — '),
    text: [form.instructions, field.desc].filter(Boolean).join('\n\n'),
    options,
    extra: field.required ? [] : [{ label: 'Пропустить', value: SKIP }],
    allowText: options.length === 0
  })

  if (answer.kind === 'text') return [answer.text]
  return answer.value === SKIP ? null : [answer.value]
}
