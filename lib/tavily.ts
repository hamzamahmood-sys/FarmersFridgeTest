import { tavily } from "@tavily/core";
import { env } from "@/lib/env";
import type { LeadRecord } from "@/lib/types";

export type CompanyResearch = {
  insights: string[];
  rawSnippets: string;
};

const EXCLUDED_DOMAIN_HOSTS = new Set([
  "linkedin.com",
  "www.linkedin.com",
  "facebook.com",
  "www.facebook.com",
  "instagram.com",
  "www.instagram.com",
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "youtube.com",
  "www.youtube.com",
  "wikipedia.org",
  "www.wikipedia.org",
  "mapquest.com",
  "www.mapquest.com",
  "glassdoor.com",
  "www.glassdoor.com",
  "indeed.com",
  "www.indeed.com",
  "zoominfo.com",
  "www.zoominfo.com",
  "bloomberg.com",
  "www.bloomberg.com",
  "crunchbase.com",
  "www.crunchbase.com"
]);

function getClient() {
  return tavily({ apiKey: env.tavilyApiKey });
}

function buildQuery(record: LeadRecord): string {
  const parts = [record.lead.companyName];
  if (record.company.hqCity) parts.push(record.company.hqCity);
  parts.push("workplace office expansion culture news 2024 2025");
  return parts.join(" ");
}

function extractInsights(results: Array<{ title?: string; content?: string; url?: string }>): string[] {
  return results
    .slice(0, 4)
    .map((r) => {
      const snippet = (r.content || "").replace(/\s+/g, " ").trim().slice(0, 300);
      return snippet || null;
    })
    .filter((s): s is string => typeof s === "string" && s.length > 40);
}

function normalizeHostname(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const hostname = new URL(trimmed).hostname.replace(/^www\./i, "");
    return hostname || null;
  } catch {
    return null;
  }
}

function looksLikeOfficialCompanyDomain(hostname: string): boolean {
  return !EXCLUDED_DOMAIN_HOSTS.has(hostname);
}

export async function resolveCompanyDomain(record: LeadRecord): Promise<string | null> {
  if (record.lead.companyDomain?.trim()) {
    return record.lead.companyDomain.trim();
  }

  try {
    const client = getClient();
    const query = [record.lead.companyName, record.company.hqCity, "official site"]
      .filter(Boolean)
      .join(" ");

    const response = await client.search(query, {
      maxResults: 5,
      searchDepth: "basic",
      includeAnswer: false
    });

    for (const result of response.results ?? []) {
      if (typeof result.url !== "string") continue;
      const hostname = normalizeHostname(result.url);
      if (hostname && looksLikeOfficialCompanyDomain(hostname)) {
        return hostname;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function researchCompany(record: LeadRecord): Promise<CompanyResearch> {
  try {
    const client = getClient();
    const query = buildQuery(record);

    const response = await client.search(query, {
      maxResults: 5,
      searchDepth: "basic",
      includeAnswer: true
    });

    const insights = extractInsights(response.results ?? []);
    const answer = typeof response.answer === "string" ? response.answer.trim() : "";

    const rawSnippets = [
      answer ? `Summary: ${answer}` : null,
      ...insights.map((s, i) => `[${i + 1}] ${s}`)
    ]
      .filter(Boolean)
      .join("\n");

    return { insights, rawSnippets };
  } catch {
    return { insights: [], rawSnippets: "" };
  }
}
