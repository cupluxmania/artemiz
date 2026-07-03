const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const db = require("./db");

let client = null;

function initWhatsApp(io) {
  client = new Client({
    authStrategy: new LocalAuth({ clientId: "gerbang-inbox" }),
    puppeteer: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      // When running in the Docker image, PUPPETEER_EXECUTABLE_PATH points at the
      // system Chromium instead of a bundled one — keeps the image much smaller.
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    },
  });

  client.on("qr", async (qr) => {
    console.log("[whatsapp] Scan the QR code from the web UI (or terminal below):");
    try {
      const dataUrl = await QRCode.toDataURL(qr);
      io.emit("whatsapp:qr", { dataUrl });
    } catch (e) {
      console.error("[whatsapp] Failed to render QR:", e.message);
    }
  });

  client.on("ready", () => {
    console.log("[whatsapp] Connected.");
    io.emit("whatsapp:status", { ready: true });
  });

  client.on("disconnected", (reason) => {
    console.log("[whatsapp] Disconnected:", reason);
    io.emit("whatsapp:status", { ready: false, reason });
  });

  client.on("message", async (msg) => {
    if (msg.from.endsWith("@g.us")) return; // skip group chats in this template
    if (msg.from === "status@broadcast") return;

    const contact = await msg.getContact().catch(() => null);
    const name = (contact && (contact.pushname || contact.name)) || msg.from.split("@")[0];
    const convId = `whatsapp:${msg.from}`;

    try {
      await db.upsertConversation({ id: convId, name, channel: "whatsapp", handle: msg.from.split("@")[0], externalId: msg.from });
      const saved = await db.addMessage(convId, { from: "them", text: msg.body });

      io.emit("message:new", { convId, message: saved });
      io.emit("conversations:update");
    } catch (err) {
      console.error("[whatsapp] failed to store incoming message:", err.message);
    }
  });

  client.initialize();
  return client;
}

async function sendWhatsAppMessage(externalId, text) {
  if (!client) throw new Error("WhatsApp client not initialized");
  return client.sendMessage(externalId, text);
}

module.exports = { initWhatsApp, sendWhatsAppMessage };
