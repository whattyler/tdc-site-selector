import { loadAssumptionsForRequest } from "@/lib/assumptions-source";
import { auth } from "@/lib/auth";
import { ScreenPage } from "@/components/screen/screen-page";

/**
 * A new deal.
 *
 * Opens blank. It used to open on Medley so the page never showed empty
 * fields, but Phase 8 gave the page a Save button and a shared pipeline, and a
 * pre-filled default is then one keystroke from putting a fictitious Medley
 * into everyone's list. `?demo=medley` still seeds the worked example.
 */
export default async function NewDeal({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const [session, { assumptions, origin }, params] = await Promise.all([
    auth(),
    loadAssumptionsForRequest(),
    searchParams,
  ]);

  return (
    <ScreenPage
      assumptions={assumptions}
      assumptionsOrigin={origin}
      demo={params.demo === "medley"}
      canSave={Boolean(process.env.DATABASE_URL)}
      user={{
        name: session?.user?.name ?? null,
        upn: session?.user?.upn ?? null,
      }}
    />
  );
}
