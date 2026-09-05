/**
 * Apply pending drizzle migrations over the Neon HTTP driver, recording each
 * file in drizzle.__drizzle_migrations exactly as drizzle-kit does.
 *
 * `pnpm db:migrate` is still the real path and is what the Vercel build runs.
 * This exists because drizzle-kit's migrate swallows the error text when a
 * statement fails — it prints a spinner and exits 1 — which makes a broken
 * migration undebuggable. Run `pnpm db:apply` to see what actually failed.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));

const done = await sql`select hash from drizzle.__drizzle_migrations`;
const seen = new Set(done.map((row) => row.hash));

for (const entry of journal.entries) {
  const file = path.join("drizzle", `${entry.tag}.sql`);
  const body = readFileSync(file, "utf8");
  const hash = createHash("sha256").update(body).digest("hex");
  if (seen.has(hash)) {
    console.log(`skip  ${entry.tag}`);
    continue;
  }

  const statements = body
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  // One transaction per file. The HTTP driver has no interactive transaction,
  // so without this a failure half way through leaves the earlier statements
  // committed and the file unrecorded, which is exactly what happened once.
  try {
    await sql.transaction(statements.map((statement) => sql.query(statement)));
  } catch (error) {
    console.error(`FAIL  ${entry.tag}:
${error.message}`);
    process.exit(1);
  }

  await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${entry.when})`;
  console.log(`apply ${entry.tag}  (${statements.length} statements)`);
}
console.log("up to date");
