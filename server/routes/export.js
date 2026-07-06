const express = require('express');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const { db } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

router.get('/booths.xlsx', (req, res) => {
  const { event_id } = req.query;
  const where = event_id ? 'WHERE b.event_id = ?' : '';
  const params = event_id ? [event_id] : [];

  const rows = db.prepare(`
    SELECT
      b.id AS "_ID",
      b.keterangan AS KETERANGAN,
      b.nomor_booth AS "NOMOR BOOTH",
      b.booth_types AS "BOOTH TYPES",
      b.country AS COUNTRY,
      b.company_name AS "COMPANY NAME (NPWP)",
      b.no_va AS "NO. VA",
      b.qty_size AS "QTY SIZE",
      b.qty_std AS "QTY STD",
      b.qty_exh AS "QTY EXH",
      b.confirm_size AS "CONFIRM SIZE",
      b.confirm_std AS "CONFIRM STD",
      b.confirm_exh AS "CONFIRM EXH",
      b.type_ss AS "TYPE SS",
      b.type_rs AS "TYPE RS",
      b.shipping_address AS "SHIPPING ADDRESS",
      b.no_npwp AS "NO. NPWP",
      b.npwp_address AS "NPWP ADDRESS",
      b.contact_name AS "CONTACT NAME",
      b.contact_phone AS "CONTACT PHONE",
      b.contact_email AS "CONTACT EMAIL",
      b.status AS STATUS,
      b.spk_date AS "SPK DATE",
      b.spk_number AS "SPK NUMBER",
      b.currency AS CURRENCY,
      b.contract_value AS "CONTRACT VALUE",
      b.termin_count AS "TERMIN COUNT",
      (SELECT COUNT(*) FROM payments p WHERE p.booth_id = b.id AND p.is_paid = 1) AS "TERMINS PAID",
      (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.booth_id = b.id AND p.is_paid = 1) AS "AMOUNT PAID",
      e.name AS EVENT
    FROM booths b LEFT JOIN events e ON e.id = b.event_id
    ${where}
    ORDER BY b.id ASC
  `).all(...params);

  // Attach a "HALL / BOOTH(S)" column derived from the multi-booth junction table,
  // and clean up the internal _ID / BOOTH TYPES helper columns into human-friendly output.
  const boothIdsForExport = rows.map(r => r._ID);
  let assignedMap = {};
  if (boothIdsForExport.length) {
    const placeholders = boothIdsForExport.map(() => '?').join(',');
    const links = db.prepare(`
      SELECT bb.booking_id, bi.hall, bi.booth_number
      FROM booking_booths bb JOIN booth_inventory bi ON bi.id = bb.inventory_id
      WHERE bb.booking_id IN (${placeholders})
      ORDER BY bi.hall ASC, bi.booth_number ASC
    `).all(...boothIdsForExport);
    for (const link of links) {
      if (!assignedMap[link.booking_id]) assignedMap[link.booking_id] = { halls: new Set(), booths: [] };
      assignedMap[link.booking_id].halls.add(link.hall);
      assignedMap[link.booking_id].booths.push(link.booth_number);
    }
  }
  rows.forEach((r) => {
    const info = assignedMap[r._ID];
    r['HALL'] = info ? Array.from(info.halls).join(', ') : (r.KETERANGAN || '');
    r['BOOTH NUMBER(S)'] = info ? info.booths.join(', ') : (r['NOMOR BOOTH'] || '');
    let types = [];
    try { types = r['BOOTH TYPES'] ? JSON.parse(r['BOOTH TYPES']) : []; } catch (e) { types = []; }
    r['BOOTH TYPES'] = types.join(', ');
    delete r._ID;
    delete r.KETERANGAN;
    delete r['NOMOR BOOTH'];
  });

  // Detailed per-termin payment sheet (T1..T6 columns showing paid date or blank)
  const boothIds = db.prepare(`SELECT b.id FROM booths b ${where}`).all(...params).map(r => r.id);
  const paymentRows = [];
  if (boothIds.length) {
    const placeholders = boothIds.map(() => '?').join(',');
    const booths = db.prepare(`SELECT id, company_name, nomor_booth, spk_date, spk_number, termin_count FROM booths WHERE id IN (${placeholders})`).all(...boothIds);
    const payments = db.prepare(`SELECT * FROM payments WHERE booth_id IN (${placeholders}) ORDER BY booth_id, termin_number`).all(...boothIds);
    for (const b of booths) {
      const boothPayments = payments.filter(p => p.booth_id === b.id);
      const row = {
        'COMPANY NAME': b.company_name,
        'BOOTH #': b.nomor_booth,
        'SPK DATE': b.spk_date || '',
        'SPK NUMBER': b.spk_number || '',
      };
      for (let t = 1; t <= 6; t++) {
        const p = boothPayments.find(x => x.termin_number === t);
        row[`T${t}`] = p ? (p.is_paid ? `PAID (${p.paid_date || ''})` : 'UNPAID') : '-';
      }
      paymentRows.push(row);
    }
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Booth Bookings');
  const wsPayments = XLSX.utils.json_to_sheet(paymentRows);
  XLSX.utils.book_append_sheet(wb, wsPayments, 'Payment Termin (T1-T6)');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename="hospital-expo-booths.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

router.get('/booths.pdf', (req, res) => {
  const { event_id } = req.query;
  const where = event_id ? 'WHERE b.event_id = ?' : '';
  const params = event_id ? [event_id] : [];

  const rows = db.prepare(`
    SELECT b.*, e.name AS event_name,
      (SELECT COUNT(*) FROM payments p WHERE p.booth_id = b.id AND p.is_paid = 1) AS termins_paid,
      (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.booth_id = b.id AND p.is_paid = 1) AS amount_paid
    FROM booths b LEFT JOIN events e ON e.id = b.event_id
    ${where}
    ORDER BY b.id ASC
  `).all(...params);

  const pdfBoothIds = rows.map(r => r.id);
  let pdfAssignedMap = {};
  if (pdfBoothIds.length) {
    const placeholders = pdfBoothIds.map(() => '?').join(',');
    const links = db.prepare(`
      SELECT bb.booking_id, bi.hall, bi.booth_number
      FROM booking_booths bb JOIN booth_inventory bi ON bi.id = bb.inventory_id
      WHERE bb.booking_id IN (${placeholders})
      ORDER BY bi.hall ASC, bi.booth_number ASC
    `).all(...pdfBoothIds);
    for (const link of links) {
      if (!pdfAssignedMap[link.booking_id]) pdfAssignedMap[link.booking_id] = { halls: new Set(), booths: [] };
      pdfAssignedMap[link.booking_id].halls.add(link.hall);
      pdfAssignedMap[link.booking_id].booths.push(link.booth_number);
    }
  }
  rows.forEach((r) => {
    const info = pdfAssignedMap[r.id];
    r._hall = info ? Array.from(info.halls).join(', ') : (r.keterangan || '-');
    r._booths = info ? info.booths.join(', ') : (r.nomor_booth || '-');
    let types = [];
    try { types = r.booth_types ? JSON.parse(r.booth_types) : []; } catch (e) { types = []; }
    r._boothTypes = types.join(', ') || '-';
  });

  const eventName = event_id
    ? (db.prepare('SELECT name FROM events WHERE id = ?').get(event_id) || {}).name
    : 'All Events';

  const doc = new PDFDocument({ margin: 32, size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Disposition', 'attachment; filename="hospital-expo-booths.pdf"');
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  // Header
  doc.fillColor('#4f46e5').fontSize(20).font('Helvetica-Bold').text('Hospital Expo — Booth Booking Report', { align: 'left' });
  doc.moveDown(0.2);
  doc.fillColor('#6b7383').fontSize(10).font('Helvetica')
    .text(`Event: ${eventName || 'All Events'}    |    Generated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}    |    Total records: ${rows.length}`);
  doc.moveDown(0.8);

  const columns = [
    { key: '_hall', label: 'Hall', width: 55 },
    { key: '_booths', label: 'Booth(s)', width: 70 },
    { key: '_boothTypes', label: 'Type', width: 60 },
    { key: 'company_name', label: 'Company (NPWP)', width: 115 },
    { key: 'no_va', label: 'No. VA', width: 52 },
    { key: 'confirm_std', label: 'STD', width: 26 },
    { key: 'confirm_exh', label: 'EXH', width: 26 },
    { key: 'contact_name', label: 'Contact', width: 65 },
    { key: 'status', label: 'Status', width: 50 },
    { key: 'spk_date', label: 'SPK Date', width: 55 },
    { key: 'spk_number', label: 'SPK No.', width: 60 },
    { key: 'contract_value', label: 'Contract Value', width: 72, derive: (r) => r.contract_value
        ? (r.currency === 'USD' ? '$' + Number(r.contract_value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Rp ' + Number(r.contract_value).toLocaleString('id-ID'))
        : '-' },
    { key: 'termin_progress', label: 'Termin', width: 42, derive: (r) => `${r.termins_paid || 0}/${r.termin_count || 1}` },
  ];

  const startX = doc.page.margins.left;
  let y = doc.y;
  const rowHeight = 20;
  const tableWidth = columns.reduce((s, c) => s + c.width, 0);

  function drawHeader() {
    doc.rect(startX, y, tableWidth, rowHeight).fill('#4f46e5');
    doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold');
    let x = startX;
    for (const col of columns) {
      doc.text(col.label, x + 4, y + 6, { width: col.width - 8, ellipsis: true });
      x += col.width;
    }
    y += rowHeight;
  }

  function ensureSpace() {
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage({ margin: 32, size: 'A4', layout: 'landscape' });
      y = doc.page.margins.top;
      drawHeader();
    }
  }

  drawHeader();
  doc.font('Helvetica').fontSize(8.5);

  rows.forEach((r, idx) => {
    ensureSpace();
    if (idx % 2 === 0) {
      doc.rect(startX, y, tableWidth, rowHeight).fill('#f6f8fc');
    }
    doc.fillColor('#171c2c');
    let x = startX;
    for (const col of columns) {
      let val;
      if (col.derive) {
        val = col.derive(r);
      } else if (col.format) {
        val = col.format(r[col.key]);
      } else {
        val = r[col.key] === null || r[col.key] === undefined ? '-' : String(r[col.key]);
      }
      doc.text(val === '' ? '-' : val, x + 4, y + 6, { width: col.width - 8, ellipsis: true });
      x += col.width;
    }
    // row border
    doc.moveTo(startX, y + rowHeight).lineTo(startX + tableWidth, y + rowHeight).strokeColor('#e6e9f2').lineWidth(0.5).stroke();
    y += rowHeight;
  });

  if (rows.length === 0) {
    doc.fillColor('#6b7383').fontSize(11).text('No booking records found.', startX, y + 10);
  }

  doc.end();
});

module.exports = router;
