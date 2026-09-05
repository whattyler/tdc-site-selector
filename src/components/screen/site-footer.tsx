"use client";

/**
 * Provenance and identity, out of the way. Where the numbers came from on the
 * left, who is answering on the right — both things you want available and
 * neither worth a slot in the header.
 */
export function SiteFooter({
  assumptionsOrigin,
  user,
}: {
  assumptionsOrigin: string;
  user: { name: string | null; upn: string | null };
}) {
  return (
    <footer
      className="border-t border-line bg-surface"
      style={{ height: "2rem" }}
    >
      <div
        className="mx-auto flex h-full items-center justify-between px-6"
        style={{ maxWidth: "var(--content-max)" }}
      >
        <span
          className="text-ink-3"
          style={{ fontSize: "var(--toro-text-micro)" }}
          title={`Assumptions loaded from ${assumptionsOrigin}`}
        >
          Assumptions · {assumptionsOrigin}
        </span>

        <span
          className="text-ink-3"
          style={{ fontSize: "var(--toro-text-micro)" }}
        >
          {user.upn ?? user.name ?? "not signed in"}
        </span>
      </div>
    </footer>
  );
}
