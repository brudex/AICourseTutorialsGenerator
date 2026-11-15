/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * SOURCE OF TRUTH KEYWORDS: PROVIDER_ALIAS, providerSurfaceModule,
 *   providerActionsModule, NEXT_PUBLIC_AUTH_PROVIDER
 *
 * WHAT:  Resolves the `@providers-active` and `@providers-active-actions`
 *        specifiers to exactly one provider's UI module at build time.
 * WHY:   PROVIDER_ALIAS is the ONLY mechanism that actually keeps a
 *        non-selected provider out of the client bundle. A runtime branch
 *        cannot: Next's module graph is static, so every statically imported
 *        `'use client'` module gets a chunk whether or not the branch renders
 *        it — measured, both providers shipped. Aliasing means the other
 *        provider's modules never enter the graph at all.
 *        Better Auth is the only provider that ships in this codebase, so both
 *        aliases resolve to it unconditionally — the indirection is kept
 *        because it IS the swap seam: adding a provider is a new
 *        `active.<provider>.tsx` plus a branch on
 *        `process.env.NEXT_PUBLIC_AUTH_PROVIDER` here, with no app code
 *        touched. That env var is read by src/lib/adapters/provider.ts on the
 *        runtime side, so the bundle and the runtime always agree on which
 *        provider is live.
 * WHERE: Consumed by src/components/global/providers/server.tsx (surfaces) and
 *        src/lib/adapters/actions.client.ts (actions).
 */
const providerSurfaceModule = "./src/components/global/providers/active.better-auth.tsx"

/* Same mechanism for the two imperative client actions (switch organization,
 * sign out). Aliased rather than branched for the same measured reason. */
const providerActionsModule = "./src/components/global/providers/better-auth/actions.ts"

/**
 * SOURCE OF TRUTH KEYWORDS: typedRoutes, TYPED_ROUTE_GUARANTEE, nav.href,
 *   ROUTE_AUTHORIZATION
 *
 * WHAT:  Makes every route string in the app a checked type rather than free
 *        text.
 * WHY:   TYPED_ROUTE_GUARANTEE. The registry's `nav.href` is not only a link —
 *        the dashboard layout matches the current pathname against it to decide
 *        ROUTE_AUTHORIZATION. An href pointing at a page that does not exist
 *        therefore fails twice: the sidebar link 404s, AND the gate silently
 *        matches nothing, leaving that page ungated. Audit Logs shipped that
 *        way. A typo cannot announce itself at runtime, so it has to fail at
 *        compile time.
 * WHERE: Enforced by `Route` on ResourceNav['href'] in src/lib/resources.ts and
 *        on ROUTES in src/lib/config; checked by `tsc --noEmit`.
 */
const nextConfig: NextConfig = {
  reactCompiler: true,
  /* Native and binary-shipping packages load from node_modules at runtime
   * instead of being bundled (the PDF page renderer's canvas cannot be). */
  serverExternalPackages: ["@napi-rs/canvas", "playwright-core", "ffmpeg-static"],
  /* DESKTOP_BUILD: the desktop app runs the self-contained server bundle
   * (.next/standalone) inside its installer. Web deploys are unaffected. */
  ...(process.env["NEXT_OUTPUT"] === "standalone" ? { output: "standalone" as const } : {}),
  /* Prisma resolves its engine from process.cwd(), which makes file tracing
   * pull in the whole project. Keep source, docs, local data and stray files
   * (key exports, PDFs) out of the server bundle; only the generated Prisma
   * client under src/generated is needed at runtime. */
  outputFileTracingIncludes: {
    "*": [
      "./src/generated/prisma/*.node",
      "./src/generated/prisma/schema.prisma",
      /* External packages whose data files tracing misses. */
      "./node_modules/playwright-core/**",
      "./node_modules/ffmpeg-static/**",
      "./node_modules/@napi-rs/**",
    ],
  },
  outputFileTracingExcludes: {
    "*": [
      "./*.csv",
      "./*.pdf",
      "./*.md",
      /* NEVER_SHIP_SECRETS: the developer's .env files and downloaded OAuth
       * client secrets must not enter the bundle (the desktop runtime passes
       * every value it needs), nor stray root images. */
      "./.env",
      "./.env.*",
      "./client_secret*.json",
      "./*.png",
      "./*.jpg",
      "./*.jpeg",
      "./*.tsbuildinfo",
      "./docs/**",
      "./desktop/**",
      "./.storage/**",
      "./.agents/**",
      "./.claude/**",
      "./prisma/**",
      "./public/**",
      "./src/app/**",
      "./src/components/**",
      "./src/hooks/**",
      "./src/lib/**",
      "./src/services/**",
      "./src/trpc/**",
      "./src/worker/**",
      "./src/proxy.ts",
      "./LICENSE",
      "./tsconfig*",
      "./eslint.config.mjs",
      "./components.json",
      "./skills-lock.json",
    ],
  },
  turbopack: {
    resolveAlias: {
      "@providers-active": providerSurfaceModule,
      "@providers-active-actions": providerActionsModule,
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@providers-active": path.resolve(process.cwd(), providerSurfaceModule),
      "@providers-active-actions": path.resolve(process.cwd(), providerActionsModule),
    };
    return config;
  },
  typedRoutes: true,
  /* FRAME_POLICY: only website embeds (/embed/...) may be shown inside other
   * sites. Everything else, the studio and the school with their sign in
   * forms, may only be framed by this app itself (the Embed tab preview), so
   * no other site can overlay them (clickjacking). */
  async headers() {
    return [
      {
        source: "/:path((?!embed(?:/|$)).*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
      { source: "/embed/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }] },
    ];
  },
  experimental: {
    /* Course book uploads (COURSE_BOOK_LIMITS, 100 MB) pass through proxy.ts,
     * which caps request bodies at 10 MB by default and would cut the PDF
     * short. A little headroom covers the multipart envelope. */
    proxyClientMaxBodySize: "110mb",
  },
};

/**
 * SOURCE OF TRUTH KEYWORDS: SEPARATE_DEV_DIR, distDir, .next-dev,
 *   PHASE_DEVELOPMENT_SERVER, dev server 404 after build
 *
 * WHAT:  `next dev` writes to .next-dev; every build (web deploy, desktop
 *        bundle) keeps the standard .next.
 * WHY:   A production build (e.g. desktop/scripts/bundle.mjs) rewrote .next
 *        under a running dev server, which then answered 404 for pages it
 *        had not compiled yet. Moving dev, not the build, keeps standalone
 *        output intact: a custom distDir drops the server chunks from
 *        Next's standalone trace.
 * WHERE: Read by Next.js for every command.
 */
export default function config(phase: string): NextConfig {
  return phase === PHASE_DEVELOPMENT_SERVER ? { ...nextConfig, distDir: ".next-dev" } : nextConfig;
}
