// Run with: node scripts/migrate.cjs
// Reads DATABASE_URL from env (loads .env if present) and applies db/schema.sql.
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

try {
  require("dotenv").config();
} catch {
  // dotenv is optional — skip silently if not installed
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Add it to .env or export it before running.");
  process.exit(1);
}

const sslDisabled = process.env.DATABASE_SSL === "false";
const client = new Client({
  connectionString,
  ssl: sslDisabled ? undefined : { rejectUnauthorized: false }
});

const sqlPath = path.join(__dirname, "..", "db", "schema.sql");
const sql = fs.readFileSync(sqlPath, "utf-8");

async function run() {
  try {
    await client.connect();
    console.log(`Connected to ${new URL(connectionString).host}`);
    await client.query(sql);
    console.log("Migration complete — tables ready.");
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
