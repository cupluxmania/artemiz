const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'expo.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const isNew = !fs.existsSync(DB_PATH);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Always ensure schema exists (idempotent, uses IF NOT EXISTS)
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// ---- Lightweight migrations for columns added after initial release ----
function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}
function addColumnIfMissing(table, column, definition) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing('booths', 'spk_date', 'TEXT');
addColumnIfMissing('booths', 'spk_number', 'TEXT');
addColumnIfMissing('booths', 'contract_value', 'REAL DEFAULT 0');
addColumnIfMissing('booths', 'termin_count', 'INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('booths', 'currency', "TEXT NOT NULL DEFAULT 'IDR'");
addColumnIfMissing('booths', 'booth_types', 'TEXT');

module.exports = { db, isNew };

