/** Seed both reference tables. `pnpm db:seed` runs assumptions only. */
import { seedAssumptions } from "@/lib/db/seed";
import { seedCostLibrary } from "@/lib/db/cost-library-seed";

await seedAssumptions();
await seedCostLibrary();
