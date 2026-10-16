import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// пароли джабберов в базе шифруются AES-256-GCM ключом SECRET_KEY из окружения.
// утёкшая база (бэкап, копия data/) без ключа паролей не раскрывает.
// jid записи идёт в AAD: шифротекст нельзя молча переставить в чужую строку

const PREFIX = 'enc:v1:'

export class SecretBox {
  private readonly key: Buffer

  constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, 'base64')
    if (this.key.length !== 32) {
      throw new Error('SECRET_KEY must be 32 bytes in base64 — generate one with: openssl rand -base64 32')
    }
  }

  static isEncrypted(value: string): boolean {
    return value.startsWith(PREFIX)
  }

  encrypt(plain: string, context: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(context))
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    return PREFIX + [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join(':')
  }

  decrypt(value: string, context: string): string {
    if (!SecretBox.isEncrypted(value)) throw new Error('value is not encrypted')
    const [iv, tag, data] = value.slice(PREFIX.length).split(':').map(p => Buffer.from(p, 'base64'))
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv!)
    decipher.setAAD(Buffer.from(context))
    decipher.setAuthTag(tag!)
    return Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8')
  }
}
