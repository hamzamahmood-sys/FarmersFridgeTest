export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { searchLeadsForCompany } from "@/lib/apollo";
import { cacheLeads } from "@/lib/db";

const searchFiltersSchema = z.object({
  personas: z
    .array(z.enum(["office_manager", "facilities_director", "workplace_experience", "hr", "csuite", "custom"]))
    .min(1),
  customPersona: z.string().optional(),
  industryQuery: z.string().min(2),
  states: z.array(z.string()).default([]),
  employeeMin: z.number().min(1),
  limit: z.number().min(1).max(50)
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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = bodySchema.parse(body);
    const leads = await searchLeadsForCompany(payload.filters, payload.company);

    void cacheLeads(leads, payload.searchQuery || payload.company.name, {
      locationId: payload.locationId
    });

    return NextResponse.json({ company: payload.company, leads, fromCache: false });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch company contacts." },
      { status: 500 }
    );
  }
}
