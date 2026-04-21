export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getToneSettings, upsertToneSettings } from "@/lib/db";
import { AuthRequired, resolveCurrentUserId } from "@/lib/auth-user";

const toneSchema = z.object({
  voiceDescription: z.string().default(""),
  doExamples: z.string().default(""),
  dontExamples: z.string().default(""),
  sampleEmail: z.string().default("")
});

export async function GET() {
  try {
    const userId = await resolveCurrentUserId();
    const tone = await getToneSettings(userId);
    return NextResponse.json({ tone });
  } catch (error) {
    if (error instanceof AuthRequired) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load tone settings." },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await resolveCurrentUserId();
    const body = await request.json();
    const tone = toneSchema.parse(body);
    const savedTone = await upsertToneSettings(userId, tone);
    return NextResponse.json({ tone: savedTone });
  } catch (error) {
    if (error instanceof AuthRequired) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save tone settings." },
      { status: 500 }
    );
  }
}
