import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_PATH) {
  throw new Error("DATABASE_PATH must be set to the SQLite database file location.");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_PATH,
  },
});
