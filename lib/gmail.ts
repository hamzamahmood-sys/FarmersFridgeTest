import { google } from "googleapis";
import { auth } from "@/auth";
import { getPool } from "@/lib/db";
import { env } from "@/lib/env";
import type { GmailDraftPayload } from "@/lib/types";

type AccountTokens = {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
  scope: string | null;
};

async function getAccountTokensForCurrentUser(): Promise<AccountTokens> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    throw new Error("Not signed in. Sign in with Google before creating a Gmail draft.");
  }

  const pool = getPool();
  const { rows } = await pool.query<AccountTokens>(
    `SELECT access_token, refresh_token, expires_at, scope
       FROM accounts
      WHERE "userId" = $1 AND provider = 'google'
      LIMIT 1`,
    [Number(userId)]
  );

  const tokens = rows[0];
  if (!tokens || (!tokens.access_token && !tokens.refresh_token)) {
    throw new Error("No Google account linked for this user.");
  }
  return tokens;
}

async function persistRefreshedTokens(userId: number, next: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
}) {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (next.access_token !== undefined) {
    params.push(next.access_token ?? null);
    sets.push(`access_token = $${params.length}`);
  }
  if (next.refresh_token) {
    params.push(next.refresh_token);
    sets.push(`refresh_token = $${params.length}`);
  }
  if (next.expiry_date !== undefined) {
    params.push(next.expiry_date ? Math.floor(next.expiry_date / 1000) : null);
    sets.push(`expires_at = $${params.length}`);
  }
  if (next.scope !== undefined) {
    params.push(next.scope ?? null);
    sets.push(`scope = $${params.length}`);
  }
  if (sets.length === 0) return;

  params.push(userId);
  await getPool().query(
    `UPDATE accounts SET ${sets.join(", ")} WHERE "userId" = $${params.length} AND provider = 'google'`,
    params
  );
}

async function getAuthorizedGmailClient() {
  const session = await auth();
  const userId = Number(session?.user?.id);
  const tokens = await getAccountTokensForCurrentUser();

  const oauth2Client = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret);
  oauth2Client.setCredentials({
    access_token: tokens.access_token ?? undefined,
    refresh_token: tokens.refresh_token ?? undefined,
    scope: tokens.scope ?? undefined,
    expiry_date: tokens.expires_at ? tokens.expires_at * 1000 : undefined
  });

  // Persist rotated tokens so the accounts row stays fresh
  oauth2Client.on("tokens", (rotated) => {
    void persistRefreshedTokens(userId, rotated);
  });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

export async function createGmailDraft(payload: GmailDraftPayload) {
  const gmail = await getAuthorizedGmailClient();
  const encodedMessage = Buffer.from(
    [
      `To: ${payload.to}`,
      `Subject: ${payload.subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      payload.body
    ].join("\r\n")
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const draft = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: encodedMessage
      }
    }
  });

  return draft.data;
}
