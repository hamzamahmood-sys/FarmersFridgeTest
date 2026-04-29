export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { listEmails } from "@/lib/db";
import { syncGmailStatusesForEmails } from "@/lib/gmail";
import { AuthRequired, resolveCurrentUserId } from "@/lib/auth-user";

const syncSchema = z.object({
  emailIds: z.array(z.string()).max(50).optional()
});

export async function POST(request: Request) {
  try {
    const userId = await resolveCurrentUserId();
    const body = await request.json().catch(() => ({}));
    const payload = syncSchema.parse(body);
    const allEmails = await listEmails({ userId, limit: 500 });
    const selectedIds = new Set(payload.emailIds ?? []);
    const candidates =
      selectedIds.size > 0
        ? allEmails.filter((email) => selectedIds.has(email.id))
        : allEmails.filter((email) => email.status !== "replied" && email.contactEmail);

    const result = await syncGmailStatusesForEmails(userId, candidates);
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof AuthRequired) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unable to sync Gmail.";
    const status = /reauthorize|scope/i.test(message) ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
