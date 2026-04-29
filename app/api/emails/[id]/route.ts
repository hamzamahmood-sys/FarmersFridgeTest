export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { updateEmail } from "@/lib/db";
import { AuthRequired, resolveCurrentUserId } from "@/lib/auth-user";

const updateSchema = z.object({
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  status: z.enum(["generated", "needs_edits", "approved", "scheduled", "drafted", "sent", "replied"]).optional(),
  gmailDraftUrl: z.string().optional(),
  gmailDraftId: z.string().optional(),
  gmailMessageId: z.string().optional(),
  gmailThreadId: z.string().optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  sentAt: z.string().datetime().nullable().optional(),
  replyDetectedAt: z.string().datetime().nullable().optional(),
  qualityScore: z.number().int().min(0).max(100).optional(),
  qualityIssues: z.array(z.string()).optional()
});

export async function PATCH(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    const userId = await resolveCurrentUserId();
    const body = await request.json();
    const parsed = updateSchema.parse(body);
    const updates = {
      ...parsed,
      scheduledFor: parsed.scheduledFor ?? undefined,
      sentAt: parsed.sentAt ?? undefined,
      replyDetectedAt: parsed.replyDetectedAt ?? undefined
    };
    const email = await updateEmail(userId, context.params.id, updates);

    if (!email) {
      return NextResponse.json({ error: "Email not found." }, { status: 404 });
    }

    return NextResponse.json({ email });
  } catch (error) {
    if (error instanceof AuthRequired) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update email." },
      { status: 500 }
    );
  }
}
