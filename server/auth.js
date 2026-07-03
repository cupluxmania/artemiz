const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcryptjs");
const db = require("./db");

// One shared session middleware instance, used both for regular HTTP requests (app.use)
// and for Socket.io handshakes (io.engine.use) — see server/index.js.
function buildSessionMiddleware() {
  if (!process.env.SESSION_SECRET) {
    console.warn(
      "\n[auth] SESSION_SECRET is not set — using an insecure built-in default. Set a long random " +
      "SESSION_SECRET in .env before deploying anywhere public (it signs session cookies).\n"
    );
  }

  return session({
    store: new pgSession({ pool: db.pool, tableName: "session", createTableIfMissing: true }),
    name: "gerbang.sid",
    secret: process.env.SESSION_SECRET || "dev-insecure-secret-change-me",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  });
}

// Verifies a username/password against the users table. Returns the user (without the hash)
// on success, or null on failure.
async function verifyLogin(username, password) {
  if (!username || !password) return null;
  const user = await db.getUserByUsername(String(username).trim().toLowerCase());
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  return { id: user.id, username: user.username, displayName: user.display_name };
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

// Protects the dashboard UI + REST API. Socket.io uses its own check (see index.js) since it
// doesn't go through Express routing.
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "unauthorized" });
  return res.redirect("/login.html");
}

module.exports = { buildSessionMiddleware, verifyLogin, hashPassword, requireAuth };
