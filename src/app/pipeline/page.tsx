import { loadAssumptionsForRequest } from "@/lib/assumptions-source";
import { auth } from "@/lib/auth";
import { listPipeline } from "@/lib/deals/repository";
import { PipelineTable } from "@/components/pipeline/pipeline-table";
import { SiteFooter } from "@/components/screen/site-footer";
import { SiteHeader } from "@/components/screen/site-header";

/** Every saved deal, worst-first-last. Spec B8. */
export default async function Pipeline() {
  const hasDb = Boolean(process.env.DATABASE_URL);

  const [session, { origin }, deals] = await Promise.all([
    auth(),
    loadAssumptionsForRequest(),
    hasDb ? listPipeline() : Promise.resolve([]),
  ]);

  return (
    <>
      <SiteHeader active="pipeline" />

      <div className="flex-1 px-6 py-6">
        <div className="mx-auto" style={{ maxWidth: "var(--content-max)" }}>
          {hasDb ? (
            <PipelineTable deals={deals} />
          ) : (
            <p className="border border-line bg-surface px-6 py-10 text-center text-ink">
              DATABASE_URL is not set, so no deals are stored.
            </p>
          )}
        </div>
      </div>

      <SiteFooter
        assumptionsOrigin={origin}
        user={{
          name: session?.user?.name ?? null,
          upn: session?.user?.upn ?? null,
        }}
      />
    </>
  );
}
