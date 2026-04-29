export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { searchCompanies } from "@/lib/apollo";
import { estimateApolloCredits } from "@/lib/utils";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { getTransientCache, setTransientCache, transientCacheKey } from "@/lib/transient-cache";
import type { ProspectCompany } from "@/lib/types";

const searchSchema = z.object({
  personas: z
    .array(z.enum(["office_manager", "facilities_director", "workplace_experience", "hr", "csuite", "custom"]))
    .min(1),
  customPersona: z.string().optional(),
  industryQuery: z.string().min(2),
  states: z.array(z.string()).default([]),
  employeeMin: z.number().min(1),
  limit: z.number().min(1).max(50)
});

export async function POST(request: Request) {
  const { allowed, retryAfterMs } = checkRateLimit(getRateLimitKey(request, "companies-search"), 10, 60_000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment before trying again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  try {
    const body = await request.json();
    const filters = searchSchema.parse(body);
    const creditEstimate = estimateApolloCredits(filters.limit);
    const cacheKey = transientCacheKey("companies-search", {
      industryQuery: filters.industryQuery,
      states: filters.states,
      employeeMin: filters.employeeMin,
      limit: filters.limit
    });
    const cached = getTransientCache<ProspectCompany[]>(cacheKey);
    if (cached) {
      return NextResponse.json({ filters, creditEstimate, companies: cached, fromCache: true });
    }

    const companies = await searchCompanies(filters);
    setTransientCache(cacheKey, companies);

    return NextResponse.json({ filters, creditEstimate, companies, fromCache: false });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to search Apollo companies." },
      { status: 500 }
    );
  }
}
