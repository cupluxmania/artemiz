const express = require('express');
const { db } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, (SELECT COUNT(*) FROM booths b WHERE b.event_id = e.id) AS booth_count
    FROM events e ORDER BY e.created_at DESC
  `).all();
  res.json({ events: rows });
});

router.post('/', requireRole('admin', 'staff'), (req, res) => {
  const { name, location, start_date, end_date } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Event name is required' });
  try {
    const info = db.prepare(
      'INSERT INTO events (name, location, start_date, end_date) VALUES (?,?,?,?)'
    ).run(name, location || '', start_date || null, end_date || null);
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ event });
  } catch (e) {
    res.status(400).json({ error: 'Event name already exists or invalid data' });
  }
});

router.put('/:id', requireRole('admin', 'staff'), (req, res) => {
  const { id } = req.params;
  const { name, location, start_date, end_date, is_active } = req.body || {};
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  db.prepare(
    'UPDATE events SET name=?, location=?, start_date=?, end_date=?, is_active=? WHERE id=?'
  ).run(
    name ?? existing.name,
    location ?? existing.location,
    start_date ?? existing.start_date,
    end_date ?? existing.end_date,
    is_active === undefined ? existing.is_active : (is_active ? 1 : 0),
    id
  );
  res.json({ event: db.prepare('SELECT * FROM events WHERE id = ?').get(id) });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
