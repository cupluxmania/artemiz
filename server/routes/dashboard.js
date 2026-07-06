const express = require('express');
const { db } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

router.get('/stats', (req, res) => {
  const { event_id } = req.query;
  const where = event_id ? 'WHERE event_id = ?' : '';
  const params = event_id ? [event_id] : [];

  const totalBooths = db.prepare(`SELECT COUNT(*) c FROM booths ${where}`).get(...params).c;
  const confirmed = db.prepare(`SELECT COUNT(*) c FROM booths ${where ? where + ' AND' : 'WHERE'} status = 'confirmed'`).get(...params).c;
  const pending = db.prepare(`SELECT COUNT(*) c FROM booths ${where ? where + ' AND' : 'WHERE'} status = 'pending'`).get(...params).c;
  const cancelled = db.prepare(`SELECT COUNT(*) c FROM booths ${where ? where + ' AND' : 'WHERE'} status = 'cancelled'`).get(...params).c;

  const totalStd = db.prepare(`SELECT COALESCE(SUM(confirm_std),0) s FROM booths ${where}`).get(...params).s;
  const totalExh = db.prepare(`SELECT COALESCE(SUM(confirm_exh),0) s FROM booths ${where}`).get(...params).s;
  const totalSs = db.prepare(`SELECT COALESCE(SUM(type_ss),0) s FROM booths ${where}`).get(...params).s;
  const totalRs = db.prepare(`SELECT COALESCE(SUM(type_rs),0) s FROM booths ${where}`).get(...params).s;

  const byCountry = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(country),''),'Unspecified') AS country, COUNT(*) AS c
    FROM booths ${where}
    GROUP BY country ORDER BY c DESC LIMIT 10
  `).all(...params);

  const byCity = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(keterangan),''),'Unspecified') AS city, COUNT(*) AS c
    FROM booths ${where}
    GROUP BY city ORDER BY c DESC LIMIT 10
  `).all(...params);

  const recent = db.prepare(`
    SELECT b.id, b.company_name, b.nomor_booth, b.status, b.updated_at, e.name AS event_name
    FROM booths b LEFT JOIN events e ON e.id = b.event_id
    ${where}
    ORDER BY b.updated_at DESC LIMIT 8
  `).all(...params);

  const events = db.prepare(`
    SELECT e.id, e.name, COUNT(b.id) AS booth_count
    FROM events e LEFT JOIN booths b ON b.event_id = e.id
    GROUP BY e.id ORDER BY e.created_at DESC
  `).all();

  res.json({
    totals: { totalBooths, confirmed, pending, cancelled, totalStd, totalExh, totalSs, totalRs },
    byCountry, byCity, recent, events,
  });
});

router.get('/activity', (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.name AS user_name, u.username
    FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC LIMIT 50
  `).all();
  res.json({ rows });
});

module.exports = router;
