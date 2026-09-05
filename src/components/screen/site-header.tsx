"use client";

import Image from "next/image";

import { asset } from "@/lib/base-path";

import type { DealFields } from "./deal-inputs";

const PRODUCT_LABEL: Record<DealFields["productType"], string> = {
  mixed_use: "Mixed-Use",
  multifamily: "Multifamily",
  auto: "product type not set",
};

export function SiteHeader({ deal }: { deal: DealFields }) {
  const context = [deal.name || "Untitled deal", PRODUCT_LABEL[deal.productType]]
    .filter(Boolean)
    .join(" · ");

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

        {/* Right side stays empty until Phase 8 adds pipeline nav. */}
      </div>
    </header>
  );
}
