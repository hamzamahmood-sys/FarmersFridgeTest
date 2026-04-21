import { env } from "@/lib/env";

type TombaResponse = {
  data?: {
    email?: string | null;
  } | null;
};

type TombaCredentials = {
  apiKey: string;
  apiSecret: string;
};

function normalizeDomain(domain: string): string | null {
  const trimmed = domain.trim();
  if (!trimmed) return null;

  try {
    const value = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    const hostname = new URL(value).hostname.replace(/^www\./i, "");
    return hostname || null;
  } catch {
    return trimmed.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0] || null;
  }
}

function getTombaCredentials(): TombaCredentials | null {
  if (env.tombaApiKey && env.tombaApiSecret) {
    return {
      apiKey: env.tombaApiKey,
      apiSecret: env.tombaApiSecret
    };
  }

  return null;
}

export function isTombaConfigured(): boolean {
  return Boolean(getTombaCredentials());
}

/**
 * Look up an email via Tomba's email-finder API.
 * Only called when Apollo returns no email for a lead.
 * Returns null if unconfigured, not found, or request fails.
 */
export async function findEmailTomba(
  firstName: string,
  lastName: string,
  domain: string
): Promise<string | null> {
  const credentials = getTombaCredentials();
  if (!credentials) return null;
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return null;

  try {
    const url = new URL("https://api.tomba.io/v1/email-finder");
    url.searchParams.set("domain", normalizedDomain);
    url.searchParams.set("first_name", firstName);
    url.searchParams.set("last_name", lastName);

    const response = await fetch(url.toString(), {
      headers: {
        "X-Tomba-Key": credentials.apiKey,
        "X-Tomba-Secret": credentials.apiSecret,
        "Content-Type": "application/json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.warn(
        `[Tomba] request failed (${response.status}) for ${firstName} ${lastName}@${normalizedDomain}: ${errorText}`
      );
      return null;
    }

    const data = (await response.json()) as TombaResponse;
    const email = data?.data?.email ?? null;
    console.log(
      `[Tomba] ${firstName} ${lastName}@${normalizedDomain} → ${email ?? "(no email found)"}`
    );
    return email;
  } catch (error) {
    console.warn(
      `[Tomba] exception for ${firstName} ${lastName}@${domain}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
