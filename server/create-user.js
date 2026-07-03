// Creates (or resets the password of) a dashboard login. Run from the project root:
//
//   npm run create-user -- <username> <password> ["Display Name"]
//
// This is a CLI-only, admin-run script — there's no public signup form, since this is an
// internal support-team tool, not a product with self-serve accounts.
require("dotenv").config();
const db = require("./db");
const { hashPassword } = require("./auth");

async function main() {
  const [username, password, displayName] = process.argv.slice(2);

  if (!username || !password) {
    console.error("Usage: npm run create-user -- <username> <password> [\"Display Name\"]");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  try {
    await db.initDb(); // ensures the users table exists even on a brand new database
    const passwordHash = await hashPassword(password);
    const user = await db.createUser({
      username: username.trim().toLowerCase(),
      passwordHash,
      displayName: displayName || username,
    });
    console.log(`\n[create-user] Saved login for "${user.username}" (${user.display_name}).\n`);
  } catch (err) {
    console.error("[create-user] Failed:", err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

main();
