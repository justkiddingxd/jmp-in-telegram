// привязать существующий джаббер к телеграм-юзеру:
//   node --import tsx src/cli/import.ts <tg_id> <jid> <password>
// запускать при остановленном боте (или перезапустить его после) — бот подключает аккаунты на старте
import { importAccount } from '../jmp/import.ts'

const [tgId, jid, password] = process.argv.slice(2)
if (!tgId || !jid || !password) {
  console.error('usage: import.ts <tg_id> <jid> <password>')
  process.exit(1)
}

const { account, info } = await importAccount(Number(tgId), jid, password)
console.log(`добавлен ${account.jid} (id ${account.id}) для ${tgId}: ${info?.tel ? `номер ${info.tel}, ${info.status}` : 'номера JMP нет — можно дооформить из бота'}`)
process.exit(0)
