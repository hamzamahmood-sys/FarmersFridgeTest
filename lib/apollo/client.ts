import { env } from "@/lib/env";

export const APOLLO_BASE_URL = "https://api.apollo.io/api";

export async function apolloFetch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${APOLLO_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": env.apolloApiKey,
      Accept: "application/json"
    },
    body: JSON.stringify(body),
    cache: "no-store"
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Apollo request failed (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<T>;
}
