import { bold, code, format } from '@puregram/markup'
import { icon } from '../bot/icons.ts'

// все тексты интерфейса. en.ts обязан иметь те же ключи (тип Messages)

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export const ru = {
  locale: 'ru-RU',

  common: {
    back: 'Назад',
    toMenu: 'В меню',
    cancel: 'Отмена',
    tryAgain: 'Попробовать ещё раз',
    toTopUp: 'К пополнению',
    myNumbers: 'Мои номера',
    yes: 'Да',
    no: 'Нет',
    skip: 'Пропустить',
    second: 'Секунду…',
    askingJmp: 'Спрашиваю JMP…',
    failed: 'Не получилось',
    jmpNoAnswer: (reason: string) => `JMP не ответил: ${reason}`,
    numberNotFound: 'Номер не найден',
    jabberNotFound: 'Джаббер не найден',
    messageNotFound: 'Сообщение не найдено',
    notConnected: 'Номер ещё не подключён, попробуй через минуту',
    notConnectedShort: 'номер ещё не подключён',
    closedBot: 'Бот закрытый',
    refreshed: 'Обновлено'
  },

  time: {
    justNow: 'только что',
    minutesAgo: (n: number) => `${n} мин назад`,
    hoursAgo: (n: number) => `${n} ч назад`,
    yesterday: (time: string) => `вчера, ${time}`,
    days: (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')}`,
    perMonth: ' в месяц'
  },

  home: {
    noNumber: 'номер не оформлен',
    getNumber: 'Получить номер',
    finishNumber: 'Дооформить номер',
    importJabber: 'Подключить свой джаббер',
    hello: format`${icon('hello')} ${bold('Привет!')}\n\nЗдесь можно получить американский номер от JMP.chat — все SMS на него будут приходить прямо в этот чат.\n\nПодходит для кодов подтверждения: код подсвечивается и копируется одним нажатием.`,
    myNumbers: 'Мои номера',
    messagesMeta: (count: number, ago: string) => `${count} · последнее ${ago}`,
    noMessagesYet: 'сообщений пока нет',
    sourceCode: 'Исходный код'
  },

  card: {
    active: 'Активен',
    renewsOn: (date: string) => ` · продление ${date}`,
    inactive: 'неактивен',
    until: (date: string) => ` · до ${date}`,
    balance: 'Баланс',
    paidUntil: (date: string) => `Баланса хватит до ${date}`,
    notEnough: (date: string, missing: string) => `На продление ${date} не хватает ${missing}`,
    lastMessages: 'Последние сообщения',
    noMessages: 'Сообщений пока нет — как только придёт SMS, я сразу пришлю его сюда.',
    refresh: 'Обновить',
    all: (n: number) => `Все (${n})`,
    writeSms: 'Написать SMS',
    copyNumber: 'Номер',
    topUp: 'Пополнить баланс',
    reminders: 'Напоминания',
    noReminders: 'Без напоминаний',
    promo: 'Промокоды',
    credentials: 'Данные джаббера',
    unlink: 'Отвязать'
  },

  history: {
    title: ' · все сообщения',
    empty: 'Пусто'
  },

  jabber: {
    title: 'Джаббер',
    password: 'Пароль',
    server: (domain: string) => format`Сервер: ${code(domain)}, порт 5222`,
    hintOwn: (gateway: string) => `Зайди с этими данными в любой XMPP-клиент (Conversations, Monal, Gajim, Dino): SMS будут приходить и туда, и сюда, а писать можно прямо из клиента — на +15551234567@${gateway}.`,
    hintImported: 'Это твой джаббер, бот подключён к нему как ещё один клиент. Если сменишь пароль, бот перестанет получать SMS.',
    copyPassword: 'Пароль'
  },

  topUp: {
    title: 'Пополнение',
    calculator: 'Калькулятор продления',
    paidNow: (date: string) => `Сейчас оплачено до ${date} — пополни на:`,
    until: (date: string) => `до ${date}`,
    balance: 'Баланс',
    plan: 'Тариф',
    byCard: format`${icon('card')} ${bold('Картой')} — на странице JMP: там же можно привязать карту и включить автопополнение.`,
    bySavedCard: format`${icon('card')} ${bold('С привязанной карты')} — прямо отсюда, сумму выберешь на следующем шаге.`,
    byCrypto: format`${icon('crypto')} ${bold('Криптой')} — дам адрес, деньги зачислятся после подтверждения в сети.`,
    payByCard: 'Оплатить картой',
    savedCard: 'С привязанной карты',
    cardPayment: 'Оплата картой',
    cryptoTitle: (name: string) => `Пополнение ${name}`,
    gettingAddress: (name: string) => `Получаю адрес ${name}…`,
    notAccepting: (name: string) => `JMP сейчас не принимает ${name}`,
    paying: 'Оплачиваю…',
    noAnswer: 'JMP ничего не ответил'
  },

  reminder: {
    title: 'Скоро продление номера',
    when: (days: string, date: string) => `Через ${days}, ${date}.`,
    price: (price: string) => format` JMP спишет ${bold(price)} за следующий месяц.`,
    shortfall: (balance: string, missing: string) => format`${'\n'}На балансе ${bold(balance)}, не хватает ${bold(missing)}.`,
    action: 'Пополни баланс заранее, иначе номер может отключиться.',
    footer: 'Напоминаю за 7, 3, 2 и 1 день, пока на балансе не хватает на продление.',
    stop: 'Не напоминать',
    toastOn: 'Напоминания включены',
    toastOff: 'Напоминания выключены',
    noticeOn: format`${icon('bell')} Напомню о продлении за 7, 3, 2 и 1 день, если на балансе не будет хватать денег.`,
    noticeOff: format`${icon('bellOff')} Напоминания о продлении выключены. Включить обратно можно кнопкой ниже.`
  },

  referral: {
    title: 'Промокоды',
    code: 'Реферальный код',
    codeDesc: 'Кто зарегистрируется в JMP с этим кодом и оплатит, получит месяц бесплатно, а тебе начислят месяц, когда его оплата пройдёт.',
    invites: (n: number) => `Одноразовые инвайты (${n})`,
    invitesDesc: 'Каждый даёт бесплатный месяц JMP одному человеку.',
    none: 'JMP не прислал кодов.',
    jmpAnswer: 'Ответ JMP:'
  },

  unlink: {
    title: 'Отвязать джаббер?',
    body: 'Бот отключится от него, SMS перестанут приходить сюда, а история сообщений в боте удалится.',
    keep: 'Сам джаббер и номер JMP останутся у тебя — их можно будет подключить снова.',
    confirm: 'Да, отвязать',
    done: (jid: string) => format`${icon('ok')} ${bold(jid)} отвязан`
  },

  sms: {
    to: (number: string) => `на ${number}`,
    reply: 'Ответить',
    notDelivered: (peer: string, text: string) => format`${icon('warning')} SMS на ${bold(peer)} не доставлено\n\n${text}`,
    newSms: (from: string) => format`${icon('write')} ${bold('Новое SMS')} · с ${from}`,
    toPrompt: 'Кому? Пришли номер сообщением:\n\n• +15551234567 или 5551234567\n• короткий номер, например 22000',
    notANumber: format`${icon('warning')} Не похоже на номер, попробуй ещё раз.\n\n`,
    bodyPrompt: (peer: string) => format`Кому: ${bold(peer)}\n\nНапиши текст сообщения ${icon('down')}`,
    sending: 'Отправляю…',
    sent: (peer: string) => format`${icon('ok')} Отправлено на ${bold(peer)}`,
    sendFailed: (reason: string) => `Не удалось отправить: ${reason}`,
    cantReply: 'на этот номер ответить нельзя',
    notSent: (reason: string) => format`${icon('error')} Не отправилось: ${reason}`
  },

  registration: {
    connecting: 'Подключаюсь к JMP…',
    ready: format`${icon('party')} ${bold('Номер готов!')} Все SMS на него будут приходить в этот чат.`,
    cancelled: format`${icon('cancel')} Отменено`,
    paused: (reason: string) => format`${icon('wait')} Регистрация на паузе: ${reason}`,
    timedOut: 'не дождался ответа',
    failed: 'JMP не ответил или что-то сломалось. Попробуй ещё раз через минуту.',
    searchTitle: format`${icon('search')} ${bold('Новый номер')} · шаг 1 из 3`,
    searchText: format`Пришли сообщением, какой номер искать:\n\n• ${bold('512')} — код региона\n• ${bold('TX')} или ${bold('Austin, TX')} — штат или город\n• ${bold('~777')} — красивый номер, где есть 777`,
    showAny: 'Показать любые',
    searching: 'Ищу номера…',
    noNumbersFound: 'Ничего не нашлось — попробуй другой запрос.',
    nothingFoundFor: (query: string) => `По запросу «${query}» номеров нет — попробуй другой.`,
    numberTitle: format`${icon('numbers')} ${bold('Новый номер')} · шаг 2 из 3`,
    found: (n: number) => format`Нашлось ${bold(String(n))} — выбери номер`,
    searchAgain: 'Искать заново',
    taking: (phone: string) => `Оформляю ${phone}…`,
    promoTitle: format`${icon('promo')} ${bold('Новый номер')} · шаг 3 из 3`,
    promoText: (deposit: string | null, referral: string | null) => format`Есть ${bold('инвайт-код')} JMP? Пришли его сообщением — номер активируется бесплатно.\n\nИнвайта нет — активируй номер оплатой: внеси ${bold(deposit ?? 'депозит')} на баланс JMP картой или криптой. Эти деньги остаются на твоём балансе и идут в оплату номера.${referral ? format`${'\n\n'}К оплате добавлю реферальный код ${code(referral)} — он даст тебе бонусный месяц.` : ''}`,
    payCard: 'Картой',
    checkingCode: 'Проверяю твой код…',
    preparingPayment: 'Готовлю оплату…',
    referralNeedsPayment: (code: string) => `${code} — реферальный код: бесплатно номер он не активирует, но работает вместе с оплатой. Выбери способ оплаты ниже — код добавлю к ней.`,
    cardTitle: format`${icon('card')} ${bold('Оплата картой')}`,
    cardText: (deposit: string | null) => `Открой страницу JMP кнопкой ниже, внеси ${deposit ?? 'депозит'} и сохрани карту. Потом вернись сюда и нажми «Я оплатил».`,
    payByCard: 'Оплатить картой',
    paid: 'Я оплатил',
    otherMethod: 'Другой способ',
    checkingPayment: 'Проверяю оплату…',
    notPaidYet: 'JMP пока не видит оплату. Если уже оплатил — подожди минуту и нажми «Я оплатил» ещё раз.',
    paymentTitle: 'Оплата активации',
    reserved: (phone: string) => format`Номер ${bold(phone)} забронирован — осталось оплатить.`,
    paymentWait: 'Как только JMP подтвердит платёж, пришлю «Номер готов». Если уведомления долго нет — открой меню и нажми «Дооформить номер».',
    premium: 'Этот номер платный в JMP — промокодом его не активировать. Выбери другой.',
    codeRejected: (code: string, reason: string) => `JMP не принял код ${code}${reason ? `: ${reason}` : ''}`,
    jmpCancelled: 'JMP отменил регистрацию',
    unpaid: (number: string, status: string) => `Номер ${number} не оплачен (статус в JMP: ${status}). Пополни по нему баланс — тогда можно будет взять ещё один.`,
    tooManySteps: 'Слишком много шагов регистрации'
  },

  prompt: {
    stale: 'Этот вопрос уже неактуален — открой /start',
    noOption: 'Нет такого варианта',
    useButtons: 'выбери вариант кнопкой'
  },

  import: {
    title: format`${icon('link')} ${bold('Свой джаббер')}`,
    intro: 'Можно подключить джаббер, который у тебя уже есть, например с номером JMP: SMS на него будут приходить в этот чат.\n\nПришли JID, например name@server.org',
    notAJid: format`${icon('warning')} Не похоже на JID, нужно вида name@server.org\n\n`,
    passwordPrompt: (jid: string) => format`JID: ${bold(jid)}\n\nТеперь пароль. Сообщение с ним я сразу удалю.`,
    loggingIn: 'Захожу в джаббер и спрашиваю JMP…',
    linkedActive: (jid: string) => format`${icon('ok')} ${bold(jid)} подключён — SMS на него будут приходить сюда.`,
    linkedPending: (jid: string) => format`${icon('ok')} ${bold(jid)} подключён. Номера JMP на нём нет — его можно оформить кнопкой ниже.`,
    usage: 'Формат: /import jid пароль',
    limit: (n: number) => `Можно подключить не больше ${n} своих джабберов`,
    addedWithNumber: (jid: string, phone: string) => format`${icon('ok')} ${bold(jid)} добавлен, номер ${bold(phone)}`,
    addedNoNumber: (jid: string) => format`${icon('ok')} ${bold(jid)} добавлен, номера JMP на нём нет — можно оформить из /start`,
    wrongCredentials: 'неверный JID или пароль',
    cantConnect: (domain: string) => `не удалось подключиться к серверу ${domain}`,
    loginFailed: (reason: string) => `не удалось войти: ${reason}`,
    badJid: 'не похоже на JID, нужно вида name@server.org',
    alreadyAdded: (jid: string) => `${jid} уже добавлен в бота`,
    noAnswer: (domain: string) => `сервер ${domain} не ответил`,
    noJmpNumber: 'на этом джаббере нет номера JMP'
  },

  admin: {
    registrationFailed: (userId: number, reason: string) => `регистрация ${userId}: ${reason}`
  },

  access: {
    button: (n: number) => `Доступ (${n})`,
    title: 'Общий доступ',
    nobody: 'Кроме тебя, этим номером никто не пользуется.',
    hint: 'Эти люди получают SMS с номера и могут всё то же, что и ты. Доступ они получили по твоему разрешению.',
    revoke: (name: string) => `Отозвать: ${name}`,
    unlinkNote: 'Общий доступ у всех, кому ты его давал, тоже пропадёт.',
    leaveTitle: 'Убрать номер у себя?',
    leaveBody: 'Ты перестанешь получать SMS с этого номера, а у владельца и остальных всё останется как было.',
    request: (who: string, id: number, jid: string, number: string) => format`${icon('group')} ${bold('Запрос доступа')}

${who} (id ${code(String(id))}) хочет пользоваться джаббером ${bold(jid)} · ${number}.

Пароль от него он знает — бот проверил вход. С доступом он будет получать SMS и сможет всё то же, что и ты.`,
    approve: 'Разрешить',
    deny: 'Отклонить',
    requestSent: (jid: string) => format`${icon('wait')} ${bold(jid)} уже подключён у другого человека. Я отправил ему запрос — как только он разрешит, номер появится у тебя.`,
    requestPending: (jid: string) => format`${icon('wait')} Запрос доступа к ${bold(jid)} уже отправлен владельцу, жду его ответа.`,
    approvedOwner: (who: string) => format`${icon('ok')} Доступ выдан: ${who}`,
    deniedOwner: (who: string) => format`${icon('cancel')} Запрос отклонён: ${who}`,
    granted: (jid: string) => format`${icon('ok')} Владелец разрешил доступ к ${bold(jid)} — номер теперь в твоём меню. Открой /start.`,
    denied: (jid: string) => format`${icon('cancel')} Владелец отклонил запрос доступа к ${bold(jid)}.`,
    revoked: (name: string) => format`${icon('ok')} Доступ отозван: ${name}`,
    revokedMember: (jid: string) => format`${icon('unlink')} Владелец закрыл тебе доступ к ${bold(jid)}.`,
    left: (jid: string) => format`${icon('ok')} ${bold(jid)} убран из твоего меню.`,
    ownerUnlinked: (jid: string) => format`${icon('unlink')} Владелец отвязал ${bold(jid)} от бота — номер пропал и из твоего меню.`,
    requestGone: 'Запрос уже неактуален',
    alreadyHave: (jid: string) => `${jid} уже есть в твоём меню`
  },

  language: {
    /** подпись кнопки — название другого языка на нём самом */
    switchTo: 'English',
    changed: format`${icon('language')} Язык интерфейса: русский. Вернуть английский можно кнопкой внизу меню или командой /lang.`
  },

  commands: {
    start: 'Панель номеров',
    cancel: 'Отменить текущий шаг',
    lang: 'Сменить язык / Change language'
  }
}

export type Messages = typeof ru
