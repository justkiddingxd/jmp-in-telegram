function env(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback
  if (value === undefined) throw new Error(`укажи ${name} в переменных окружения (.env)`)
  return value
}

function ids(name: string): Set<number> {
  return new Set(
    (process.env[name] ?? '')
      .split(',')
      .map(s => Number(s.trim()))
      .filter(n => Number.isSafeInteger(n) && n !== 0)
  )
}

export const config = {
  botToken: env('BOT_TOKEN'),

  // наш джаббер-сервер
  xmppDomain: env('XMPP_DOMAIN'),
  // куда коннектится бот (внутренний c2s-листенер ejabberd)
  xmppService: env('XMPP_SERVICE', 'xmpp://ejabberd:5223'),
  // http api ejabberd (mod_http_api), только внутри docker-сети
  ejabberdApi: env('EJABBERD_API', 'http://ejabberd:5280/api'),
  xmppDebug: process.env.XMPP_DEBUG === '1',

  // jmp
  jmpJid: env('JMP_JID', 'cheogram.com'),
  jmpPromoCode: env('JMP_PROMO_CODE'),
  // валюта баланса аккаунта JMP: USD или CAD
  jmpCurrency: env('JMP_CURRENCY', 'USD'),
  // сколько номеров просить у JMP за один поиск (у них потолок 500)
  jmpSearchLimit: Number(env('JMP_SEARCH_LIMIT', '50')),

  // ограничения
  maxNumbersPerUser: Number(env('MAX_NUMBERS_PER_USER', '1')),
  // сколько своих джабберов можно привязать одному юзеру (на каждый держим подключение)
  maxImportsPerUser: Number(env('MAX_IMPORTS_PER_USER', '3')),
  // пусто — бот открыт всем
  allowedUsers: ids('ALLOWED_USERS'),
  // сюда летят ошибки регистрации
  adminIds: ids('ADMIN_IDS'),

  dbPath: env('DB_PATH', 'data/jmpbot.db'),

  // ссылка «Исходный код» внизу главного меню; пусто — без ссылки
  sourceUrl: process.env.SOURCE_URL?.trim() ?? 'https://github.com/justkiddingxd/jmp-in-telegram'
}
