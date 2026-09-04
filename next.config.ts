import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app is served under /site-selector so it can be lifted into the
  // Turborepo hub later (build-spec Part A) without changing any route paths.
  basePath: "/site-selector",
  reactCompiler: true,
  // Explicitly off. Auth-gated pages must not be prerendered into a shared
  // cache shell, and the scoring UI is per-deal dynamic.
  cacheComponents: false,
};

export default nextConfig;
