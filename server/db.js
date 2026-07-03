const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("\n[db] DATABASE_URL is not set. Add a Postgres connection string to your .env file.\n");
}

const useSsl = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await pool.query(schema);
  console.log("[db] Schema ready.");
}

function nowTime() {
  return new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function rowToConversation(row) {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel,
    handle: row.handle,
    externalId: row.external_id,
    tag: row.tag,
    unread: row.unread,
    online: row.online,
    lastAt: row.last_at,
    updatedAt: Number(row.updated_at),
    messages: row.messages || [],
  };
}

const CONVERSATION_SELECT = `
  SELECT
    c.*,
    COALESCE(
      json_agg(
        json_build_object('from', m.from_who, 'text', m.text, 'time', m.time, 'status', m.status, 'agent', m.agent)
        ORDER BY m.id
      ) FILTER (WHERE m.id IS NOT NULL),
      '[]'
    ) AS messages
  FROM conversations c
  LEFT JOIN messages m ON m.conversation_id = c.id
`;

async function getConversations() {
  const { rows } = await pool.query(`${CONVERSATION_SELECT} GROUP BY c.id ORDER BY c.updated_at DESC`);
  return rows.map(rowToConversation);
}

async function getConversation(id) {
  const { rows } = await pool.query(`${CONVERSATION_SELECT} WHERE c.id = $1 GROUP BY c.id`, [id]);
  return rows.length ? rowToConversation(rows[0]) : null;
}

async function upsertConversation({ id, name, channel, handle, externalId }) {
  const { rows } = await pool.query(
    `INSERT INTO conversations (id, name, channel, handle, external_id, last_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [id, name, channel, handle, externalId, nowTime(), Date.now()]
  );
  if (rows.length) return rowToConversation({ ...rows[0], messages: [] });
  return getConversation(id);
}

async function addMessage(convId, { from, text, status, agent }) {
  const time = nowTime();
  const { rows } = await pool.query(
    `INSERT INTO messages (conversation_id, from_who, text, time, status, agent, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING from_who AS "from", text, time, status, agent`,
    [convId, from, text, time, status || null, agent || null, Date.now()]
  );
  await pool.query(
    `UPDATE conversations
     SET last_at = $1, updated_at = $2, unread = unread + $3
     WHERE id = $4`,
    [time, Date.now(), from === "them" ? 1 : 0, convId]
  );
  return rows[0];
}

async function markRead(convId) {
  await pool.query(`UPDATE conversations SET unread = 0 WHERE id = $1`, [convId]);
}

async function getUserByUsername(username) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
  return rows[0] || null;
}

async function createUser({ username, passwordHash, displayName }) {
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, display_name, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name
     RETURNING id, username, display_name`,
    [username, passwordHash, displayName || username, Date.now()]
  );
  return rows[0];
}

module.exports = {
  pool,
  initDb,
  getConversations,
  getConversation,
  upsertConversation,
  addMessage,
  markRead,
  getUserByUsername,
  createUser,
};
