import { auth, ROLES } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Placeholder signed-in page for Phase 0. Unauthenticated requests never get
 * here — proxy.ts redirects them to sign-in first.
 *
 * The real page (spec B3) arrives in Phase 2.
 */
export default async function Home() {
  const session = await auth();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">TDC Site Selector</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Address in, GO / NO-GO and a max land price out.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Signed in</CardTitle>
          <CardDescription>
            Phase 0 placeholder. The screen page lands in Phase 2.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Name" value={session?.user?.name ?? "—"} />
          <Row label="UPN" value={session?.user?.upn ?? "—"} />
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Role</span>
            <Badge variant={session?.user?.role === ROLES.admin ? "default" : "secondary"}>
              {session?.user?.role ?? ROLES.user}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
