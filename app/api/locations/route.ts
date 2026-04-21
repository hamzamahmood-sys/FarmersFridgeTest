export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { listSavedLocations, saveProspectCompanyAsLocation } from "@/lib/db";
import { AuthRequired, resolveCurrentUserId } from "@/lib/auth-user";

const locationTypeSchema = z.enum(["hospital", "corporate", "university", "gym", "airport", "other", "all"]);
const pipelineStageSchema = z.enum(["prospect", "meeting", "won", "lost", "all"]);

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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q") || undefined;
    const locationType = url.searchParams.get("locationType") || "all";
    const pipelineStage = url.searchParams.get("pipelineStage") || "all";
    const limitValue = url.searchParams.get("limit");
    const limit = limitValue ? Number(limitValue) : 100;

    const parsed = z
      .object({
        query: z.string().optional(),
        locationType: locationTypeSchema.optional(),
        pipelineStage: pipelineStageSchema.optional(),
        limit: z.number().int().min(1).max(500).optional()
      })
      .parse({
        query,
        locationType,
        pipelineStage,
        limit
      });

    const userId = await resolveCurrentUserId();
    const locations = await listSavedLocations({
      userId,
      query: parsed.query,
      locationType: parsed.locationType,
      pipelineStage: parsed.pipelineStage,
      limit: parsed.limit
    });

    return NextResponse.json({ locations });
  } catch (error) {
    if (error instanceof AuthRequired) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load locations." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const userId = await resolveCurrentUserId();
    const body = await request.json();
    const company = companySchema.parse(body.company ?? body);
    const location = await saveProspectCompanyAsLocation(userId, company);
    return NextResponse.json({ location });
  } catch (error) {
    if (error instanceof AuthRequired) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save location." },
      { status: 500 }
    );
  }
}
