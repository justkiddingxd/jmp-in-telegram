import { bold, code, format } from '@puregram/markup'
import { icon } from '../bot/icons.ts'
import type { Messages } from './ru.ts'

export const en: Messages = {
  locale: 'en-US',

  common: {
    back: 'Back',
    toMenu: 'Menu',
    cancel: 'Cancel',
    tryAgain: 'Try again',
    toTopUp: 'Back to top-up',
    myNumbers: 'My numbers',
    yes: 'Yes',
    no: 'No',
    skip: 'Skip',
    second: 'One moment…',
    askingJmp: 'Asking JMP…',
    failed: 'Something went wrong',
    jmpNoAnswer: (reason: string) => `JMP didn't answer: ${reason}`,
    numberNotFound: 'Number not found',
    jabberNotFound: 'Jabber account not found',
    messageNotFound: 'Message not found',
    notConnected: 'This number is not connected yet, try again in a minute',
    notConnectedShort: 'the number is not connected yet',
    closedBot: 'This bot is private',
    refreshed: 'Updated'
  },

  time: {
    justNow: 'just now',
    minutesAgo: (n: number) => `${n} min ago`,
    hoursAgo: (n: number) => `${n} h ago`,
    yesterday: (time: string) => `yesterday, ${time}`,
    days: (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`,
    perMonth: '/month'
  },

  home: {
    noNumber: 'no number yet',
    getNumber: 'Get a number',
    finishNumber: 'Finish signing up',
    importJabber: 'Connect my Jabber',
    hello: format`${icon('hello')} ${bold('Hi!')}\n\nHere you can get a US phone number from JMP.chat — every SMS sent to it lands right in this chat.\n\nGreat for verification codes: the code is highlighted and copied with one tap.`,
    myNumbers: 'My numbers',
    messagesMeta: (count: number, ago: string) => `${count} · last ${ago}`,
    noMessagesYet: 'no messages yet',
    sourceCode: 'Source code'
  },

  card: {
    active: 'Active',
    renewsOn: (date: string) => ` · renews ${date}`,
    inactive: 'inactive',
    until: (date: string) => ` · until ${date}`,
    balance: 'Balance',
    lastMessages: 'Recent messages',
    noMessages: 'No messages yet — I will forward every SMS here as soon as it arrives.',
    refresh: 'Refresh',
    all: (n: number) => `All (${n})`,
    writeSms: 'Send SMS',
    copyNumber: 'Number',
    topUp: 'Top up',
    reminders: 'Reminders',
    noReminders: 'Reminders off',
    promo: 'Promo codes',
    credentials: 'Jabber login',
    unlink: 'Disconnect'
  },

  history: {
    title: ' · all messages',
    empty: 'Empty'
  },

  jabber: {
    title: 'Jabber',
    password: 'Password',
    server: (domain: string) => format`Server: ${code(domain)}, port 5222`,
    hintOwn: (gateway: string) => `Log in with these details in any XMPP client (Conversations, Monal, Gajim, Dino): SMS will arrive both there and here, and you can text right from the client — to +15551234567@${gateway}.`,
    hintImported: 'This is your own Jabber account; the bot is connected to it as one more client. If you change the password, the bot stops receiving SMS.',
    copyPassword: 'Password'
  },

  topUp: {
    title: 'Top up',
    balance: 'Balance',
    plan: 'Plan',
    byCard: format`${icon('card')} ${bold('By card')} — on the JMP page, where you can also save a card and turn on auto top-up.`,
    bySavedCard: format`${icon('card')} ${bold('With your saved card')} — right here, you will pick the amount on the next step.`,
    byCrypto: format`${icon('crypto')} ${bold('With crypto')} — I will give you an address; the money is credited once the network confirms it.`,
    payByCard: 'Pay by card',
    savedCard: 'Saved card',
    cardPayment: 'Card payment',
    cryptoTitle: (name: string) => `Top up with ${name}`,
    gettingAddress: (name: string) => `Getting a ${name} address…`,
    notAccepting: (name: string) => `JMP doesn't accept ${name} right now`,
    paying: 'Paying…',
    noAnswer: 'JMP sent nothing back'
  },

  reminder: {
    title: 'Your number renews soon',
    when: (days: string, date: string) => `In ${days}, on ${date}.`,
    price: (price: string) => format` JMP will charge ${bold(price)} for the next month.`,
    shortfall: (balance: string, missing: string) => format`${'\n'}Your balance is ${bold(balance)}, ${bold(missing)} short.`,
    action: 'Top up in advance, otherwise the number may be suspended.',
    footer: 'I remind you 7, 3, 2 and 1 day before, while the balance is not enough for the renewal.',
    stop: 'Stop reminding',
    toastOn: 'Reminders on',
    toastOff: 'Reminders off',
    noticeOn: format`${icon('bell')} I will remind you 7, 3, 2 and 1 day before the renewal if the balance is not enough.`,
    noticeOff: format`${icon('bellOff')} Renewal reminders are off. You can turn them back on with the button below.`
  },

  referral: {
    title: 'Promo codes',
    code: 'Referral code',
    codeDesc: 'Whoever signs up for JMP with this code and pays gets a free month, and you get a month once their payment clears.',
    invites: (n: number) => `Single-use invites (${n})`,
    invitesDesc: 'Each gives one person a free month of JMP.',
    none: 'JMP sent no codes.',
    jmpAnswer: 'JMP says:'
  },

  unlink: {
    title: 'Disconnect this Jabber account?',
    body: 'The bot will disconnect from it, SMS will stop arriving here, and the message history in the bot will be deleted.',
    keep: 'The Jabber account and the JMP number stay yours — you can connect them again later.',
    confirm: 'Yes, disconnect',
    done: (jid: string) => format`${icon('ok')} ${bold(jid)} disconnected`
  },

  sms: {
    to: (number: string) => `to ${number}`,
    reply: 'Reply',
    notDelivered: (peer: string, text: string) => format`${icon('warning')} SMS to ${bold(peer)} was not delivered\n\n${text}`,
    newSms: (from: string) => format`${icon('write')} ${bold('New SMS')} · from ${from}`,
    toPrompt: 'Who to? Send the number as a message:\n\n• +15551234567 or 5551234567\n• a short code, e.g. 22000',
    notANumber: format`${icon('warning')} That doesn't look like a number, try again.\n\n`,
    bodyPrompt: (peer: string) => format`To: ${bold(peer)}\n\nType your message ${icon('down')}`,
    sending: 'Sending…',
    sent: (peer: string) => format`${icon('ok')} Sent to ${bold(peer)}`,
    sendFailed: (reason: string) => `Couldn't send: ${reason}`,
    cantReply: "you can't reply to this number",
    notSent: (reason: string) => format`${icon('error')} Not sent: ${reason}`
  },

  registration: {
    connecting: 'Connecting to JMP…',
    ready: format`${icon('party')} ${bold('Your number is ready!')} Every SMS sent to it will arrive in this chat.`,
    cancelled: format`${icon('cancel')} Cancelled`,
    paused: (reason: string) => format`${icon('wait')} Signup paused: ${reason}`,
    timedOut: 'no answer for too long',
    failed: 'JMP didn’t answer or something broke. Try again in a minute.',
    searchTitle: format`${icon('search')} ${bold('New number')} · step 1 of 3`,
    searchText: format`Send what number to look for:\n\n• ${bold('512')} — an area code\n• ${bold('TX')} or ${bold('Austin, TX')} — a state or a city\n• ${bold('~777')} — a vanity number containing 777`,
    showAny: 'Show any',
    searching: 'Looking for numbers…',
    noNumbersFound: 'No numbers found, try another search.',
    nothingFoundFor: (query: string) => `No numbers for “${query}” — try another search.`,
    numberTitle: format`${icon('numbers')} ${bold('New number')} · step 2 of 3`,
    found: (n: number) => format`Found ${bold(String(n))} — pick a number`,
    searchAgain: 'Search again',
    taking: (phone: string) => `Reserving ${phone}…`,
    promoTitle: format`${icon('promo')} ${bold('New number')} · step 3 of 3`,
    promoText: (deposit: string | null, referral: string | null) => format`Have a JMP ${bold('invite code')}? Send it as a message — the number is activated for free.\n\nNo invite — activate the number by paying: deposit ${bold(deposit ?? 'the minimum')} to your JMP balance by card or crypto. The money stays on your balance and pays for the number.${referral ? format`${'\n\n'}I will add the referral code ${code(referral)} to the payment — it gives you a bonus month.` : ''}`,
    payCard: 'Card',
    checkingCode: 'Checking your code…',
    preparingPayment: 'Preparing the payment…',
    referralNeedsPayment: (code: string) => `${code} is a referral code: it doesn't activate a number for free, but it works together with a payment. Pick a payment method below — I will add the code to it.`,
    cardTitle: format`${icon('card')} ${bold('Card payment')}`,
    cardText: (deposit: string | null) => `Open the JMP page with the button below, deposit ${deposit ?? 'the minimum'} and save the card. Then come back here and tap "I've paid".`,
    payByCard: 'Pay by card',
    paid: "I've paid",
    otherMethod: 'Another method',
    checkingPayment: 'Checking the payment…',
    notPaidYet: "JMP doesn't see the payment yet. If you've already paid, wait a minute and tap \"I've paid\" again.",
    paymentTitle: 'Activation payment',
    reserved: (phone: string) => format`The number ${bold(phone)} is reserved — it just needs to be paid for.`,
    paymentWait: 'Once JMP confirms the payment, I will send "Your number is ready". If it takes long, open the menu and tap "Finish signing up".',
    premium: 'This is a premium JMP number and can’t be activated with a promo code. Pick another one.',
    codeRejected: (code: string, reason: string) => `JMP didn't accept the code ${code}${reason ? `: ${reason}` : ''}`,
    jmpCancelled: 'JMP cancelled the signup',
    unpaid: (number: string, status: string) => `The number ${number} isn't paid (JMP status: ${status}). Top it up first — then you can get another one.`,
    tooManySteps: 'Too many signup steps'
  },

  prompt: {
    stale: 'This question is out of date — open /start',
    noOption: 'No such option',
    useButtons: 'pick an option with the buttons'
  },

  import: {
    title: format`${icon('link')} ${bold('Your own Jabber')}`,
    intro: 'You can connect a Jabber account you already have, for example one with a JMP number: SMS sent to it will arrive in this chat.\n\nSend the JID, e.g. name@server.org',
    notAJid: format`${icon('warning')} That doesn't look like a JID, it should be like name@server.org\n\n`,
    passwordPrompt: (jid: string) => format`JID: ${bold(jid)}\n\nNow the password. I will delete that message right away.`,
    loggingIn: 'Logging in and asking JMP…',
    linkedActive: (jid: string) => format`${icon('ok')} ${bold(jid)} connected — SMS sent to it will arrive here.`,
    linkedPending: (jid: string) => format`${icon('ok')} ${bold(jid)} connected. It has no JMP number yet — you can get one with the button below.`,
    usage: 'Usage: /import jid password',
    limit: (n: number) => `You can connect at most ${n} Jabber accounts of your own`,
    addedWithNumber: (jid: string, phone: string) => format`${icon('ok')} ${bold(jid)} added, number ${bold(phone)}`,
    addedNoNumber: (jid: string) => format`${icon('ok')} ${bold(jid)} added; it has no JMP number — you can get one from /start`,
    wrongCredentials: 'wrong JID or password',
    cantConnect: (domain: string) => `couldn't connect to ${domain}`,
    loginFailed: (reason: string) => `couldn't log in: ${reason}`,
    badJid: "that doesn't look like a JID, it should be like name@server.org",
    alreadyAdded: (jid: string) => `${jid} is already added to the bot`,
    noAnswer: (domain: string) => `${domain} didn't answer`,
    noJmpNumber: 'this Jabber account has no JMP number'
  },

  admin: {
    registrationFailed: (userId: number, reason: string) => `signup ${userId}: ${reason}`
  },

  access: {
    button: (n: number) => `Access (${n})`,
    title: 'Shared access',
    nobody: 'Nobody but you uses this number.',
    hint: 'These people receive SMS from this number and can do everything you can. They got access with your approval.',
    revoke: (name: string) => `Revoke: ${name}`,
    unlinkNote: 'Everyone you shared it with will lose access too.',
    leaveTitle: 'Remove this number from your menu?',
    leaveBody: 'You will stop receiving SMS from this number; the owner and everyone else keep it as is.',
    request: (who: string, id: number, jid: string, number: string) => format`${icon('group')} ${bold('Access request')}

${who} (id ${code(String(id))}) wants to use the Jabber account ${bold(jid)} · ${number}.

They know its password — the bot checked the login. With access they will receive SMS and can do everything you can.`,
    approve: 'Allow',
    deny: 'Decline',
    requestSent: (jid: string) => format`${icon('wait')} ${bold(jid)} is already connected by someone else. I sent them a request — once they allow it, the number appears in your menu.`,
    requestPending: (jid: string) => format`${icon('wait')} An access request for ${bold(jid)} is already with the owner, waiting for their answer.`,
    approvedOwner: (who: string) => format`${icon('ok')} Access granted: ${who}`,
    deniedOwner: (who: string) => format`${icon('cancel')} Request declined: ${who}`,
    granted: (jid: string) => format`${icon('ok')} The owner allowed access to ${bold(jid)} — the number is now in your menu. Open /start.`,
    denied: (jid: string) => format`${icon('cancel')} The owner declined your access request for ${bold(jid)}.`,
    revoked: (name: string) => format`${icon('ok')} Access revoked: ${name}`,
    revokedMember: (jid: string) => format`${icon('unlink')} The owner revoked your access to ${bold(jid)}.`,
    left: (jid: string) => format`${icon('ok')} ${bold(jid)} removed from your menu.`,
    ownerUnlinked: (jid: string) => format`${icon('unlink')} The owner disconnected ${bold(jid)} from the bot — the number is gone from your menu too.`,
    requestGone: 'This request is no longer valid',
    alreadyHave: (jid: string) => `${jid} is already in your menu`
  },

  language: {
    switchTo: 'Русский',
    changed: format`${icon('language')} Interface language: English. You can switch back with the button at the bottom of the menu or /lang.`
  },

  commands: {
    start: 'Numbers panel',
    cancel: 'Cancel the current step',
    lang: 'Change language / Сменить язык'
  }
}
