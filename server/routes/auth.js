const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { JWT_SECRET, authRequired } = require('../middleware/auth');

const router = express.Router();

function logActivity(userId, action, entity, entityId, details) {
  db.prepare(
    'INSERT INTO activity_log (user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)'
  ).run(userId, action, entity || null, entityId || null, details || null);
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const payload = { id: user.id, username: user.username, name: user.name, role: user.role, avatar_color: user.avatar_color };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
  logActivity(user.id, 'login', 'user', user.id, `${user.username} logged in`);
  res.json({ token, user: payload });
});

router.get('/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT id, name, username, role, avatar_color, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

module.exports = router;
