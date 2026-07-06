-- Hospital Expo Booth Booking System - Database Schema (SQLite)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','staff','viewer')) DEFAULT 'viewer',
  avatar_color TEXT DEFAULT '#2563eb',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,     -- e.g. "Hospital Expo 2026"
  location TEXT,
  start_date TEXT,
  end_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS booths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  keterangan TEXT,              -- KETERANGAN (city/region grouping e.g. MEDAN, SBY) - legacy field, kept for non-hall events
  nomor_booth TEXT,             -- NOMOR BOOTH e.g. C21 (legacy single-booth text; superseded by booking_booths for multi-booth bookings)
  country TEXT DEFAULT 'INDONESIA',
  company_name TEXT NOT NULL,   -- COMPANY NAME (NPWP)
  npwp TEXT,
  no_va TEXT,                   -- NO. VA (virtual account number)

  qty_size TEXT,                -- QUANTITY - SIZE
  qty_std INTEGER DEFAULT 0,    -- QUANTITY - STD
  qty_exh INTEGER DEFAULT 0,    -- QUANTITY - EXH

  confirm_size TEXT,            -- CONFIRM - SIZE
  confirm_std INTEGER DEFAULT 0,-- CONFIRM - STD
  confirm_exh INTEGER DEFAULT 0,-- CONFIRM - EXH

  type_ss INTEGER DEFAULT 0,    -- TYPE - SS
  type_rs INTEGER DEFAULT 0,    -- TYPE - RS

  foyer TEXT,                   -- FOYER info
  shipping_address TEXT,
  no_npwp TEXT,                 -- NO. NPWP
  npwp_address TEXT,

  exhibition TEXT,              -- EXHIBITION
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
  notes TEXT,

  spk_date TEXT,                 -- SPK (Surat Perintah Kerja / work order) date
  spk_number TEXT,                -- SPK reference number
  contract_value REAL DEFAULT 0,  -- total contract value to be split across termin payments
  currency TEXT NOT NULL DEFAULT 'IDR' CHECK (currency IN ('IDR','USD')), -- currency of contract_value / termin amounts
  termin_count INTEGER NOT NULL DEFAULT 1 CHECK (termin_count BETWEEN 1 AND 6), -- max 6 installments

  booth_types TEXT,             -- JSON array of selected booth types for this booking, e.g. ["Standard","Space Only"]

  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Master inventory of every physical booth slot available at a venue for an event
-- (e.g. ~1000 booths across Hall 5, Hall 6, ... Hall 10, Ambulance)
CREATE TABLE IF NOT EXISTS booth_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  hall TEXT NOT NULL,            -- 'Hall 5','Hall 6','Hall 7','Hall 8','Hall 9','Hall 10','Ambulance'
  booth_number TEXT NOT NULL,    -- e.g. 'H5-A01'
  size TEXT,                     -- e.g. '3x3'
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','booked','blocked')),
  booking_id INTEGER REFERENCES booths(id) ON DELETE SET NULL, -- which booking currently occupies this booth slot, if any
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, hall, booth_number)
);

-- Junction table: one booking (booths.id) can claim multiple physical booth slots (booth_inventory.id)
CREATE TABLE IF NOT EXISTS booking_booths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES booths(id) ON DELETE CASCADE,
  inventory_id INTEGER NOT NULL REFERENCES booth_inventory(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(booking_id, inventory_id),
  UNIQUE(inventory_id)  -- a physical booth slot can only be attached to one booking at a time
);

CREATE INDEX IF NOT EXISTS idx_booth_inventory_event ON booth_inventory(event_id);
CREATE INDEX IF NOT EXISTS idx_booth_inventory_hall ON booth_inventory(hall);
CREATE INDEX IF NOT EXISTS idx_booth_inventory_status ON booth_inventory(status);
CREATE INDEX IF NOT EXISTS idx_booking_booths_booking ON booking_booths(booking_id);


CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booth_id INTEGER NOT NULL REFERENCES booths(id) ON DELETE CASCADE,
  termin_number INTEGER NOT NULL CHECK (termin_number BETWEEN 1 AND 6), -- T1..T6
  amount REAL DEFAULT 0,
  is_paid INTEGER NOT NULL DEFAULT 0,
  paid_date TEXT,                 -- date this termin was actually paid
  due_date TEXT,                  -- optional planned due date for this termin
  payment_method TEXT,            -- e.g. Transfer, VA, Cash
  reference_no TEXT,              -- bank ref / receipt no.
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(booth_id, termin_number)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,          -- e.g. 'create_booth', 'login', 'delete_booth'
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_booths_event ON booths(event_id);
CREATE INDEX IF NOT EXISTS idx_booths_status ON booths(status);
CREATE INDEX IF NOT EXISTS idx_booths_company ON booths(company_name);
CREATE INDEX IF NOT EXISTS idx_payments_booth ON payments(booth_id);

