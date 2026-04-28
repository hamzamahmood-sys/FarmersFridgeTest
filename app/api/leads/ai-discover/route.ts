export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { discoverContactsWithAI } from "@/lib/ai-contacts";
import { cacheLeads, getSavedLocationById } from "@/lib/db";
import { resolveCurrentUserId } from "@/lib/auth-user";

const bodySchema = z.object({
  locationId: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const userId = await resolveCurrentUserId();
    const body = await request.json();
    const payload = bodySchema.parse(body);

    const location = await getSavedLocationById(userId, payload.locationId);
    if (!location) {
      return NextResponse.json({ error: "Location not found." }, { status: 404 });
    }

    const leads = await discoverContactsWithAI(location);
    const persistedLeads = await cacheLeads(userId, leads, `ai:${location.companyName}`, { locationId: location.id });

    return NextResponse.json({ leads: persistedLeads, foundCount: persistedLeads.length });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }

    console.error("[ai-discover] error:", error instanceof Error ? error.message : error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI contact discovery failed." },
      { status: 500 }
    );
  }
}
