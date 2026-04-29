export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { searchLeadsForCompany } from "@/lib/apollo";
import { MAX_CONTACT_SEARCH_LIMIT } from "@/lib/constants";
import { cacheLeads, getCachedLeads, getLocationContacts, getSavedLocationById } from "@/lib/db";
import { filterLeadRecordsForPersonas } from "@/lib/utils";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { AuthRequired, resolveCurrentUserId } from "@/lib/auth-user";
import { getTransientCache, setTransientCache, transientCacheKey } from "@/lib/transient-cache";
import type { LeadRecord } from "@/lib/types";

const searchFiltersSchema = z.object({
  personas: z
    .array(z.enum(["office_manager", "facilities_director", "workplace_experience", "hr", "csuite", "custom"]))
    .min(1),
  customPersona: z.string().optional(),
  industryQuery: z.string().min(2),
  states: z.array(z.string()).default([]),
  employeeMin: z.number().min(1),
  limit: z.number().min(1).max(MAX_CONTACT_SEARCH_LIMIT)
});

const companySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  domain: z.string().optional(),
  linkedinUrl: z.string().optional(),
  priorityScore: z.number(),
  company: z.object({
    industry: z.string().optional(),
    employeeCount: z.number().optional(),
    hqCity: z.string().optional(),
    hqState: z.string().optional(),
    hqCountry: z.string().optional(),
    keywords: z.array(z.string()),
    techStack: z.array(z.string()),
    about: z.string().optional(),
    deliveryZone: z.enum(["Chicago", "NYC", "NJ", "Other"])
  })
});

const bodySchema = z.object({
  filters: searchFiltersSchema,
  company: companySchema,
  searchQuery: z.string().min(2).optional(),
  locationId: z.string().min(1).optional()
});

function buildContactCachePayload(payload: z.infer<typeof bodySchema>, userId?: number) {
  return {
    userId,
    companyId: payload.company.id,
    companyName: payload.company.name,
    personas: [...payload.filters.personas].sort(),
    customPersona: payload.filters.customPersona?.trim().toLowerCase() || "",
    limit: payload.filters.limit
  };
}

function buildContactSearchQuery(payload: z.infer<typeof bodySchema>): string {
  const cachePayload = buildContactCachePayload(payload);
  return [
    "contacts",
    cachePayload.companyId,
    cachePayload.companyName.toLowerCase(),
    cachePayload.personas.join(","),
    cachePayload.customPersona,
    cachePayload.limit
  ].join(":");
}

export async function POST(request: Request) {
  const { allowed, retryAfterMs } = checkRateLimit(getRateLimitKey(request, "by-company"), 15, 60_000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment before trying again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  try {
    const userId = await resolveCurrentUserId();
    const body = await request.json();
    const payload = bodySchema.parse(body);
    const contactCachePayload = buildContactCachePayload(payload, userId);
    const contactCacheKey = transientCacheKey("by-company", contactCachePayload);
    const creditSafeCached = getTransientCache<LeadRecord[]>(contactCacheKey);
    if (creditSafeCached) {
      return NextResponse.json({ company: payload.company, leads: creditSafeCached, fromCache: true });
    }
    const contactSearchQuery = buildContactSearchQuery(payload);

    if (payload.locationId) {
      const location = await getSavedLocationById(userId, payload.locationId);
      if (!location) {
        return NextResponse.json({ error: "Location not found." }, { status: 404 });
      }

      const locationContacts = filterLeadRecordsForPersonas(
        await getLocationContacts(userId, payload.locationId),
        payload.filters
      ).slice(0, payload.filters.limit);
      if (locationContacts.length >= payload.filters.limit) {
        setTransientCache(contactCacheKey, locationContacts);
        return NextResponse.json({ company: payload.company, leads: locationContacts, fromCache: true });
      }
    }

    const cachedExactContacts = await getCachedLeads(userId, contactSearchQuery, 24);
    if (cachedExactContacts && cachedExactContacts.length > 0) {
      const leads = filterLeadRecordsForPersonas(cachedExactContacts, payload.filters).slice(0, payload.filters.limit);
      setTransientCache(contactCacheKey, leads);
      return NextResponse.json({ company: payload.company, leads, fromCache: true });
    }

    const leads = await searchLeadsForCompany(payload.filters, payload.company);
    const persistedLeads = await cacheLeads(userId, leads, contactSearchQuery, {
      locationId: payload.locationId
    });
    setTransientCache(contactCacheKey, persistedLeads);

    return NextResponse.json({ company: payload.company, leads: persistedLeads, fromCache: false });
  } catch (error) {
    if (error instanceof AuthRequired) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch company contacts." },
      { status: 500 }
    );
  }
}
