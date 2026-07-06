// Seed script: creates default users, a default event, and imports sample rows
// resembling the "DB OSI Ver 3.0 2026 - Booking Stand 2027" sheet.
const bcrypt = require('bcryptjs');
const { db } = require('./index');
const { getHallsForEvent, hallCode, HALL_SLOT_COUNTS, isInternationalEvent } = require('../lib/halls');

function upsertUser({ name, username, password, role, avatar_color }) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return existing.id;
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(
      'INSERT INTO users (name, username, password_hash, role, avatar_color) VALUES (?,?,?,?,?)'
    )
    .run(name, username, hash, role, avatar_color);
  return info.lastInsertRowid;
}

function upsertEvent({ name, location, start_date, end_date }) {
  const existing = db.prepare('SELECT id FROM events WHERE name = ?').get(name);
  if (existing) return existing.id;
  const info = db
    .prepare(
      'INSERT INTO events (name, location, start_date, end_date) VALUES (?,?,?,?)'
    )
    .run(name, location, start_date, end_date);
  return info.lastInsertRowid;
}

console.log('Seeding database...');

upsertUser({ name: 'Administrator', username: 'admin', password: 'admin123', role: 'admin', avatar_color: '#2563eb' });
upsertUser({ name: 'Ronald (PT. OSI)', username: 'staff', password: 'staff123', role: 'staff', avatar_color: '#16a34a' });
upsertUser({ name: 'Viewer', username: 'viewer', password: 'viewer123', role: 'viewer', avatar_color: '#9333ea' });

const eventId = upsertEvent({
  name: 'Hospital Expo - Booking Stand 2027',
  location: 'Indonesia',
  start_date: '2027-01-01',
  end_date: '2027-01-04',
});

// A second demo event whose title contains "International" so both booth-plot
// layouts (domestic vs. international) are represented out of the box.
const intlEventId = upsertEvent({
  name: "Hospital Expo Int'l 2027",
  location: 'Jakarta International Convention Center',
  start_date: '2027-03-10',
  end_date: '2027-03-13',
});

const countBooths = db.prepare('SELECT COUNT(*) as c FROM booths WHERE event_id = ?').get(eventId).c;

if (countBooths === 0) {
  const insert = db.prepare(`
    INSERT INTO booths (
      event_id, keterangan, nomor_booth, country, company_name, npwp, no_va,
      qty_size, qty_std, qty_exh, confirm_size, confirm_std, confirm_exh,
      type_ss, type_rs, foyer, shipping_address, no_npwp, npwp_address,
      exhibition, contact_name, contact_phone, contact_email, status,
      spk_date, spk_number, contract_value, termin_count, created_by
    ) VALUES (@event_id, @keterangan, @nomor_booth, @country, @company_name, @npwp, @no_va,
      @qty_size, @qty_std, @qty_exh, @confirm_size, @confirm_std, @confirm_exh,
      @type_ss, @type_rs, @foyer, @shipping_address, @no_npwp, @npwp_address,
      @exhibition, @contact_name, @contact_phone, @contact_email, @status,
      @spk_date, @spk_number, @contract_value, @termin_count, @created_by)
  `);

  const rows = [
    {
      event_id: eventId,
      keterangan: 'MEDAN',
      nomor_booth: 'C21',
      country: 'INDONESIA',
      company_name: 'VISI YOSINDO',
      npwp: '',
      no_va: '',
      qty_size: '', qty_std: 1, qty_exh: 0,
      confirm_size: '', confirm_std: 1, confirm_exh: 0,
      type_ss: 0, type_rs: 0,
      foyer: '', shipping_address: '', no_npwp: '', npwp_address: '',
      exhibition: '', contact_name: '', contact_phone: '', contact_email: '',
      status: 'confirmed',
      spk_date: '2026-06-01', spk_number: 'SPK/2026/001', contract_value: 60000000, termin_count: 3,
      created_by: 1,
    },
    {
      event_id: eventId,
      keterangan: 'SBY',
      nomor_booth: '',
      country: '',
      company_name: 'ANDSON',
      npwp: '',
      no_va: 'Ronald PT. OSI',
      qty_size: '', qty_std: 0, qty_exh: 0,
      confirm_size: '', confirm_std: 0, confirm_exh: 0,
      type_ss: 0, type_rs: 0,
      foyer: '', shipping_address: '', no_npwp: '', npwp_address: '',
      exhibition: '', contact_name: '', contact_phone: '', contact_email: '',
      status: 'pending',
      spk_date: null, spk_number: null, contract_value: 0, termin_count: 1,
      created_by: 1,
    },
  ];

  const insertMany = db.transaction((rows) => {
    for (const r of rows) insert.run(r);
  });
  insertMany(rows);
  console.log(`Inserted ${rows.length} sample booth rows for event #${eventId}`);

  // Seed a realistic termin payment schedule for the confirmed VISI YOSINDO booth (3 termins, T1 & T2 paid)
  const visiBooth = db.prepare("SELECT id FROM booths WHERE company_name = 'VISI YOSINDO' AND event_id = ?").get(eventId);
  if (visiBooth) {
    const insertPayment = db.prepare(`
      INSERT OR IGNORE INTO payments (booth_id, termin_number, amount, is_paid, paid_date, due_date, payment_method, reference_no)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertPayment.run(visiBooth.id, 1, 20000000, 1, '2026-06-10', '2026-06-10', 'Bank Transfer', 'TRF-0001');
    insertPayment.run(visiBooth.id, 2, 20000000, 1, '2026-07-01', '2026-07-01', 'Bank Transfer', 'TRF-0002');
    insertPayment.run(visiBooth.id, 3, 20000000, 0, null, '2026-08-01', null, null);
    console.log('Seeded a 3-termin payment schedule (T1 & T2 paid) for VISI YOSINDO');
  }
} else {
  console.log('Booths already seeded, skipping sample rows.');
}

// ---- Booth Inventory: auto-generated per event based on its title ----
// International events (title has "Int'l"/"International") get Hall 5-10 + Ambulance.
// All other events get the domestic plot: Convention / Foyer / Exhibition / Ambulance.
function generateBoothInventory(eventId, eventName) {
  const existingCount = db.prepare('SELECT COUNT(*) AS c FROM booth_inventory WHERE event_id = ?').get(eventId).c;
  if (existingCount > 0) {
    console.log(`Booth inventory already exists for event #${eventId} (${existingCount} slots), skipping.`);
    return;
  }
  const insert = db.prepare(`
    INSERT INTO booth_inventory (event_id, hall, booth_number, size, status)
    VALUES (@event_id, @hall, @booth_number, @size, 'available')
  `);
  const insertMany = db.transaction((rows) => {
    for (const r of rows) insert.run(r);
  });

  const halls = getHallsForEvent(eventName);
  const sizes = ['3x3', '3x6', '6x6'];
  const rows = [];
  halls.forEach((hall) => {
    const count = HALL_SLOT_COUNTS[hall] || 100;
    for (let i = 1; i <= count; i++) {
      rows.push({
        event_id: eventId,
        hall,
        booth_number: `${hallCode(hall)}-${String(i).padStart(3, '0')}`,
        size: sizes[i % sizes.length],
      });
    }
  });
  insertMany(rows);
  console.log(`Generated booth inventory: ${rows.length} slots across ${halls.length} halls (${isInternationalEvent(eventName) ? 'International plot' : 'Domestic plot'}) for event #${eventId} "${eventName}"`);
}

generateBoothInventory(eventId, 'Hospital Expo - Booking Stand 2027');
generateBoothInventory(intlEventId, "Hospital Expo Int'l 2027");

console.log('Seed complete.');
console.log('Default logins:');
console.log('  admin  / admin123   (Admin - full access)');
console.log('  staff  / staff123   (Staff - can manage bookings)');
console.log('  viewer / viewer123  (Viewer - read only)');
