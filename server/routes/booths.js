const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { db } = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.use(authRequired);

const FIELDS = [
  'event_id', 'keterangan', 'nomor_booth', 'country', 'company_name', 'npwp', 'no_va',
  'qty_size', 'qty_std', 'qty_exh', 'confirm_size', 'confirm_std', 'confirm_exh',
  'type_ss', 'type_rs', 'foyer', 'shipping_address', 'no_npwp', 'npwp_address',
  'exhibition', 'contact_name', 'contact_phone', 'contact_email', 'status', 'notes',
  'spk_date', 'spk_number', 'contract_value', 'currency', 'termin_count', 'booth_types',
];

// Ensure a booth has exactly `termin_count` payment rows (T1..Tn), preserving existing ones.
function ensurePaymentRows(boothId, terminCount, contractValue) {
  const existing = db.prepare('SELECT termin_number FROM payments WHERE booth_id = ?').all(boothId).map(r => r.termin_number);
  const missing = [];
  for (let t = 1; t <= terminCount; t++) if (!existing.includes(t)) missing.push(t);

  // Split evenly to whole currency units; the last new termin absorbs any rounding
  // remainder so the sum of all termin amounts always equals the contract value exactly.
  const total = Math.round((contractValue || 0) * 100); // work in cents to avoid float drift
  const perTerminCents = terminCount > 0 ? Math.floor(total / terminCount) : 0;
  const remainderCents = terminCount > 0 ? total - perTerminCents * terminCount : 0;

  const insert = db.prepare(`
    INSERT INTO payments (booth_id, termin_number, amount, is_paid)
    VALUES (?, ?, ?, 0)
  `);
  missing.forEach((t, idx) => {
    const isLast = idx === missing.length - 1;
    const amountCents = perTerminCents + (isLast ? remainderCents : 0);
    insert.run(boothId, t, Math.round(amountCents) / 100);
  });

  // Remove payment rows beyond the new termin_count (only if unpaid, to avoid losing paid records)
  const toRemove = db.prepare('SELECT id, termin_number, is_paid FROM payments WHERE booth_id = ? AND termin_number > ?').all(boothId, terminCount);
  for (const row of toRemove) {
    if (!row.is_paid) {
      db.prepare('DELETE FROM payments WHERE id = ?').run(row.id);
    }
  }
}

function logActivity(userId, action, entity, entityId, details) {
  db.prepare(
    'INSERT INTO activity_log (user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)'
  ).run(userId, action, entity || null, entityId || null, details || null);
}

// Assign a set of booth_inventory rows to a booking, releasing any previously assigned
// slots that are no longer in the new set. Throws if any requested slot is already booked
// by a different booking.
function assignBoothInventory(bookingId, eventId, inventoryIds) {
  const desired = Array.from(new Set((inventoryIds || []).map((n) => Number(n)).filter(Boolean)));

  if (desired.length) {
    const placeholders = desired.map(() => '?').join(',');
    const slots = db.prepare(`SELECT * FROM booth_inventory WHERE id IN (${placeholders})`).all(...desired);
    if (slots.length !== desired.length) {
      throw new Error('One or more selected booth slots do not exist');
    }
    for (const slot of slots) {
      if (slot.event_id !== eventId) {
        throw new Error(`Booth ${slot.booth_number} does not belong to the selected event`);
      }
      if (slot.status === 'booked' && slot.booking_id !== bookingId) {
        throw new Error(`Booth ${slot.booth_number} is already booked by another company`);
      }
      if (slot.status === 'blocked') {
        throw new Error(`Booth ${slot.booth_number} is blocked and cannot be assigned`);
      }
    }
  }

  const current = db.prepare('SELECT inventory_id FROM booking_booths WHERE booking_id = ?').all(bookingId).map(r => r.inventory_id);
  const toRelease = current.filter((id) => !desired.includes(id));
  const toAdd = desired.filter((id) => !current.includes(id));

  if (toRelease.length) {
    const placeholders = toRelease.map(() => '?').join(',');
    db.prepare(`DELETE FROM booking_booths WHERE booking_id = ? AND inventory_id IN (${placeholders})`).run(bookingId, ...toRelease);
    db.prepare(`UPDATE booth_inventory SET status = 'available', booking_id = NULL, updated_at = datetime('now') WHERE id IN (${placeholders})`).run(...toRelease);
  }
  if (toAdd.length) {
    const insertLink = db.prepare('INSERT OR IGNORE INTO booking_booths (booking_id, inventory_id) VALUES (?, ?)');
    const placeholders = toAdd.map(() => '?').join(',');
    for (const id of toAdd) insertLink.run(bookingId, id);
    db.prepare(`UPDATE booth_inventory SET status = 'booked', booking_id = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`).run(bookingId, ...toAdd);
  }

  return desired;
}

function releaseAllBoothInventory(bookingId) {
  const linked = db.prepare('SELECT inventory_id FROM booking_booths WHERE booking_id = ?').all(bookingId).map(r => r.inventory_id);
  if (linked.length) {
    const placeholders = linked.map(() => '?').join(',');
    db.prepare(`UPDATE booth_inventory SET status = 'available', booking_id = NULL, updated_at = datetime('now') WHERE id IN (${placeholders})`).run(...linked);
  }
  db.prepare('DELETE FROM booking_booths WHERE booking_id = ?').run(bookingId);
}

function getAssignedBooths(bookingId) {
  return db.prepare(`
    SELECT bi.id, bi.hall, bi.booth_number, bi.size
    FROM booking_booths bb JOIN booth_inventory bi ON bi.id = bb.inventory_id
    WHERE bb.booking_id = ?
    ORDER BY bi.hall ASC, bi.booth_number ASC
  `).all(bookingId);
}

// GET list with filters: event_id, status, search, page, pageSize
router.get('/', (req, res) => {
  const { event_id, status, search, page = 1, pageSize = 100 } = req.query;
  const where = [];
  const params = {};
  if (event_id) { where.push('b.event_id = @event_id'); params.event_id = event_id; }
  if (status) { where.push('b.status = @status'); params.status = status; }
  if (search) {
    where.push(`(b.company_name LIKE @search OR b.nomor_booth LIKE @search OR b.keterangan LIKE @search
      OR b.no_va LIKE @search OR b.contact_name LIKE @search OR b.contact_email LIKE @search)`);
    params.search = `%${search}%`;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) as c FROM booths b ${whereSql}`).get(params).c;

  const limit = Math.max(1, Math.min(500, parseInt(pageSize, 10) || 100));
  const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * limit;

  const rows = db.prepare(`
    SELECT b.*, e.name AS event_name, u.name AS created_by_name,
      (SELECT COUNT(*) FROM payments p WHERE p.booth_id = b.id AND p.is_paid = 1) AS termins_paid,
      (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.booth_id = b.id AND p.is_paid = 1) AS amount_paid,
      (SELECT COUNT(*) FROM booking_booths bb WHERE bb.booking_id = b.id) AS booth_count
    FROM booths b
    LEFT JOIN events e ON e.id = b.event_id
    LEFT JOIN users u ON u.id = b.created_by
    ${whereSql}
    ORDER BY b.id DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });

  const boothIds = rows.map(r => r.id);
  let assignedByBooking = {};
  if (boothIds.length) {
    const placeholders = boothIds.map(() => '?').join(',');
    const links = db.prepare(`
      SELECT bb.booking_id, bi.hall, bi.booth_number
      FROM booking_booths bb JOIN booth_inventory bi ON bi.id = bb.inventory_id
      WHERE bb.booking_id IN (${placeholders})
      ORDER BY bi.hall ASC, bi.booth_number ASC
    `).all(...boothIds);
    for (const link of links) {
      if (!assignedByBooking[link.booking_id]) assignedByBooking[link.booking_id] = [];
      assignedByBooking[link.booking_id].push(`${link.hall} / ${link.booth_number}`);
    }
  }
  rows.forEach(r => { r.assigned_booths = assignedByBooking[r.id] || []; });

  res.json({ rows, total, page: Number(page), pageSize: limit });
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM booths WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Booth record not found' });
  row.assigned_booths = getAssignedBooths(row.id);
  res.json({ row });
});

router.post('/', requireRole('admin', 'staff'), (req, res) => {
  const body = req.body || {};
  if (!body.company_name || !body.event_id) {
    return res.status(400).json({ error: 'company_name and event_id are required' });
  }
  const data = {};
  for (const f of FIELDS) data[f] = body[f] !== undefined ? body[f] : null;
  data.termin_count = Math.min(6, Math.max(1, parseInt(data.termin_count, 10) || 1));
  data.contract_value = Number(data.contract_value) || 0;
  data.currency = ['IDR', 'USD'].includes(data.currency) ? data.currency : 'IDR';
  data.booth_types = Array.isArray(body.booth_types) ? JSON.stringify(body.booth_types) : (data.booth_types || null);
  data.status = ['pending', 'confirmed', 'cancelled'].includes(data.status) ? data.status : 'pending';
  data.country = data.country || 'INDONESIA';

  const cols = FIELDS.join(', ');
  const placeholders = FIELDS.map((f) => `@${f}`).join(', ');
  const info = db.prepare(
    `INSERT INTO booths (${cols}, created_by) VALUES (${placeholders}, @created_by)`
  ).run({ ...data, created_by: req.user.id });
  const newId = info.lastInsertRowid;

  ensurePaymentRows(newId, data.termin_count, data.contract_value);

  if (Array.isArray(body.inventory_ids)) {
    try {
      assignBoothInventory(newId, Number(body.event_id), body.inventory_ids);
    } catch (e) {
      db.prepare('DELETE FROM booths WHERE id = ?').run(newId);
      return res.status(400).json({ error: e.message });
    }
  }

  logActivity(req.user.id, 'create_booth', 'booth', newId, `Created booth for ${body.company_name}`);
  const row = db.prepare('SELECT * FROM booths WHERE id = ?').get(newId);
  row.assigned_booths = getAssignedBooths(newId);
  res.status(201).json({ row });
});

router.put('/:id', requireRole('admin', 'staff'), (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM booths WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Booth record not found' });

  const body = req.body || {};
  const data = {};
  for (const f of FIELDS) data[f] = body[f] !== undefined ? body[f] : existing[f];
  data.termin_count = Math.min(6, Math.max(1, parseInt(data.termin_count, 10) || 1));
  data.contract_value = Number(data.contract_value) || 0;
  data.currency = ['IDR', 'USD'].includes(data.currency) ? data.currency : (existing.currency || 'IDR');
  data.booth_types = Array.isArray(body.booth_types) ? JSON.stringify(body.booth_types) : (data.booth_types !== undefined ? data.booth_types : existing.booth_types);

  const setSql = FIELDS.map((f) => `${f} = @${f}`).join(', ');
  db.prepare(
    `UPDATE booths SET ${setSql}, updated_at = datetime('now') WHERE id = @id`
  ).run({ ...data, id });

  // Only auto-fill amounts for termin rows that don't exist yet; never overwrite paid amounts
  ensurePaymentRows(Number(id), data.termin_count, data.contract_value);

  if (Array.isArray(body.inventory_ids)) {
    try {
      assignBoothInventory(Number(id), data.event_id, body.inventory_ids);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  logActivity(req.user.id, 'update_booth', 'booth', id, `Updated booth #${id}`);
  const row = db.prepare('SELECT * FROM booths WHERE id = ?').get(id);
  row.assigned_booths = getAssignedBooths(Number(id));
  res.json({ row });
});

router.delete('/:id', requireRole('admin', 'staff'), (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM booths WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Booth record not found' });
  releaseAllBoothInventory(Number(id));
  db.prepare('DELETE FROM booths WHERE id = ?').run(id);
  logActivity(req.user.id, 'delete_booth', 'booth', id, `Deleted booth for ${existing.company_name}`);
  res.json({ ok: true });
});

// Bulk import (array of rows) - admin/staff only
router.post('/bulk-import', requireRole('admin', 'staff'), (req, res) => {
  const { event_id, rows } = req.body || {};
  if (!event_id || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'event_id and non-empty rows[] are required' });
  }
  const cols = FIELDS.join(', ');
  const placeholders = FIELDS.map((f) => `@${f}`).join(', ');
  const insert = db.prepare(`INSERT INTO booths (${cols}, created_by) VALUES (${placeholders}, @created_by)`);

  let inserted = 0;
  const tx = db.transaction((items) => {
    for (const item of items) {
      const data = { event_id };
      for (const f of FIELDS) {
        if (f === 'event_id') continue;
        data[f] = item[f] !== undefined ? item[f] : null;
      }
      if (!data.company_name) continue;
      insert.run({ ...data, created_by: req.user.id });
      inserted += 1;
    }
  });
  tx(rows);
  logActivity(req.user.id, 'bulk_import', 'booth', null, `Imported ${inserted} rows into event #${event_id}`);
  res.json({ inserted });
});

// Map many possible spreadsheet header spellings -> our column names
const HEADER_MAP = {
  keterangan: 'keterangan',
  'nomor booth': 'nomor_booth', 'no booth': 'nomor_booth', 'booth no': 'nomor_booth', 'nomor_booth': 'nomor_booth', booth: 'nomor_booth',
  country: 'country', negara: 'country',
  'company name': 'company_name', 'company name ( npwp )': 'company_name', 'company name (npwp)': 'company_name', company: 'company_name', 'nama perusahaan': 'company_name', 'company_name': 'company_name',
  npwp: 'npwp',
  'no. va': 'no_va', 'no va': 'no_va', 'nomor va': 'no_va', 'no_va': 'no_va', va: 'no_va',
  'size': 'qty_size', 'quantity size': 'qty_size', 'qty size': 'qty_size', 'qty_size': 'qty_size',
  'std': 'qty_std', 'quantity std': 'qty_std', 'qty std': 'qty_std', 'qty_std': 'qty_std',
  'exh': 'qty_exh', 'quantity exh': 'qty_exh', 'qty exh': 'qty_exh', 'qty_exh': 'qty_exh',
  'confirm size': 'confirm_size', 'confirm_size': 'confirm_size',
  'confirm std': 'confirm_std', 'confirm_std': 'confirm_std',
  'confirm exh': 'confirm_exh', 'confirm_exh': 'confirm_exh',
  'ss': 'type_ss', 'type ss': 'type_ss', 'type_ss': 'type_ss',
  'rs': 'type_rs', 'type rs': 'type_rs', 'type_rs': 'type_rs',
  foyer: 'foyer',
  'shipping address': 'shipping_address', 'shipping_address': 'shipping_address',
  'no. npwp': 'no_npwp', 'no npwp': 'no_npwp', 'no_npwp': 'no_npwp',
  'npwp address': 'npwp_address', 'npwp_address': 'npwp_address',
  exhibition: 'exhibition',
  'name': 'contact_name', 'contact name': 'contact_name', 'contact_name': 'contact_name', 'nama': 'contact_name',
  'm. phone': 'contact_phone', 'phone': 'contact_phone', 'contact phone': 'contact_phone', 'contact_phone': 'contact_phone', 'no hp': 'contact_phone',
  'email': 'contact_email', 'contact email': 'contact_email', 'contact_email': 'contact_email',
  status: 'status', notes: 'notes', keterangan_tambahan: 'notes',
};

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Parse an uploaded .xlsx/.xls/.csv file and return normalized preview rows (no DB write)
router.post('/import-preview', requireRole('admin', 'staff'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = req.body.sheet || wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return res.status(400).json({ error: 'Sheet not found in workbook' });

    const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    const rows = raw.map((r) => {
      const mapped = {};
      for (const key of Object.keys(r)) {
        const norm = normalizeHeader(key);
        const target = HEADER_MAP[norm];
        if (target) mapped[target] = r[key];
      }
      return mapped;
    }).filter((r) => r.company_name && String(r.company_name).trim() !== '');

    // Coerce numeric fields
    const numericFields = ['qty_std', 'qty_exh', 'confirm_std', 'confirm_exh', 'type_ss', 'type_rs'];
    for (const r of rows) {
      for (const f of numericFields) {
        if (r[f] !== undefined) {
          const n = parseInt(String(r[f]).replace(/[^\d-]/g, ''), 10);
          r[f] = Number.isFinite(n) ? n : 0;
        }
      }
      if (!r.status || !['pending', 'confirmed', 'cancelled'].includes(String(r.status).toLowerCase())) {
        r.status = 'pending';
      } else {
        r.status = String(r.status).toLowerCase();
      }
    }

    res.json({ sheetNames: wb.SheetNames, sheetUsed: sheetName, rows, count: rows.length });
  } catch (e) {
    res.status(400).json({ error: 'Could not parse file. Please upload a valid .xlsx, .xls, or .csv file.' });
  }
});

module.exports = router;
