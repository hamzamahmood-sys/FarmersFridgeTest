export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { updateEmail } from "@/lib/db";

const updateSchema = z.object({
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  status: z.enum(["generated", "approved", "sent"]).optional(),
  gmailDraftUrl: z.string().optional()
});

export async function PATCH(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const updates = updateSchema.parse(body);
    const email = await updateEmail(context.params.id, updates);

    if (!email) {
      return NextResponse.json({ error: "Email not found." }, { status: 404 });
    }

    return NextResponse.json({ email });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update email." },
      { status: 500 }
    );
  }
}
