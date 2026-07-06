const express = require('express');
const { db } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

function logActivity(userId, action, entity, entityId, details) {
  db.prepare(
    'INSERT INTO activity_log (user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)'
  ).run(userId, action, entity || null, entityId || null, details || null);
}

// GET all termin payments for a booth (ordered T1..T6)
router.get('/booth/:boothId', (req, res) => {
  const { boothId } = req.params;
  const booth = db.prepare('SELECT id, company_name, spk_date, spk_number, contract_value, currency, termin_count FROM booths WHERE id = ?').get(boothId);
  if (!booth) return res.status(404).json({ error: 'Booth record not found' });

  const rows = db.prepare('SELECT * FROM payments WHERE booth_id = ? ORDER BY termin_number ASC').all(boothId);
  const totalPaid = rows.filter(r => r.is_paid).reduce((s, r) => s + (r.amount || 0), 0);
  const totalPlanned = rows.reduce((s, r) => s + (r.amount || 0), 0);

  res.json({ booth, payments: rows, totalPaid, totalPlanned, remaining: Math.max(0, totalPlanned - totalPaid) });
});

// Update (or create) a specific termin payment record for a booth
router.put('/booth/:boothId/termin/:terminNumber', requireRole('admin', 'staff'), (req, res) => {
  const { boothId, terminNumber } = req.params;
  const tNum = parseInt(terminNumber, 10);
  if (!Number.isInteger(tNum) || tNum < 1 || tNum > 6) {
    return res.status(400).json({ error: 'termin_number must be between 1 and 6' });
  }
  const booth = db.prepare('SELECT * FROM booths WHERE id = ?').get(boothId);
  if (!booth) return res.status(404).json({ error: 'Booth record not found' });
  if (tNum > booth.termin_count) {
    return res.status(400).json({ error: `This booth is configured for only ${booth.termin_count} termin(s)` });
  }

  const body = req.body || {};
  const existing = db.prepare('SELECT * FROM payments WHERE booth_id = ? AND termin_number = ?').get(boothId, tNum);

  const payload = {
    amount: body.amount !== undefined ? Number(body.amount) : (existing ? existing.amount : 0),
    is_paid: body.is_paid !== undefined ? (body.is_paid ? 1 : 0) : (existing ? existing.is_paid : 0),
    paid_date: body.paid_date !== undefined ? body.paid_date : (existing ? existing.paid_date : null),
    due_date: body.due_date !== undefined ? body.due_date : (existing ? existing.due_date : null),
    payment_method: body.payment_method !== undefined ? body.payment_method : (existing ? existing.payment_method : null),
    reference_no: body.reference_no !== undefined ? body.reference_no : (existing ? existing.reference_no : null),
    notes: body.notes !== undefined ? body.notes : (existing ? existing.notes : null),
  };

  // Auto-stamp paid_date to today if marked paid but no date supplied
  if (payload.is_paid && !payload.paid_date) {
    payload.paid_date = new Date().toISOString().slice(0, 10);
  }
  // Clear paid_date if marked unpaid and caller didn't explicitly set one
  if (!payload.is_paid && body.paid_date === undefined) {
    payload.paid_date = null;
  }

  if (existing) {
    db.prepare(`
      UPDATE payments SET amount=@amount, is_paid=@is_paid, paid_date=@paid_date, due_date=@due_date,
        payment_method=@payment_method, reference_no=@reference_no, notes=@notes, updated_at=datetime('now')
      WHERE booth_id=@boothId AND termin_number=@tNum
    `).run({ ...payload, boothId, tNum });
  } else {
    db.prepare(`
      INSERT INTO payments (booth_id, termin_number, amount, is_paid, paid_date, due_date, payment_method, reference_no, notes)
      VALUES (@boothId, @tNum, @amount, @is_paid, @paid_date, @due_date, @payment_method, @reference_no, @notes)
    `).run({ ...payload, boothId, tNum });
  }

  logActivity(
    req.user.id,
    payload.is_paid ? 'mark_termin_paid' : 'update_termin',
    'payment',
    Number(boothId),
    `Termin ${tNum} for booth #${boothId} (${booth.company_name}) ${payload.is_paid ? 'marked PAID' : 'updated'}${payload.paid_date ? ' on ' + payload.paid_date : ''}`
  );

  const row = db.prepare('SELECT * FROM payments WHERE booth_id = ? AND termin_number = ?').get(boothId, tNum);
  res.json({ payment: row });
});

// Dashboard-wide payment summary (optionally filtered by event)
// Amounts are grouped by currency (IDR/USD) since they must never be summed together.
router.get('/summary', (req, res) => {
  const { event_id } = req.query;
  const where = event_id ? 'WHERE b.event_id = ?' : '';
  const params = event_id ? [event_id] : [];

  const byCurrency = db.prepare(`
    SELECT
      COALESCE(b.currency, 'IDR') AS currency,
      COALESCE(SUM(p.amount), 0) AS totalPlanned,
      COALESCE(SUM(CASE WHEN p.is_paid = 1 THEN p.amount ELSE 0 END), 0) AS totalPaid
    FROM booths b LEFT JOIN payments p ON p.booth_id = b.id
    ${where}
    GROUP BY COALESCE(b.currency, 'IDR')
  `).all(...params);

  const totalsByCurrency = {};
  for (const row of byCurrency) {
    totalsByCurrency[row.currency] = {
      totalPlanned: row.totalPlanned,
      totalPaid: row.totalPaid,
      remaining: Math.max(0, row.totalPlanned - row.totalPaid),
    };
  }

  const counts = db.prepare(`
    SELECT
      COUNT(DISTINCT b.id) AS boothCount,
      COALESCE(SUM(CASE WHEN p.is_paid = 1 THEN 1 ELSE 0 END), 0) AS terminsPaid,
      COUNT(p.id) AS terminsTotal
    FROM booths b LEFT JOIN payments p ON p.booth_id = b.id
    ${where}
  `).get(...params);

  const overdue = db.prepare(`
    SELECT b.id AS booth_id, b.company_name, b.currency, p.termin_number, p.amount, p.due_date
    FROM payments p JOIN booths b ON b.id = p.booth_id
    ${where ? where + ' AND' : 'WHERE'} p.is_paid = 0 AND p.due_date IS NOT NULL AND p.due_date < date('now')
    ORDER BY p.due_date ASC LIMIT 10
  `).all(...params);

  // Backward-compatible top-level fields reflect IDR only (the dominant/legacy currency);
  // full breakdown is in totalsByCurrency for currency-aware UIs.
  const idr = totalsByCurrency.IDR || { totalPlanned: 0, totalPaid: 0, remaining: 0 };

  res.json({
    totalPlanned: idr.totalPlanned,
    totalPaid: idr.totalPaid,
    remaining: idr.remaining,
    totalsByCurrency,
    boothCount: counts.boothCount,
    terminsPaid: counts.terminsPaid,
    terminsTotal: counts.terminsTotal,
    overdue,
  });
});

module.exports = router;
