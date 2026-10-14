import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const databasePath = process.env.DATABASE_PATH;

if (!databasePath) {
  throw new Error(
    "DATABASE_PATH must be set to the SQLite database file location.",
  );
}

mkdirSync(path.dirname(databasePath), { recursive: true });

export const sqlite: Database.Database = new Database(databasePath);
// WAL lets polls read while a move commits; FULL sync keeps acknowledged moves durable.
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = FULL");
sqlite.pragma("busy_timeout = 5000");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS rush10_rooms (
    code TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )
`);

export const db = drizzle(sqlite, { schema });

export * from "./schema";
