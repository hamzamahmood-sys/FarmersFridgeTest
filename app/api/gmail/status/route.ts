export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPool } from "@/lib/db";

const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ connected: false, scope: null, expiresAt: null, email: null });
  }

  const { rows } = await getPool().query<{ scope: string | null; expires_at: number | null }>(
    `SELECT scope, expires_at FROM accounts
      WHERE "userId" = $1 AND provider = 'google' LIMIT 1`,
    [Number(userId)]
  );

  const account = rows[0];
  const hasComposeScope = Boolean(account?.scope?.includes(GMAIL_COMPOSE_SCOPE));
  const hasReadScope = Boolean(account?.scope?.includes(GMAIL_READ_SCOPE));

  return NextResponse.json({
    connected: hasComposeScope,
    canSync: hasReadScope,
    scope: account?.scope ?? null,
    expiresAt: account?.expires_at ? account.expires_at * 1000 : null,
    email: session.user?.email ?? null
  });
}
