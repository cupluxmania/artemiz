const express = require("express");
const db = require("./db");

function buildRoutes({ io, getWhatsApp, getTelegram }) {
  const router = express.Router();

  router.get("/conversations", async (req, res) => {
    try {
      res.json(await db.getConversations());
    } catch (err) {
      console.error("Failed to load conversations:", err.message);
      res.status(500).json({ error: "db_error", detail: err.message });
    }
  });

  router.get("/conversations/:id", async (req, res) => {
    const conv = await db.getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: "not_found" });
    res.json(conv);
  });

  router.post("/conversations/:id/read", async (req, res) => {
    await db.markRead(req.params.id);
    io.emit("conversations:update");
    res.json({ ok: true });
  });

  router.post("/conversations/:id/messages", async (req, res) => {
    const { text } = req.body;
    const conv = await db.getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: "not_found" });
    if (!text || !text.trim()) return res.status(400).json({ error: "empty_message" });
    if (text.length > 4096) return res.status(400).json({ error: "message_too_long" });

    try {
      if (conv.channel === "whatsapp") {
        const { sendWhatsAppMessage } = getWhatsApp();
        await sendWhatsAppMessage(conv.externalId, text.trim());
      } else if (conv.channel === "telegram") {
        const { sendTelegramMessage } = getTelegram();
        await sendTelegramMessage(conv.externalId, text.trim());
      }
      const saved = await db.addMessage(conv.id, {
        from: "me",
        text: text.trim(),
        status: "sent",
        agent: req.session && req.session.displayName,
      });
      io.emit("message:new", { convId: conv.id, message: saved });
      io.emit("conversations:update");
      res.json({ ok: true, message: saved });
    } catch (err) {
      console.error("Send failed:", err.message);
      res.status(500).json({ error: "send_failed", detail: err.message });
    }
  });

  return router;
}

module.exports = buildRoutes;
