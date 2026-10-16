import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from './config.ts'
import { SecretBox } from './secret.ts'

mkdirSync(dirname(config.dbPath), { recursive: true })

const db = new DatabaseSync(config.dbPath)
const box = new SecretBox(config.secretKey)

db.exec(`
  PRAGMA journal_mode = WAL;
  -- удалённое и перезаписанное (старые пароли) затирается нулями, а не остаётся в свободных страницах
  PRAGMA secure_delete = ON;

  CREATE TABLE IF NOT EXISTS accounts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id      INTEGER NOT NULL,
    jid        TEXT    NOT NULL UNIQUE,
    password   TEXT    NOT NULL,
    phone      TEXT,
    -- pending: джаббер создан, регистрация в JMP не завершена; active: номер выдан
    status     TEXT    NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS accounts_tg ON accounts (tg_id);

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts (id),
    direction  TEXT    NOT NULL, -- in | out
    peer       TEXT    NOT NULL, -- номер собеседника, либо jid сервиса
    body       TEXT    NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_account ON messages (account_id, id);

  -- язык интерфейса юзера: по language_code из телеги, чтобы и фоновые уведомления шли на нём
  CREATE TABLE IF NOT EXISTS users (
    tg_id INTEGER PRIMARY KEY,
    lang  TEXT    NOT NULL
  );

  -- общий доступ: кроме владельца (accounts.tg_id) джаббером пользуются эти люди
  CREATE TABLE IF NOT EXISTS account_members (
    account_id INTEGER NOT NULL,
    tg_id      INTEGER NOT NULL,
    added_at   INTEGER NOT NULL,
    PRIMARY KEY (account_id, tg_id)
  );
  CREATE INDEX IF NOT EXISTS account_members_tg ON account_members (tg_id);

  -- запросы доступа к уже привязанному джабберу: pending → approved / denied
  CREATE TABLE IF NOT EXISTS access_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id   INTEGER NOT NULL,
    tg_id        INTEGER NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'pending',
    owner_msg_id INTEGER,
    created_at   INTEGER NOT NULL
  );

  -- уведомления о SMS у каждого получателя: реплай на любое из них уходит ответом на это SMS
  CREATE TABLE IF NOT EXISTS notifications (
    message_id INTEGER NOT NULL,
    tg_id      INTEGER NOT NULL,
    tg_msg_id  INTEGER NOT NULL,
    PRIMARY KEY (tg_id, tg_msg_id)
  );

  -- отправленные напоминания о продлении: одно на (аккаунт, дата продления, порог в днях)
  CREATE TABLE IF NOT EXISTS reminders_sent (
    account_id INTEGER NOT NULL,
    expires_at TEXT    NOT NULL,
    days       INTEGER NOT NULL,
    sent_at    INTEGER NOT NULL,
    PRIMARY KEY (account_id, expires_at, days)
  );
`)

// миграции: колонки, добавленные позже
/** true — колонку только что добавили (можно заполнить старые строки) */
function addColumn(table: string, column: string, type: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (columns.some(c => c.name === column)) return false
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  return true
}
// сервер внешнего джаббера (null — наш ejabberd)
addColumn('accounts', 'service', 'TEXT')
// город/штат номера из выдачи JMP
addColumn('accounts', 'location', 'TEXT')
// id уведомления в телеге — чтобы реплай на него уходил SMS-ответом
addColumn('messages', 'tg_msg_id', 'INTEGER')
// язык выбран вручную (кнопкой / командой) — автоопределение по телеге его не перебивает
addColumn('users', 'manual', 'INTEGER NOT NULL DEFAULT 0')
// имя и @username из телеги — показать владельцу, кто просит доступ
addColumn('users', 'name', 'TEXT')
// номер оформлен через бота (нашей регистрацией) — только такие считаются в MAX_NUMBERS_PER_USER;
// подключённые свои джабберы с готовым номером лимит не занимают
if (addColumn('accounts', 'via_bot', 'INTEGER NOT NULL DEFAULT 0')) {
  // до этой колонки номера через бота оформлялись только на наших аккаунтах
  db.exec(`UPDATE accounts SET via_bot = 1 WHERE service IS NULL AND status = 'active'`)
}
// напоминания о продлении номера: 1 — присылать, 0 — человек отключил
addColumn('accounts', 'reminders', 'INTEGER NOT NULL DEFAULT 1')

// миграция: пароли, записанные до шифрования, шифруем на месте
{
  const rows = db.prepare('SELECT id, jid, password FROM accounts').all() as { id: number, jid: string, password: string }[]
  const plain = rows.filter(r => !SecretBox.isEncrypted(r.password))
  if (plain.length > 0) {
    const update = db.prepare('UPDATE accounts SET password = ? WHERE id = ?')
    db.exec('BEGIN')
    try {
      for (const r of plain) update.run(box.encrypt(r.password, r.jid), r.id)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    // старые значения ещё лежат в WAL и свободных страницах файла — переписываем базу начисто
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.exec('VACUUM')
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    console.log(`[db] зашифровано паролей: ${plain.length}`)
  }
}

export type AccountStatus = 'pending' | 'active'

// пароль в базе зашифрован; наружу Account отдаётся уже с расшифрованным
type AccountRow = Account

function decryptRow(row: AccountRow | undefined): Account | undefined {
  return row && { ...row, password: box.decrypt(row.password, row.jid) }
}

export interface Account {
  id: number
  tg_id: number
  jid: string
  password: string
  phone: string | null
  status: AccountStatus
  service: string | null
  location: string | null
  /** 1 — присылать напоминания о продлении */
  reminders: number
  /** 1 — номер оформлен регистрацией через бота (занимает лимит MAX_NUMBERS_PER_USER) */
  via_bot: number
  created_at: number
}

export interface StoredMessage {
  id: number
  account_id: number
  direction: 'in' | 'out'
  peer: string
  body: string
  tg_msg_id: number | null
  created_at: number
}

const q = {
  insertAccount: db.prepare('INSERT INTO accounts (tg_id, jid, password, service, created_at) VALUES (?, ?, ?, ?, ?)'),
  accountByJid: db.prepare('SELECT * FROM accounts WHERE jid = ?'),
  account: db.prepare('SELECT * FROM accounts WHERE id = ?'),
  ownedAccounts: db.prepare('SELECT * FROM accounts WHERE tg_id = ? ORDER BY id'),
  userAccounts: db.prepare('SELECT * FROM accounts WHERE tg_id = ? OR id IN (SELECT account_id FROM account_members WHERE tg_id = ?) ORDER BY id'),
  members: db.prepare('SELECT tg_id FROM account_members WHERE account_id = ? ORDER BY added_at'),
  isMember: db.prepare('SELECT 1 FROM account_members WHERE account_id = ? AND tg_id = ?'),
  addMember: db.prepare('INSERT OR IGNORE INTO account_members (account_id, tg_id, added_at) VALUES (?, ?, ?)'),
  removeMember: db.prepare('DELETE FROM account_members WHERE account_id = ? AND tg_id = ?'),
  deleteMembers: db.prepare('DELETE FROM account_members WHERE account_id = ?'),
  deleteRequests: db.prepare('DELETE FROM access_requests WHERE account_id = ?'),
  deleteNotifications: db.prepare('DELETE FROM notifications WHERE message_id IN (SELECT id FROM messages WHERE account_id = ?)'),
  allAccounts: db.prepare('SELECT * FROM accounts ORDER BY id'),
  activate: db.prepare(`UPDATE accounts SET status = 'active', phone = ?, location = ?, via_bot = ? WHERE id = ?`),
  reserve: db.prepare('UPDATE accounts SET phone = ?, location = ? WHERE id = ?'),
  deleteAccount: db.prepare('DELETE FROM accounts WHERE id = ?'),
  deleteMessages: db.prepare('DELETE FROM messages WHERE account_id = ?'),
  setReminders: db.prepare('UPDATE accounts SET reminders = ? WHERE id = ?'),
  reminderSent: db.prepare('SELECT 1 FROM reminders_sent WHERE account_id = ? AND expires_at = ? AND days = ?'),
  markReminder: db.prepare('INSERT OR IGNORE INTO reminders_sent (account_id, expires_at, days, sent_at) VALUES (?, ?, ?, ?)'),
  deleteReminders: db.prepare('DELETE FROM reminders_sent WHERE account_id = ?'),
  insertMessage: db.prepare('INSERT INTO messages (account_id, direction, peer, body, created_at) VALUES (?, ?, ?, ?, ?)'),
  setTgMsg: db.prepare('UPDATE messages SET tg_msg_id = ? WHERE id = ?'),
  addNotification: db.prepare('INSERT OR REPLACE INTO notifications (message_id, tg_id, tg_msg_id) VALUES (?, ?, ?)'),
  byNotification: db.prepare('SELECT m.* FROM messages m JOIN notifications n ON n.message_id = m.id WHERE n.tg_id = ? AND n.tg_msg_id = ?'),
  // уведомления до общего доступа — в messages.tg_msg_id у владельца
  byTgMsg: db.prepare('SELECT m.* FROM messages m JOIN accounts a ON a.id = m.account_id WHERE a.tg_id = ? AND m.tg_msg_id = ?'),
  message: db.prepare('SELECT * FROM messages WHERE id = ?'),
  lastMessage: db.prepare('SELECT * FROM messages WHERE account_id = ? ORDER BY id DESC LIMIT 1'),
  messages: db.prepare('SELECT * FROM messages WHERE account_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'),
  countMessages: db.prepare('SELECT COUNT(*) AS n FROM messages WHERE account_id = ?')
}

export const accounts = {
  create(tgId: number, jid: string, password: string, service: string | null = null): Account {
    const { lastInsertRowid } = q.insertAccount.run(tgId, jid, box.encrypt(password, jid), service, Date.now())
    return accounts.get(Number(lastInsertRowid))!
  },
  byJid(jid: string): Account | undefined {
    return decryptRow(q.accountByJid.get(jid) as AccountRow | undefined)
  },
  get(id: number): Account | undefined {
    return decryptRow(q.account.get(id) as AccountRow | undefined)
  },
  /** свои и общие (по доступу) аккаунты */
  ofUser(tgId: number): Account[] {
    return (q.userAccounts.all(tgId, tgId) as unknown as AccountRow[]).map(r => decryptRow(r)!)
  },
  /** только свои: для лимитов и недооформленной регистрации */
  ownedBy(tgId: number): Account[] {
    return (q.ownedAccounts.all(tgId) as unknown as AccountRow[]).map(r => decryptRow(r)!)
  },
  /** участники с общим доступом (без владельца) */
  members(accountId: number): number[] {
    return (q.members.all(accountId) as { tg_id: number }[]).map(r => r.tg_id)
  },
  /** владелец и все участники — кому слать SMS и напоминания */
  recipients(account: Account): number[] {
    return [account.tg_id, ...accounts.members(account.id)]
  },
  hasAccess(account: Account, tgId: number): boolean {
    return account.tg_id === tgId || q.isMember.get(account.id, tgId) !== undefined
  },
  addMember(accountId: number, tgId: number) {
    q.addMember.run(accountId, tgId, Date.now())
  },
  removeMember(accountId: number, tgId: number) {
    q.removeMember.run(accountId, tgId)
  },
  all(): Account[] {
    return (q.allAccounts.all() as unknown as AccountRow[]).map(r => decryptRow(r)!)
  },
  /** номер выбран, но JMP ждёт оплату: аккаунт остаётся pending, номер запоминаем для экранов */
  reserve(id: number, phone: string | null, location: string | null) {
    q.reserve.run(phone, location, id)
  },
  /** viaBot — номер оформлен регистрацией через бота, а не пришёл готовым с подключённым джаббером */
  activate(id: number, phone: string | null, location: string | null = null, viaBot = false) {
    q.activate.run(phone, location, viaBot ? 1 : 0, id)
  },
  setReminders(id: number, on: boolean) {
    q.setReminders.run(on ? 1 : 0, id)
  },
  /** удалить аккаунт вместе с историей SMS */
  remove(id: number) {
    db.exec('BEGIN')
    try {
      q.deleteNotifications.run(id)
      q.deleteMessages.run(id)
      q.deleteReminders.run(id)
      q.deleteMembers.run(id)
      q.deleteRequests.run(id)
      q.deleteAccount.run(id)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

export const messages = {
  add(accountId: number, direction: 'in' | 'out', peer: string, body: string): number {
    return Number(q.insertMessage.run(accountId, direction, peer, body, Date.now()).lastInsertRowid)
  },
  setTgMessage(id: number, tgMessageId: number) {
    q.setTgMsg.run(tgMessageId, id)
  },
  /** запомнить уведомление о сообщении у конкретного получателя */
  addNotification(id: number, tgId: number, tgMessageId: number) {
    q.addNotification.run(id, tgId, tgMessageId)
  },
  /** сообщение, уведомлением о котором является телеграм-сообщение tgMessageId */
  byTgMessage(tgId: number, tgMessageId: number): StoredMessage | undefined {
    return (q.byNotification.get(tgId, tgMessageId) ?? q.byTgMsg.get(tgId, tgMessageId)) as StoredMessage | undefined
  },
  get(id: number): StoredMessage | undefined {
    return q.message.get(id) as StoredMessage | undefined
  },
  last(accountId: number): StoredMessage | undefined {
    return q.lastMessage.get(accountId) as StoredMessage | undefined
  },
  page(accountId: number, limit: number, offset = 0): StoredMessage[] {
    return q.messages.all(accountId, limit, offset) as unknown as StoredMessage[]
  },
  count(accountId: number): number {
    return (q.countMessages.get(accountId) as { n: number }).n
  }
}

export const reminders = {
  wasSent(accountId: number, expiresAt: string, days: number): boolean {
    return q.reminderSent.get(accountId, expiresAt, days) !== undefined
  },
  markSent(accountId: number, expiresAt: string, days: number) {
    q.markReminder.run(accountId, expiresAt, days, Date.now())
  }
}

const qUsers = {
  name: db.prepare('SELECT name FROM users WHERE tg_id = ?'),
  setName: db.prepare(`INSERT INTO users (tg_id, lang, name) VALUES (?, '', ?) ON CONFLICT (tg_id) DO UPDATE SET name = excluded.name`),
  get: db.prepare('SELECT lang, manual FROM users WHERE tg_id = ?'),
  setLang: db.prepare('INSERT INTO users (tg_id, lang, manual) VALUES (?, ?, ?) ON CONFLICT (tg_id) DO UPDATE SET lang = excluded.lang, manual = excluded.manual')
}

export const users = {
  /** язык юзера и выбран ли он вручную */
  get(tgId: number): { lang: string, manual: boolean } | undefined {
    const row = qUsers.get.get(tgId) as { lang: string, manual: number } | undefined
    return row && { lang: row.lang, manual: row.manual === 1 }
  },
  setLang(tgId: number, lang: string, manual = false) {
    qUsers.setLang.run(tgId, lang, manual ? 1 : 0)
  },
  name(tgId: number): string | null {
    return (qUsers.name.get(tgId) as { name: string | null } | undefined)?.name ?? null
  },
  setName(tgId: number, name: string) {
    qUsers.setName.run(tgId, name)
  }
}

export type RequestStatus = 'pending' | 'approved' | 'denied'

export interface AccessRequest {
  id: number
  account_id: number
  tg_id: number
  status: RequestStatus
  owner_msg_id: number | null
  created_at: number
}

const qRequests = {
  pending: db.prepare(`SELECT * FROM access_requests WHERE account_id = ? AND tg_id = ? AND status = 'pending'`),
  insert: db.prepare('INSERT INTO access_requests (account_id, tg_id, created_at) VALUES (?, ?, ?)'),
  get: db.prepare('SELECT * FROM access_requests WHERE id = ?'),
  setStatus: db.prepare('UPDATE access_requests SET status = ? WHERE id = ?'),
  setOwnerMsg: db.prepare('UPDATE access_requests SET owner_msg_id = ? WHERE id = ?')
}

export const accessRequests = {
  /** открытый запрос этого человека к этому аккаунту, если есть */
  pending(accountId: number, tgId: number): AccessRequest | undefined {
    return qRequests.pending.get(accountId, tgId) as AccessRequest | undefined
  },
  create(accountId: number, tgId: number): AccessRequest {
    const { lastInsertRowid } = qRequests.insert.run(accountId, tgId, Date.now())
    return accessRequests.get(Number(lastInsertRowid))!
  },
  get(id: number): AccessRequest | undefined {
    return qRequests.get.get(id) as AccessRequest | undefined
  },
  setStatus(id: number, status: RequestStatus) {
    qRequests.setStatus.run(status, id)
  },
  setOwnerMessage(id: number, messageId: number) {
    qRequests.setOwnerMsg.run(messageId, id)
  }
}
