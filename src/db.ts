import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from './config.ts'

mkdirSync(dirname(config.dbPath), { recursive: true })

const db = new DatabaseSync(config.dbPath)

db.exec(`
  PRAGMA journal_mode = WAL;

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
function addColumn(table: string, column: string, type: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!columns.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}
// сервер внешнего джаббера (null — наш ejabberd)
addColumn('accounts', 'service', 'TEXT')
// город/штат номера из выдачи JMP
addColumn('accounts', 'location', 'TEXT')
// id уведомления в телеге — чтобы реплай на него уходил SMS-ответом
addColumn('messages', 'tg_msg_id', 'INTEGER')
// напоминания о продлении номера: 1 — присылать, 0 — человек отключил
addColumn('accounts', 'reminders', 'INTEGER NOT NULL DEFAULT 1')

export type AccountStatus = 'pending' | 'active'

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
  userAccounts: db.prepare('SELECT * FROM accounts WHERE tg_id = ? ORDER BY id'),
  allAccounts: db.prepare('SELECT * FROM accounts ORDER BY id'),
  activate: db.prepare(`UPDATE accounts SET status = 'active', phone = ?, location = ? WHERE id = ?`),
  deleteAccount: db.prepare('DELETE FROM accounts WHERE id = ?'),
  deleteMessages: db.prepare('DELETE FROM messages WHERE account_id = ?'),
  setReminders: db.prepare('UPDATE accounts SET reminders = ? WHERE id = ?'),
  reminderSent: db.prepare('SELECT 1 FROM reminders_sent WHERE account_id = ? AND expires_at = ? AND days = ?'),
  markReminder: db.prepare('INSERT OR IGNORE INTO reminders_sent (account_id, expires_at, days, sent_at) VALUES (?, ?, ?, ?)'),
  deleteReminders: db.prepare('DELETE FROM reminders_sent WHERE account_id = ?'),
  insertMessage: db.prepare('INSERT INTO messages (account_id, direction, peer, body, created_at) VALUES (?, ?, ?, ?, ?)'),
  setTgMsg: db.prepare('UPDATE messages SET tg_msg_id = ? WHERE id = ?'),
  byTgMsg: db.prepare('SELECT m.* FROM messages m JOIN accounts a ON a.id = m.account_id WHERE a.tg_id = ? AND m.tg_msg_id = ?'),
  message: db.prepare('SELECT * FROM messages WHERE id = ?'),
  lastMessage: db.prepare('SELECT * FROM messages WHERE account_id = ? ORDER BY id DESC LIMIT 1'),
  messages: db.prepare('SELECT * FROM messages WHERE account_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'),
  countMessages: db.prepare('SELECT COUNT(*) AS n FROM messages WHERE account_id = ?')
}

export const accounts = {
  create(tgId: number, jid: string, password: string, service: string | null = null): Account {
    const { lastInsertRowid } = q.insertAccount.run(tgId, jid, password, service, Date.now())
    return accounts.get(Number(lastInsertRowid))!
  },
  byJid(jid: string): Account | undefined {
    return q.accountByJid.get(jid) as Account | undefined
  },
  get(id: number): Account | undefined {
    return q.account.get(id) as Account | undefined
  },
  ofUser(tgId: number): Account[] {
    return q.userAccounts.all(tgId) as unknown as Account[]
  },
  all(): Account[] {
    return q.allAccounts.all() as unknown as Account[]
  },
  activate(id: number, phone: string | null, location: string | null = null) {
    q.activate.run(phone, location, id)
  },
  setReminders(id: number, on: boolean) {
    q.setReminders.run(on ? 1 : 0, id)
  },
  /** удалить аккаунт вместе с историей SMS */
  remove(id: number) {
    db.exec('BEGIN')
    try {
      q.deleteMessages.run(id)
      q.deleteReminders.run(id)
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
  /** сообщение, уведомлением о котором является телеграм-сообщение tgMessageId */
  byTgMessage(tgId: number, tgMessageId: number): StoredMessage | undefined {
    return q.byTgMsg.get(tgId, tgMessageId) as StoredMessage | undefined
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
