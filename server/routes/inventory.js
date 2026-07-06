const express = require('express');
const { db } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { getHallsForEvent, isInternationalEvent, hallCode, HALL_SLOT_COUNTS } = require('../lib/halls');

const router = express.Router();
router.use(authRequired);

function logActivity(userId, action, entity, entityId, details) {
  db.prepare(
    'INSERT INTO activity_log (user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)'
  ).run(userId, action, entity || null, entityId || null, details || null);
}

function getEventOrThrow(eventId) {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) {
    const err = new Error('Event not found');
    err.statusCode = 404;
    throw err;
  }
  return event;
}

// GET list of halls that apply to a given event (based on its title). Falls back to the
// domestic plot (Convention/Foyer/Exhibition/Ambulance) if event_id is omitted or not found.
// International events (title contains "Int'l" / "International") use Hall 5-10 + Ambulance.
router.get('/halls', (req, res) => {
  const { event_id } = req.query;
  if (!event_id) {
    return res.json({ halls: getHallsForEvent(''), isInternational: false });
  }
  const event = db.prepare('SELECT name FROM events WHERE id = ?').get(event_id);
  const eventName = event ? event.name : '';
  res.json({ halls: getHallsForEvent(eventName), isInternational: isInternationalEvent(eventName), eventName });
});

// GET booth inventory for an event, optionally filtered by hall/status/search
// `for_booking_id`: also include slots currently booked BY this booking (so an edit form
// can show the booking's own already-assigned booths as selectable/checked).
router.get('/', (req, res) => {
  const { event_id, hall, status, search, page = 1, pageSize = 200, for_booking_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required' });

  const where = ['bi.event_id = @event_id'];
  const params = { event_id };
  if (hall) { where.push('bi.hall = @hall'); params.hall = hall; }
  if (status) {
    if (for_booking_id) {
      where.push('(bi.status = @status OR bi.booking_id = @for_booking_id)');
      params.status = status;
      params.for_booking_id = for_booking_id;
    } else {
      where.push('bi.status = @status');
      params.status = status;
    }
  }
  if (search) { where.push('bi.booth_number LIKE @search'); params.search = `%${search}%`; }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = db.prepare(`SELECT COUNT(*) AS c FROM booth_inventory bi ${whereSql}`).get(params).c;
  const limit = Math.max(1, Math.min(1000, parseInt(pageSize, 10) || 200));
  const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * limit;

  const rows = db.prepare(`
    SELECT bi.*, b.company_name AS booked_by_company
    FROM booth_inventory bi
    LEFT JOIN booths b ON b.id = bi.booking_id
    ${whereSql}
    ORDER BY bi.hall ASC, bi.booth_number ASC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });

  res.json({ rows, total, page: Number(page), pageSize: limit });
});

// GET a summary count of available/booked/blocked per hall, for an event
router.get('/summary', (req, res) => {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required' });

  const event = db.prepare('SELECT name FROM events WHERE id = ?').get(event_id);
  const eventName = event ? event.name : '';
  const allowedHalls = getHallsForEvent(eventName);

  const byHallRaw = db.prepare(`
    SELECT hall,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
      SUM(CASE WHEN status = 'booked' THEN 1 ELSE 0 END) AS booked,
      SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked
    FROM booth_inventory
    WHERE event_id = ?
    GROUP BY hall
  `).all(event_id);
  const byHallMap = {};
  byHallRaw.forEach((h) => { byHallMap[h.hall] = h; });

  // Always return a row per allowed hall for this event (even with 0 slots generated yet),
  // in the correct plot order, so the UI can render a full set of hall cards immediately.
  const byHall = allowedHalls.map((hall) => byHallMap[hall] || { hall, total: 0, available: 0, booked: 0, blocked: 0 });

  const totals = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
      SUM(CASE WHEN status = 'booked' THEN 1 ELSE 0 END) AS booked,
      SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked
    FROM booth_inventory
    WHERE event_id = ?
  `).get(event_id);

  res.json({ byHall, totals, halls: allowedHalls, isInternational: isInternationalEvent(eventName), eventName });
});

// GET a single inventory slot by id (kept below fixed-path GETs like /halls and /summary
// so Express doesn't mistake those literal segments for an :id param)
router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT bi.*, b.company_name AS booked_by_company
    FROM booth_inventory bi
    LEFT JOIN booths b ON b.id = bi.booking_id
    WHERE bi.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Booth slot not found' });
  res.json({ row });
});

// Bulk-generate booth inventory slots for an event/hall (admin/staff)
router.post('/generate', requireRole('admin', 'staff'), (req, res) => {
  const { event_id, hall, count, size, prefix } = req.body || {};
  if (!event_id || !hall || !count) {
    return res.status(400).json({ error: 'event_id, hall, and count are required' });
  }
  let event;
  try { event = getEventOrThrow(event_id); } catch (e) { return res.status(e.statusCode || 400).json({ error: e.message }); }
  const allowedHalls = getHallsForEvent(event.name);
  if (!allowedHalls.includes(hall)) {
    return res.status(400).json({ error: `For "${event.name}", hall must be one of: ${allowedHalls.join(', ')}` });
  }
  const n = Math.min(2000, Math.max(1, parseInt(count, 10) || 0));
  const existingMax = db.prepare(
    `SELECT booth_number FROM booth_inventory WHERE event_id = ? AND hall = ? ORDER BY id DESC LIMIT 1`
  ).get(event_id, hall);

  const codePrefix = prefix || hallCode(hall);
  let startIdx = 1;
  if (existingMax) {
    const match = existingMax.booth_number.match(/(\d+)$/);
    if (match) startIdx = parseInt(match[1], 10) + 1;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO booth_inventory (event_id, hall, booth_number, size, status)
    VALUES (?, ?, ?, ?, 'available')
  `);
  let inserted = 0;
  const tx = db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const num = startIdx + i;
      const boothNumber = `${codePrefix}-${String(num).padStart(3, '0')}`;
      const info = insert.run(event_id, hall, boothNumber, size || '3x3');
      if (info.changes > 0) inserted++;
    }
  });
  tx();

  logActivity(req.user.id, 'generate_inventory', 'booth_inventory', null, `Generated ${inserted} booth slots in ${hall} for event #${event_id}`);
  res.json({ inserted });
});

// Update a single inventory slot directly (hall, booth number, size, status)
router.put('/:id', requireRole('admin', 'staff'), (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM booth_inventory WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Booth slot not found' });

  const { status, size, hall, booth_number } = req.body || {};
  if (status && !['available', 'booked', 'blocked'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (status && status === 'booked' && existing.status !== 'booked') {
    return res.status(400).json({ error: 'Use the booking flow to assign this booth to a booking, not a direct status change' });
  }
  if (hall) {
    const event = db.prepare('SELECT name FROM events WHERE id = ?').get(existing.event_id);
    const allowedHalls = getHallsForEvent(event ? event.name : '');
    if (!allowedHalls.includes(hall)) {
      return res.status(400).json({ error: `For this event, hall must be one of: ${allowedHalls.join(', ')}` });
    }
  }
  if (existing.status === 'booked' && ((hall && hall !== existing.hall) || (booth_number && booth_number !== existing.booth_number))) {
    return res.status(400).json({ error: 'Cannot change hall/booth number while this slot is booked. Unassign it from the booking first.' });
  }

  const newHall = hall || existing.hall;
  const newBoothNumber = booth_number !== undefined && booth_number !== '' ? booth_number : existing.booth_number;

  if (newHall !== existing.hall || newBoothNumber !== existing.booth_number) {
    const clash = db.prepare(
      'SELECT id FROM booth_inventory WHERE event_id = ? AND hall = ? AND booth_number = ? AND id != ?'
    ).get(existing.event_id, newHall, newBoothNumber, id);
    if (clash) {
      return res.status(400).json({ error: `Booth ${newHall} / ${newBoothNumber} already exists` });
    }
  }

  db.prepare(`
    UPDATE booth_inventory SET status = @status, size = @size, hall = @hall, booth_number = @booth_number, updated_at = datetime('now') WHERE id = @id
  `).run({
    id,
    status: status || existing.status,
    size: size !== undefined ? size : existing.size,
    hall: newHall,
    booth_number: newBoothNumber,
  });

  logActivity(req.user.id, 'update_inventory_slot', 'booth_inventory', Number(id), `Updated booth slot #${id} (${newHall} / ${newBoothNumber})`);
  const row = db.prepare('SELECT * FROM booth_inventory WHERE id = ?').get(id);
  res.json({ row });
});

// Delete an inventory slot (only if not currently booked)
router.delete('/:id', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM booth_inventory WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Booth slot not found' });
  if (existing.status === 'booked') {
    return res.status(400).json({ error: 'Cannot delete a booth slot that is currently booked' });
  }
  db.prepare('DELETE FROM booth_inventory WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
