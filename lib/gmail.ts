import { google } from "googleapis";
import { auth } from "@/auth";
import { getPool } from "@/lib/db";
import { env } from "@/lib/env";
import type { GmailDraftPayload, StoredEmail } from "@/lib/types";

const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

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

function requireReadScope(scope: string | null | undefined): void {
  if (!scope?.includes(GMAIL_READ_SCOPE)) {
    throw new Error("Gmail sync needs read-only scope. Reauthorize Gmail from the Emails page, then try sync again.");
  }
}

function assertHeaderSafe(value: string, headerName: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${headerName} cannot contain line breaks.`);
  }
}

function encodeMimeHeader(value: string, headerName: string): string {
  assertHeaderSafe(value, headerName);
  return /[^\x20-\x7e]/.test(value)
    ? `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`
    : value;
}

export async function createGmailDraft(payload: GmailDraftPayload) {
  const gmail = await getAuthorizedGmailClient();
  assertHeaderSafe(payload.to, "To");
  const subject = encodeMimeHeader(payload.subject, "Subject");
  const encodedMessage = Buffer.from(
    [
      `To: ${payload.to}`,
      `Subject: ${subject}`,
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

function gmailSearchEscape(value: string): string {
  return value.replace(/"/g, "");
}

async function getMessageInternalDate(gmail: ReturnType<typeof google.gmail>, messageId: string): Promise<string | undefined> {
  const message = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["Subject", "From", "To", "Date"]
  });
  const internalDate = message.data.internalDate;
  return internalDate ? new Date(Number(internalDate)).toISOString() : undefined;
}

async function findFirstMessage(
  gmail: ReturnType<typeof google.gmail>,
  query: string
): Promise<{ id?: string; threadId?: string; internalDate?: string } | null> {
  const result = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: 1
  });
  const message = result.data.messages?.[0];
  if (!message?.id) return null;
  const internalDate = await getMessageInternalDate(gmail, message.id);
  return {
    id: message.id,
    threadId: message.threadId || undefined,
    internalDate
  };
}

export type GmailSyncResult = {
  checked: number;
  updated: number;
  replied: number;
  sent: number;
  errors: string[];
};

export async function syncGmailStatusesForEmails(userId: number, emails: StoredEmail[]): Promise<GmailSyncResult> {
  const tokens = await getAccountTokensForCurrentUser();
  requireReadScope(tokens.scope);
  const gmail = await getAuthorizedGmailClient();
  const result: GmailSyncResult = { checked: 0, updated: 0, replied: 0, sent: 0, errors: [] };

  for (const email of emails.slice(0, 50)) {
    if (!email.contactEmail) continue;
    result.checked += 1;

    try {
      const subject = gmailSearchEscape(email.subject);
      const contact = gmailSearchEscape(email.contactEmail);
      const sentQuery = `in:sent to:${contact} subject:"${subject}" newer_than:365d`;
      const replyQuery = `from:${contact} subject:"${subject}" newer_than:365d`;
      const [sentMessage, replyMessage] = await Promise.all([
        findFirstMessage(gmail, sentQuery),
        findFirstMessage(gmail, replyQuery)
      ]);

      const updates: Partial<StoredEmail> = {};
      if (sentMessage?.id) {
        updates.status = email.status === "replied" ? "replied" : "sent";
        updates.sentAt = email.sentAt || sentMessage.internalDate || new Date().toISOString();
        updates.gmailMessageId = email.gmailMessageId || sentMessage.id;
        updates.gmailThreadId = email.gmailThreadId || sentMessage.threadId;
        result.sent += 1;
      }

      if (replyMessage?.id) {
        updates.status = "replied";
        updates.replyDetectedAt = email.replyDetectedAt || replyMessage.internalDate || new Date().toISOString();
        updates.gmailThreadId = email.gmailThreadId || replyMessage.threadId;
        result.replied += 1;
      }

      if (Object.keys(updates).length > 0) {
        const sets: string[] = [];
        const params: unknown[] = [];

        if (updates.status) {
          params.push(updates.status);
          sets.push(`status = $${params.length}`);
        }
        if (updates.sentAt !== undefined) {
          params.push(updates.sentAt || null);
          sets.push(`sent_at = $${params.length}`);
        }
        if (updates.replyDetectedAt !== undefined) {
          params.push(updates.replyDetectedAt || null);
          sets.push(`reply_detected_at = $${params.length}`);
        }
        if (updates.gmailMessageId !== undefined) {
          params.push(updates.gmailMessageId || null);
          sets.push(`gmail_message_id = $${params.length}`);
        }
        if (updates.gmailThreadId !== undefined) {
          params.push(updates.gmailThreadId || null);
          sets.push(`gmail_thread_id = $${params.length}`);
        }

        params.push(email.id, userId);
        await getPool().query(
          `UPDATE emails SET ${sets.join(", ")}, updated_at = NOW()
           WHERE id = $${params.length - 1} AND user_id = $${params.length}`,
          params
        );
        result.updated += 1;
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : `Failed to sync ${email.subject}`);
    }
  }

  return result;
}
