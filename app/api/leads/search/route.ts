export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { looksLikeExactCompanyQuery, searchLeads } from "@/lib/apollo";
import { estimateApolloCredits } from "@/lib/utils";
import { getCachedLeads, cacheLeads } from "@/lib/db";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { AuthRequired, resolveCurrentUserId } from "@/lib/auth-user";

const searchSchema = z.object({
  personas: z
    .array(z.enum(["office_manager", "facilities_director", "workplace_experience", "hr", "csuite", "custom"]))
    .min(1),
  customPersona: z.string().optional(),
  industryQuery: z.string().min(2),
  states: z.array(z.string()).default([]),
  employeeMin: z.number().min(1),
  limit: z.number().min(1).max(50),
  forceRefresh: z.boolean().optional()
});

export async function POST(request: Request) {
  const { allowed, retryAfterMs } = checkRateLimit(getRateLimitKey(request, "leads-search"), 10, 60_000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment before trying again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  try {
    const body = await request.json();
    const filters = searchSchema.parse(body);
    const userId = await resolveCurrentUserId();
    const creditEstimate = estimateApolloCredits(filters.limit);
    const bypassCache = looksLikeExactCompanyQuery(filters.industryQuery);

    // Return cached leads if fresh and not explicitly refreshing
    if (!filters.forceRefresh && !bypassCache) {
      const cached = await getCachedLeads(userId, filters.industryQuery);
      if (cached) {
        return NextResponse.json({ filters, creditEstimate, leads: cached, fromCache: true });
      }
    }

    const leads = await searchLeads(filters);
    const persistedLeads = await cacheLeads(userId, leads, filters.industryQuery);

    return NextResponse.json({ filters, creditEstimate, leads: persistedLeads, fromCache: false });
  } catch (error) {
    if (error instanceof AuthRequired) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to search Apollo leads." },
      { status: 500 }
    );
  }
}
