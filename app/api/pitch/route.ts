export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { generatePitch } from "@/lib/openai";
import { getCachedPitch, cachePitch, getToneSettings } from "@/lib/db";
import { resolveCurrentUserId } from "@/lib/auth-user";
import type { GeneratedPitch } from "@/lib/types";

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

function isLowSignalCachedPitch(pitch: GeneratedPitch): boolean {
  const body = pitch.body.toLowerCase();
  const subject = pitch.subject.toLowerCase();

  return (
    body.includes("immediate uptick in employee satisfaction scores") ||
    body.includes("similar companies are seeing real upticks in employee satisfaction") ||
    body.includes("p.s. i thought this could be especially relevant for your") ||
    subject.startsWith("quick question for ")
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = payloadSchema.parse(body);
    const leadId = payload.leadRecord.lead.id;
    const userId = await resolveCurrentUserId();

    // Return cached pitch unless the user explicitly regenerated (only for step 1)
    if (!payload.forceRefresh && !payload.talkingPointsOverride && payload.step === 1) {
      const cached = await getCachedPitch(leadId);
      if (cached && !isLowSignalCachedPitch(cached)) {
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

    // Persist in background
    void cachePitch(leadId, pitch);

    return NextResponse.json({ pitch, fromCache: false });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Pitch generation failed." },
      { status: 500 }
    );
  }
}
