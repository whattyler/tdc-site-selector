import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated locally (`pnpm db:generate`), the SQL is committed,
 * and `pnpm db:migrate` runs as the first step of the Vercel build command.
 * Never run migrations from a laptop against production.
 */
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
