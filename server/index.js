require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const http = require("http");
const { Server } = require("socket.io");

const db = require("./db");
const buildRoutes = require("./routes");
const buildAuthRoutes = require("./auth-routes");
const { buildSessionMiddleware, requireAuth } = require("./auth");
const { initWhatsApp, sendWhatsAppMessage } = require("./whatsapp");
const { initTelegram, sendTelegramMessage } = require("./telegram");

const PORT = process.env.PORT || 3000;

const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false })); // CSP off by default so the CDN font import keeps working; tighten if you remove it
app.use(cors({ origin: "https://cupluxmania.github.io", credentials: true }));
app.use(express.json({ limit: "100kb" }));

const sessionMiddleware = buildSessionMiddleware();
app.use(sessionMiddleware);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20, // 20 attempts / 15 min per IP — slows down password guessing without locking out a whole office
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited", detail: "Too many login attempts — try again later." },
});

// Unauthenticated: the login page itself, its assets, the login/logout/me API, and a health
// check (platform load balancers hit this without a session).
app.use("/api/auth", loginLimiter, buildAuthRoutes());
app.get("/login.html", (req, res) => res.redirect("https://cupluxmania.github.io/artemiz/"));
app.get("/login.js", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "login.js")));
app.get("/styles.css", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "styles.css")));
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Everything below this line requires a logged-in session (dashboard UI + API + Socket.io).
app.use(requireAuth);

app.use(express.static(path.join(__dirname, "..", "public")));

const server = http.createServer(app);
const io = new Server(server);

// Run the same session middleware on Socket.io's handshake so socket.request.session is
// populated from the same cookie, then reject any handshake without a logged-in session.
io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  const sess = socket.request.session;
  if (sess && sess.userId) return next();
  next(new Error("unauthorized"));
});

let whatsappModule = { sendWhatsAppMessage };
let telegramModule = { sendTelegramMessage };

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20, // max 20 outgoing messages per minute per IP — keeps you well under WhatsApp/Telegram abuse thresholds
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited", detail: "Too many messages sent — slow down." },
});

const apiRouter = buildRoutes({
  io,
  getWhatsApp: () => whatsappModule,
  getTelegram: () => telegramModule,
});

app.use("/api/conversations/:id/messages", sendLimiter);
app.use("/api", apiRouter);

io.on("connection", (socket) => {
  console.log(`[socket] client connected (${socket.request.session.username})`);
});

async function start() {
  try {
    await db.initDb();
  } catch (err) {
    console.error("\n[db] Could not connect to Postgres. Check DATABASE_URL in your .env.");
    console.error(err.message, "\n");
    process.exit(1);
  }

  const { rows } = await db.pool.query("SELECT COUNT(*)::int AS count FROM users");
  if (rows[0].count === 0) {
    console.warn(
      "\n[auth] No dashboard users exist yet — nobody can log in. Create one with:\n" +
      "  npm run create-user -- <username> <password>\n"
    );
  }

  server.listen(PORT, () => {
    console.log(`\nGerbang Inbox running at http://localhost:${PORT}\n`);

    if (process.env.ENABLE_WHATSAPP !== "false") {
      initWhatsApp(io);
    } else {
      console.log("[whatsapp] disabled via ENABLE_WHATSAPP=false");
    }

    if (process.env.ENABLE_TELEGRAM !== "false") {
      initTelegram(io);
    } else {
      console.log("[telegram] disabled via ENABLE_TELEGRAM=false");
    }
  });
}

start();
