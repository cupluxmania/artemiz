CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  handle TEXT,
  external_id TEXT NOT NULL,
  tag TEXT DEFAULT 'Baru',
  unread INTEGER DEFAULT 0,
  online BOOLEAN DEFAULT true,
  last_at TEXT,
  updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  from_who TEXT NOT NULL,
  text TEXT,
  time TEXT,
  status TEXT,
  created_at BIGINT
);

-- Which logged-in agent sent an outgoing ("me") message. Nullable: incoming messages,
-- and messages sent before this column existed, have no agent attached.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS agent TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);

-- Per-agent dashboard accounts. Created via `npm run create-user`, not through a signup form --
-- this is an internal team tool, not a public product.
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at BIGINT
);

-- Session store for connect-pg-simple (server/auth.js). It also creates this table itself
-- on boot if missing, but declaring it here keeps schema.sql as the single source of truth.
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);
