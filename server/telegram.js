const TelegramBot = require("node-telegram-bot-api");
const db = require("./db");

let bot = null;

function initTelegram(io) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("[telegram] No TELEGRAM_BOT_TOKEN set — skipping Telegram.");
    io.emit("telegram:status", { ready: false, reason: "no_token" });
    return null;
  }

  bot = new TelegramBot(token, { polling: true });

  bot.on("polling_error", (err) => {
    console.error("[telegram] polling error:", err.message);
    io.emit("telegram:status", { ready: false, reason: err.message });
  });

  bot.getMe().then((me) => {
    console.log(`[telegram] Connected as @${me.username}`);
    io.emit("telegram:status", { ready: true, username: me.username });
  });

  bot.on("message", async (msg) => {
    if (!msg.text) return; // template handles text messages; extend for media as needed
    const chatId = String(msg.chat.id);
    const convId = `telegram:${chatId}`;
    const name = [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(" ") || msg.chat.username || `Chat ${chatId}`;
    const handle = msg.chat.username ? `@${msg.chat.username}` : chatId;

    try {
      await db.upsertConversation({ id: convId, name, channel: "telegram", handle, externalId: chatId });
      const saved = await db.addMessage(convId, { from: "them", text: msg.text });

      io.emit("message:new", { convId, message: saved });
      io.emit("conversations:update");
    } catch (err) {
      console.error("[telegram] failed to store incoming message:", err.message);
    }
  });

  return bot;
}

async function sendTelegramMessage(externalId, text) {
  if (!bot) throw new Error("Telegram bot not initialized (check TELEGRAM_BOT_TOKEN)");
  return bot.sendMessage(externalId, text);
}

module.exports = { initTelegram, sendTelegramMessage };
