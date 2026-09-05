import { loadAssumptionsForRequest } from "@/lib/assumptions-source";
import { auth } from "@/lib/auth";
import { ScreenPage } from "@/components/screen/screen-page";

/**
 * A new deal, at its own URL.
 *
 * Opens blank. It used to be the app root and used to open on Medley, so the
 * page never showed empty fields — but with a Save button and a shared
 * pipeline, a pre-filled default sitting at the address everyone lands on is
 * one keystroke from putting a fictitious Medley into the list. Reaching a
 * blank form is now something you choose. `?demo=medley` seeds the worked
 * example for anyone who wants it.
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
