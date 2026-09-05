import { loadAssumptionsForRequest } from "@/lib/assumptions-source";
import { auth } from "@/lib/auth";
import { ScreenPage } from "@/components/screen/screen-page";

/**
 * The screen page. Phase 2.
 *
 * Server component: reads the session and the assumptions, then hands both to
 * the client. Auth is enforced in proxy.ts — the session read here is only for
 * display and for stamping who answered.
 */
export default async function Home() {
  const [session, { assumptions, origin }] = await Promise.all([
    auth(),
    loadAssumptionsForRequest(),
  ]);

  return (
    <ScreenPage
      assumptions={assumptions}
      assumptionsOrigin={origin}
      user={{
        name: session?.user?.name ?? null,
        upn: session?.user?.upn ?? null,
      }}
    />
  );
}
