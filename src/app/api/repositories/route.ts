import path from "node:path";
import { NextResponse } from "next/server";
import { createProvider } from "@/server/llm";
import { limitsFromEnv } from "@/server/llm/budget";
import { discoverRepositories } from "@/server/repository/discover";
import { allowedRoots } from "@/server/repository/safe-fs";
import { defaultRoots } from "@/server/workflow/service";
import { withHandler } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Selectable repositories (inside allowed roots), the active provider and usage limits. */
export const GET = () =>
  withHandler(() => {
    const roots = allowedRoots(defaultRoots());
    const fixturesRoot = path.join(process.cwd(), "fixtures");
    const repositories = discoverRepositories(roots).map((r) => ({ ...r, isDemo: r.path.startsWith(fixturesRoot) }));
    let provider;
    try {
      provider = createProvider().info;
    } catch (e) {
      provider = { kind: "fixture" as const, label: `Provider misconfigured: ${(e as Error).message}`, model: null };
    }
    return NextResponse.json({ roots, repositories, provider, limits: limitsFromEnv() });
  });
