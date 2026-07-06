const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

router.get('/', requireRole('admin'), (req, res) => {
  const rows = db.prepare('SELECT id, name, username, role, avatar_color, is_active, created_at FROM users ORDER BY id ASC').all();
  res.json({ rows });
});

router.post('/', requireRole('admin'), (req, res) => {
  const { name, username, password, role, avatar_color } = req.body || {};
  if (!name || !username || !password || !role) {
    return res.status(400).json({ error: 'name, username, password, and role are required' });
  }
  if (!['admin', 'staff', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) return res.status(400).json({ error: 'Username already exists' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    'INSERT INTO users (name, username, password_hash, role, avatar_color) VALUES (?,?,?,?,?)'
  ).run(name.trim(), username.trim(), hash, role, avatar_color || '#2563eb');

  const row = db.prepare('SELECT id, name, username, role, avatar_color, is_active, created_at FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ row });
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  const { name, role, avatar_color, is_active, password } = req.body || {};
  const newRole = role || existing.role;
  if (!['admin', 'staff', 'viewer'].includes(newRole)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  db.prepare(
    'UPDATE users SET name=?, role=?, avatar_color=?, is_active=?, updated_at=datetime(\'now\') WHERE id=?'
  ).run(
    name ?? existing.name,
    newRole,
    avatar_color ?? existing.avatar_color,
    is_active === undefined ? existing.is_active : (is_active ? 1 : 0),
    id
  );
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, id);
  }
  const row = db.prepare('SELECT id, name, username, role, avatar_color, is_active, created_at FROM users WHERE id = ?').get(id);
  res.json({ row });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
