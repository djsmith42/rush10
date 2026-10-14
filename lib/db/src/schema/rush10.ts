import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Private authoritative snapshots, never returned directly to clients.
export const rush10Rooms = pgTable("rush10_rooms", {
  code: text("code").primaryKey(),
  state: jsonb("state").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
