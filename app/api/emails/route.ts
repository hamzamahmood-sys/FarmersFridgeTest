export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { listEmails, replaceEmailsForLead } from "@/lib/db";

const emailStatusSchema = z.enum(["generated", "approved", "sent", "all"]);
const locationTypeSchema = z.enum(["hospital", "corporate", "university", "gym", "airport", "other"]);

const createSequenceSchema = z.object({
  leadId: z.string().min(1),
  emails: z
    .array(
      z.object({
        locationId: z.string().optional(),
        contactName: z.string().optional(),
        contactEmail: z.string().optional(),
        contactTitle: z.string().optional(),
        companyName: z.string().optional(),
        locationType: locationTypeSchema.optional(),
        sequenceStep: z.number().int().min(1).max(3),
        subject: z.string().min(1),
        body: z.string().min(1),
        status: z.enum(["generated", "approved", "sent"]).optional(),
        gmailDraftUrl: z.string().optional()
      })
    )
    .min(1)
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q") || undefined;
    const status = url.searchParams.get("status") || "all";
    const locationId = url.searchParams.get("locationId") || undefined;
    const limitValue = url.searchParams.get("limit");
    const limit = limitValue ? Number(limitValue) : 200;

    const parsed = z
      .object({
        query: z.string().optional(),
        status: emailStatusSchema.optional(),
        locationId: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional()
      })
      .parse({ query, status, locationId, limit });

    const emails = await listEmails(parsed);
    return NextResponse.json({ emails });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load emails." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = createSequenceSchema.parse(body);
    const emails = await replaceEmailsForLead(payload.leadId, payload.emails);
    return NextResponse.json({ emails });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save emails." },
      { status: 500 }
    );
  }
}
