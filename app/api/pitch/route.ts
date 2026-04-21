export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { generatePitch } from "@/lib/openai";
import { getCachedPitch, cachePitch, getToneSettings } from "@/lib/db";
import { AuthRequired, resolveCurrentUserId } from "@/lib/auth-user";
import { isLowSignalPitch } from "@/lib/utils";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { PITCH_CACHE_TTL_HOURS } from "@/lib/constants";

const companySchema = z.object({
  industry: z.string().optional(),
  employeeCount: z.number().optional(),
  hqCity: z.string().optional(),
  hqState: z.string().optional(),
  hqCountry: z.string().optional(),
  keywords: z.array(z.string()),
  techStack: z.array(z.string()),
  about: z.string().optional(),
  deliveryZone: z.enum(["Chicago", "NYC", "NJ", "Other"])
});

const leadSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  title: z.string(),
  linkedinUrl: z.string().optional(),
  companyName: z.string(),
  companyDomain: z.string().optional(),
  organizationId: z.string().optional()
});

const payloadSchema = z.object({
  leadRecord: z.object({
    lead: leadSchema,
    company: companySchema,
    priorityScore: z.number()
  }),
  talkingPointsOverride: z.string().optional(),
  forceRefresh: z.boolean().optional(),
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().default(1)
});

export async function POST(request: Request) {
  const { allowed, retryAfterMs } = checkRateLimit(getRateLimitKey(request, "pitch"), 60, 60_000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment before trying again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  try {
    const body = await request.json();
    const payload = payloadSchema.parse(body);
    const leadId = payload.leadRecord.lead.id;
    const userId = await resolveCurrentUserId();

    // Return cached pitch unless the user explicitly regenerated (only for step 1).
    // Pitches older than PITCH_CACHE_TTL_HOURS are treated as stale and regenerated.
    if (!payload.forceRefresh && !payload.talkingPointsOverride && payload.step === 1) {
      const cached = await getCachedPitch(leadId, PITCH_CACHE_TTL_HOURS);
      if (cached && !isLowSignalPitch(cached)) {
        return NextResponse.json({ pitch: cached, fromCache: true });
      }
    }

    const toneSettings = await getToneSettings(userId);
    const pitch = await generatePitch(
      payload.leadRecord,
      payload.talkingPointsOverride,
      payload.step,
      toneSettings
    );

    // Only cache the primary email draft. Follow-up drafts are generated on demand
    // and should not overwrite the main step-1 pitch for this lead.
    if (payload.step === 1) {
      void cachePitch(leadId, pitch);
    }

    return NextResponse.json({ pitch, fromCache: false });
  } catch (error) {
    if (error instanceof AuthRequired) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Pitch generation failed." },
      { status: 500 }
    );
  }
}
