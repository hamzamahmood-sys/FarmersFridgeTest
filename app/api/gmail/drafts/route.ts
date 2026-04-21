export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { createGmailDraft } from "@/lib/gmail";

const draftSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = draftSchema.parse(body);
    const draft = await createGmailDraft(payload);

    return NextResponse.json({
      draftId: draft.id,
      messageId: draft.message?.id,
      gmailUrl: "https://mail.google.com/mail/u/0/#drafts"
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create Gmail draft." },
      { status: 500 }
    );
  }
}
