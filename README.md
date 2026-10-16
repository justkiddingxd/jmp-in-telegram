# jmp-in-telegram

**English** | [Русский](README.ru.md)

A Telegram bot for [JMP.chat](https://jmp.chat) phone numbers: people get a panel in Telegram with their numbers and incoming SMS (verification codes are highlighted and copied with one tap). From the bot they can also send SMS, check the balance, top it up and get a reminder before the number renews.

All JMP work lives in a separate library, [`jmp-chat`](https://github.com/justkiddingxd/jmp-chat) ([npm](https://www.npmjs.com/package/jmp-chat)).

## How it works

```
Telegram ── bot (puregram) ── one XMPP client per number ── our ejabberd ══ s2s ══ cheogram.com (JMP)
```

1. "Get a number" → the bot creates a Jabber account `tg<id>-xxxxxx@XMPP_DOMAIN` through the ejabberd HTTP API.
2. The bot logs into that account and runs the `jabber:iq:register` ad-hoc command on `cheogram.com`. This is the regular JMP signup:
   - number search: the person sends an area code or taps "Show any";
   - picking a number from the list (Telegram buttons);
   - fair use policy: the bot accepts it on its own;
   - activation: the bot asks for the person's own JMP promo or invite code. They can send it or tap "No code", and then the bot uses **our promo code `JMP_PROMO_CODE`**. If JMP rejects the person's code, the bot asks again and says why. The bot sets `activation_method=code` and the `JMP_CURRENCY` plan itself.
3. Once the number is ready, SMS arrive at the Jabber account from `+1XXXXXXXXXX@cheogram.com` and the bot forwards them to Telegram.

Steps the bot doesn't know (in case JMP changes its forms) are shown to the person as they are, as buttons or a text question, so the signup never breaks silently.

If someone abandons the signup halfway, the menu shows "Finish signing up". The same Jabber account is reused, and JMP remembers the number picked on it.

## Your own Jabber accounts

An existing Jabber account on any server can be connected to the bot, for example one that already has a JMP number:

- the "Connect my Jabber" button (on the home screen or the number card): the bot asks for the JID and password and deletes the password message right away;
- or the `/import jid password` command (that message is deleted too);
- from the console (restart the bot afterwards):
  ```bash
  docker compose run --rm bot node --import tsx src/cli/import.ts <tg_id> <jid> <password>
  ```

The bot checks the password and asks JMP whether the account has a number. An account without a number is connected only if the person can still get a number from the bot (below `MAX_NUMBERS_PER_USER` and no other unfinished signup). Only accounts on public domains are accepted (IPs and internal names like `ejabberd` are rejected). Each person can connect up to `MAX_IMPORTS_PER_USER` of their own accounts.

A connected account can be removed with "Disconnect" on the number card (with a confirmation): the bot disconnects from it and deletes the account and its SMS history from its database. The Jabber account and the JMP number stay with the person. Accounts the bot created on our server can't be disconnected this way.

`MAX_NUMBERS_PER_USER` limits only numbers obtained through the bot's signup: a connected Jabber account that already has its own JMP number doesn't take up the limit. Admins are limited by neither `MAX_NUMBERS_PER_USER` nor `MAX_IMPORTS_PER_USER`.

## Shared access

One Jabber account can be used by several people. If someone tries to connect a Jabber account that is already linked by another person, the bot first checks the password with a real login (so nobody can spam the owner knowing just the JID), then sends the owner a request with "Allow" / "Decline" buttons. Once allowed, the number appears in the requester's menu with full access: incoming SMS go to everyone, and members can send SMS, see the history, top up, see promo codes, the Jabber login screen and renewal reminders.

- The owner sees "Access (N)" on the number card: the list of people with access and a "Revoke" button for each.
- A member's "Disconnect" removes the number only from their own menu.
- When the owner disconnects the Jabber account, everyone loses it and members get a notice.
- Shared numbers don't count towards a member's `MAX_NUMBERS_PER_USER` / `MAX_IMPORTS_PER_USER`.
- Each person sees the bot in their own language.

## Jabber login

The number card has a "Jabber login" button: JID, password (under a spoiler, with copy buttons) and server. With them you can log into the account with any XMPP client (Conversations, Monal, Gajim, Dino); port 5222 has to be open on the server for that. SMS then arrive both in the client and in the bot. `mod_register` is not enabled on the server, so the password can't be changed from a client and the bot never loses access.

## Balance and top-ups

The number card shows the JMP account balance (from the `info` command) and the JID the number is attached to. "Top up" opens the payment options, all of them going straight to JMP:

- **by card**: a personal pay.jmp.chat link (the JMP `credit cards` command) where you can pay, save a card and turn on auto top-up;
- **with a saved card**: once a card is saved, JMP offers the `top up` command. The bot walks through its forms in Telegram and always asks the person for the amount;
- **with crypto** (Bitcoin, Bitcoin Cash, Monero, Ethereum): the bot gets an address via `alt top up` and shows it with a copy button.

## Promo codes

"Promo codes" on the number card shows the output of the JMP `referral codes` command: the reusable referral code (a friend gets a month after paying, the owner gets a month once the friend's payment clears) and single-use invites, if there are any. Each code has a copy button; JMP's original text sits in a collapsed quote.

## Renewal reminders

Once an hour the bot checks every number's renewal date and balance. If the renewal is 7, 3, 2 or 1 day away and the balance doesn't cover the next month, the person gets a reminder: when it renews, how much JMP will charge and how much is missing, with "Top up" and "Stop reminding" buttons.

- If the balance is enough, no reminders are sent: JMP renews the number itself.
- Each reminder is sent once. If the bot was down on the right day, it sends the nearest one instead: e.g. "2 days" instead of a missed "3 days".
- Reminders can be turned off and back on with the "Reminders" button on the number card.

## Languages

The bot speaks English and Russian. The language comes from the person's Telegram settings: Telegram in Russian gets the Russian interface, everyone else gets English. The language is stored in the database, so SMS notifications and reminders arrive in it too. For people the bot hasn't seen yet, `DEFAULT_LANG` applies (`en` by default). The Telegram command menu is localized as well.

Anyone can switch the language manually with the "🌐 Русский" / "🌐 English" button at the bottom of the home screen or the `/lang` command. A manual choice sticks: automatic detection no longer overrides it, and the bot's command menu in that chat switches too.

All texts live in `src/i18n/en.ts` and `src/i18n/ru.ts`. The English dictionary must match the Russian one by type, so a missing string won't compile.

## Custom emoji

Icons in messages and on buttons are custom emoji from the [Telegram Android Icons](https://t.me/addemoji/TgAndroidIcons) pack; their IDs are in `src/bot/icons.ts`. Telegram only shows custom emoji from a bot if the bot owner has Telegram Premium (or the bot bought a username on Fragment); otherwise the regular fallback emoji are shown silently.

## Deploy

You need a server with a public IP and a domain for Jabber (e.g. `xmpp.example.com`).

1. DNS: an A record `xmpp.example.com` → the server IP.
2. Open ports **5269** (s2s, cheogram.com connects through it), **80** (Let's Encrypt certificate), and optionally 5222 (to log into accounts with a regular client).
3. `cp .env.example .env` and fill in `BOT_TOKEN`, `XMPP_DOMAIN`, `ACME_EMAIL`, `JMP_PROMO_CODE` and `SECRET_KEY` (`openssl rand -base64 32`). `SOURCE_URL` is the "Source code" link at the bottom of the home screen (an empty string removes it), `DEFAULT_LANG` is the fallback language.
4. Start:
   ```bash
   docker compose up -d --build
   ```
5. Check that the certificate was issued (cheogram.com won't talk to a server without valid TLS):
   ```bash
   docker compose exec ejabberd ejabberdctl list_certificates
   ```

The internal c2s port (5223) and the ejabberd HTTP API (5280) are not published: only the bot uses them inside the Docker network. The server has no public registration; only the bot creates accounts.

## Running the bot locally

```bash
npm i
npm run typecheck
npm start
```

`XMPP_DEBUG=1` prints all XMPP traffic to the console. That's useful if JMP changed its signup forms and you need to see what it sends.

## The jmp-chat library

Everything about JMP (SMS, ad-hoc commands, forms, numbers ↔ gateway JIDs, code extraction, balance, top-ups, signup) lives in [`jmp-chat`](https://github.com/justkiddingxd/jmp-chat), installed from npm. To update: `npm i jmp-chat@latest`, then rebuild the image with `docker compose up -d --build bot`.

## Layout

| file | what it does |
|---|---|
| `src/bot/ui.ts` | screens: home, number card, history, SMS notifications |
| `src/bot/panel.ts` | handlers, signup and SMS flows, incoming messages, `/import` |
| `src/bot/prompt.ts` | questions to the person (buttons/text) in the panel, paging long lists |
| `src/i18n/` | interface texts: `en.ts`, `ru.ts`, and language selection from Telegram (`index.ts`) |
| `src/bot/icons.ts` | custom emoji IDs, `icon()` for text and `withIcon()` for buttons |
| `src/bot/reminders.ts` | hourly renewal check and reminders |
| `src/jmp/renewal.ts` | when to remind: 7/3/2/1-day thresholds, whether the balance is enough |
| `src/jmp/info.ts` | JMP account status cache (`jmp.account.info()`: active, balance, renewal date) |
| `src/jmp/import.ts` | connecting an existing Jabber account |
| `src/jmp/topup.ts` | JMP top-ups on top of `jmp.topUp`: questions and result display |
| `src/jmp/register.ts` | signup on top of jmp-chat's `Registration`: search / choose / activate stages → Telegram questions, promo code |
| `src/xmpp/account.ts` | an account's XMPP connection + `JmpClient.attach()` on it (SMS, ad-hoc commands) |
| `src/xmpp/ejabberd.ts` | creating accounts through mod_http_api |
| `src/xmpp/pool.ts` | the pool of all account connections |
| `src/db.ts` | sqlite (`node:sqlite`): accounts, shared access and requests, SMS history and per-recipient notifications, sent reminders, user languages |
| `ejabberd/ejabberd.yml` | Jabber server config |

## Limitations

- The bot has to remember Jabber passwords to log in, so it keeps them in sqlite **encrypted** (AES-256-GCM, key `SECRET_KEY` from `.env`). A leaked database or backup doesn't reveal them without the key. If both the database and `.env` leak (i.e. the whole server), the passwords can be recovered: this doesn't protect against a compromised server. Keep the key away from `data/` backups.
- ejabberd stores our accounts' passwords only as SCRAM hashes (`auth_stored_password_types`). If the server ran with an older config, `ejabberd/drop-plain-passwords.sh` removes leftover plain passwords (the order of steps is in the script header).
- The SASL exchange is not written to the debug log (`XMPP_DEBUG=1`): with PLAIN login it would contain the password.
- Each number keeps its own XMPP connection. A few hundred numbers are fine; thousands would need a redesign.
- Premium numbers can't be activated with a promo code. The bot asks to pick another number.
