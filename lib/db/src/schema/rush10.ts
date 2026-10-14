import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

// Private authoritative snapshots, never returned directly to clients.
export const rush10Rooms = sqliteTable("rush10_rooms", {
  code: text("code").primaryKey(),
  state: text("state", { mode: "json" }).notNull(),
  updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});
