"use client";

import Image from "next/image";
import Link from "next/link";

import { asset } from "@/lib/base-path";
import { cn } from "@/lib/utils";

import type { DealFields } from "./deal-inputs";

const PRODUCT_LABEL: Record<DealFields["productType"], string> = {
  mixed_use: "Mixed-Use",
  multifamily: "Multifamily",
  auto: "product type not set",
};

export function SiteHeader({
  deal,
  active,
}: {
  deal?: DealFields;
  /** Which nav item is the page you are on. */
  active?: "pipeline" | "screen";
}) {
  const context = deal
    ? [deal.name || "Untitled deal", PRODUCT_LABEL[deal.productType]]
        .filter(Boolean)
        .join(" · ")
    : "Pipeline";

  return (
    <header
      className="sticky top-0 z-10 border-b-2 border-b-[var(--toro-red)] bg-surface"
      style={{ height: "var(--header-h)" }}
    >
      <div
        className="mx-auto flex h-full items-center px-6"
        style={{ maxWidth: "var(--content-max)" }}
      >
        {/* Baseline-aligned: an inline image's baseline is its bottom edge, so
            the wordmark and the product name sit on one line. */}
        <div className="flex min-w-0 items-baseline gap-3">
          {/* Public assets are not basePath-rewritten, so the prefix is
              explicit. Never stretched, never on red. */}
          <Image
            src={asset("/toro-logo-red.png")}
            alt="Toro Development Company"
            width={140}
            height={28}
            priority
            className="shrink-0"
            // Both dimensions set explicitly: sizing only one in CSS makes Next
            // warn that the aspect ratio is no longer guaranteed.
            style={{ height: "1.75rem", width: "auto" }}
          />

          <h1
            className="display shrink-0 text-lg font-[600] uppercase text-ink"
            style={{ letterSpacing: "0.04em" }}
          >
            Site Selector
          </h1>

          <span className="truncate text-lg text-ink-3">· {context}</span>
        </div>

        <nav className="ml-auto flex shrink-0 items-baseline gap-5 pl-6">
          <Link
            href="/pipeline"
            className={cn(
              "micro leading-none",
              active === "pipeline"
                ? "text-[var(--toro-red)]"
                : "text-ink-2 hover:text-ink",
            )}
          >
            Pipeline
          </Link>
          {/* A hard navigation, not a router push: a new deal has to clear every
              piece of page state, and the cheapest way to guarantee that is a
              fresh document. */}
          <a
            href={asset("/deals/new")}
            className="micro leading-none text-ink-2 hover:text-ink"
          >
            New deal
          </a>
        </nav>
      </div>
    </header>
  );
}
