export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { deleteSavedLocation, getLocationDetail, updateSavedLocation } from "@/lib/db";
import { AuthRequired, resolveCurrentUserId } from "@/lib/auth-user";
import { enrichSavedLocationCompanyProfile, hasUsableCompanyAbout } from "@/lib/company-profile";

const updateSchema = z.object({
  about: z.string().optional(),
  category: z.string().optional(),
  notes: z.string().optional(),
  locationType: z.enum(["hospital", "corporate", "university", "gym", "airport", "other"]).optional(),
  pipelineStage: z.enum(["prospect", "meeting", "won", "lost"]).optional(),
  pitchType: z.enum(["farmers_fridge", "vending", "catering"]).optional()
});

export async function GET(
  _request: Request,
  context: { params: { id: string } }
) {
  try {
    const userId = await resolveCurrentUserId();
    const detail = await getLocationDetail(userId, context.params.id);

    if (!detail) {
      return NextResponse.json({ error: "Location not found." }, { status: 404 });
    }

    if (!hasUsableCompanyAbout(detail.location.about)) {
      const enrichedLocation = await enrichSavedLocationCompanyProfile(detail.location);

      if (enrichedLocation.about && enrichedLocation.about !== detail.location.about) {
        const persistedLocation = await updateSavedLocation(userId, context.params.id, {
          about: enrichedLocation.about
        });

        return NextResponse.json({
          ...detail,
          location: persistedLocation || enrichedLocation
        });
      }
    }

    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof AuthRequired) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load location." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    const userId = await resolveCurrentUserId();
    const body = await request.json();
    const updates = updateSchema.parse(body);
    const location = await updateSavedLocation(userId, context.params.id, updates);

    if (!location) {
      return NextResponse.json({ error: "Location not found." }, { status: 404 });
    }

    return NextResponse.json({ location });
  } catch (error) {
    if (error instanceof AuthRequired) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update location." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: { id: string } }
) {
  try {
    const userId = await resolveCurrentUserId();
    await deleteSavedLocation(userId, context.params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthRequired) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete location." },
      { status: 500 }
    );
  }
}
