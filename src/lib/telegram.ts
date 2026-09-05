const API = (method: string) =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`

export interface InlineButton { text: string; callback_data: string }

export async function tg(method: string, body: Record<string, unknown>) {
  const res = await fetch(API(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({ ok: false }))
  if (!json.ok) console.error(`telegram ${method} failed:`, JSON.stringify(json).slice(0, 400))
  return json
}

export function sendMessage(
  chatId: string | number,
  text: string,
  buttons?: InlineButton[][],
) {
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  })
}

export function answerCallback(id: string, text: string) {
  return tg('answerCallbackQuery', { callback_query_id: id, text, show_alert: false })
}

export function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  buttons?: InlineButton[][],
) {
  return tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  })
}

/** Telegram HTML mode only allows a small tag set — escape everything else. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
