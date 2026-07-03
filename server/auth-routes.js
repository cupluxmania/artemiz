const express = require("express");
const { verifyLogin } = require("./auth");

// Unauthenticated routes: POST /login and GET /me (GET /me still needs a session, checked below).
// Mounted before the global requireAuth middleware in index.js.
function buildAuthRoutes() {
  const router = express.Router();

  router.post("/login", async (req, res) => {
    const { username, password } = req.body || {};
    const user = await verifyLogin(username, password);
    if (!user) return res.status(401).json({ error: "invalid_credentials" });

    // Rotate the session ID on login to prevent session fixation.
    req.session.regenerate((err) => {
      if (err) {
        console.error("[auth] session regenerate failed:", err.message);
        return res.status(500).json({ error: "session_error" });
      }
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.displayName = user.displayName;
      res.json({ ok: true, user: { username: user.username, displayName: user.displayName } });
    });
  });

  router.post("/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("gerbang.sid");
      res.json({ ok: true });
    });
  });

  router.get("/me", (req, res) => {
    if (!req.session || !req.session.userId) return res.status(401).json({ error: "unauthorized" });
    res.json({ username: req.session.username, displayName: req.session.displayName });
  });

  return router;
}

module.exports = buildAuthRoutes;
