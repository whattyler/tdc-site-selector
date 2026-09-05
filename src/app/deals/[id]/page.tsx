import { notFound } from "next/navigation";

import { loadAssumptionsForRequest } from "@/lib/assumptions-source";
import { auth } from "@/lib/auth";
import { loadDeal } from "@/lib/deals/repository";
import { ScreenPage } from "@/components/screen/screen-page";

/**
 * A saved deal, restored from its own URL. Spec B4.
 *
 * The snapshot carries inputs only. Everything the panel shows is recomputed
 * from them here and now, so a deal saved before a weight changed reflects the
 * change the next time it is opened rather than preserving a stale verdict.
 */
export default async function DealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!process.env.DATABASE_URL) notFound();

  const [session, { assumptions, origin }, initial] = await Promise.all([
    auth(),
    loadAssumptionsForRequest(),
    loadDeal(id),
  ]);

  if (!initial) notFound();

  return (
    <ScreenPage
      assumptions={assumptions}
      assumptionsOrigin={origin}
      initial={initial}
      canSave
      user={{
        name: session?.user?.name ?? null,
        upn: session?.user?.upn ?? null,
      }}
    />
  );
}
