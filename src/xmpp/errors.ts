// ошибки подключения бывают «пустыми»: AggregateError от net.connect (перебор IPv6/IPv4) без message,
// ошибки xmpp.js с condition вместо текста. раскрываем всё, что есть, чтобы в логе была причина

interface ErrorLike {
  name?: string
  message?: string
  code?: string
  condition?: string
  text?: string
  address?: string
  port?: number
  errors?: unknown[]
  cause?: unknown
}

export function describeError(error: unknown, depth = 0): string {
  if (!error || typeof error !== 'object') return String(error)
  const e = error as ErrorLike
  // таймаут xmpp.js приходит без текста
  if (e.name === 'TimeoutError' && !e.message) return 'TimeoutError: сервер не ответил вовремя'
  const parts = [
    e.name && e.name !== 'Error' ? e.name : null,
    e.code ?? null,
    e.condition ?? null,
    e.message || e.text || null,
    e.address && !e.message?.includes(e.address) ? `${e.address}${e.port ? `:${e.port}` : ''}` : null
  ].filter((p, i, all): p is string => Boolean(p) && all.indexOf(p) === i)

  let text = parts.join(' ') || 'неизвестная ошибка'
  if (depth < 2 && Array.isArray(e.errors) && e.errors.length > 0) {
    text += ` [${e.errors.map(inner => describeError(inner, depth + 1)).join('; ')}]`
  }
  if (depth < 2 && e.cause) text += ` (причина: ${describeError(e.cause, depth + 1)})`
  return text
}
