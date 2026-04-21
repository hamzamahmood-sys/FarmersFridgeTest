import OpenAI from "openai";
import { normalizeDomain } from "@/lib/apollo/normalize";
import { OPENAI_MODEL, OPENAI_TIMEOUT_MS } from "@/lib/constants";
import { env } from "@/lib/env";
import type { ProspectCompany, SavedLocation } from "@/lib/types";

type CompanyProfileSource = {
  companyName: string;
  companyDomain?: string;
  industry?: string;
  employeeCount?: number;
  hqCity?: string;
  hqState?: string;
  hqCountry?: string;
  about?: string;
  keywords?: string[];
};

const COMPANY_FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_CHARS = 500_000;
const WEBSITE_PATHS = ["", "/about", "/about-us"] as const;
const NOISY_SNIPPET_PATTERNS = [
  /cookie/i,
  /privacy policy/i,
  /terms of service/i,
  /javascript/i,
  /enable cookies/i
] as const;

function getOpenAIClient() {
  return new OpenAI({
    apiKey: env.openaiApiKey
  });
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(text: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    quot: "\"",
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " "
  };

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const normalizedEntity = entity.toLowerCase();

    if (normalizedEntity in namedEntities) {
      return namedEntities[normalizedEntity]!;
    }

    if (normalizedEntity.startsWith("#x")) {
      const codePoint = Number.parseInt(normalizedEntity.slice(2), 16);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }

    if (normalizedEntity.startsWith("#")) {
      const codePoint = Number.parseInt(normalizedEntity.slice(1), 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }

    return match;
  });
}

function normalizeSnippet(text: string): string {
  return normalizeWhitespace(decodeHtmlEntities(text));
}

function hasNoise(text: string): boolean {
  return NOISY_SNIPPET_PATTERNS.some((pattern) => pattern.test(text));
}

function isUsefulSnippet(text: string): boolean {
  const normalized = normalizeSnippet(text);
  if (normalized.length < 40) return false;
  if (normalized.length > 420) return false;
  if (hasNoise(normalized)) return false;
  return true;
}

function getHtmlAttribute(tag: string, attributeName: string): string | null {
  const pattern = new RegExp(
    `${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );
  const match = tag.match(pattern);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value ? decodeHtmlEntities(value) : null;
}

function collectJsonLdDescriptions(value: unknown, descriptions: string[]): void {
  if (!value) return;

  if (typeof value === "string") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonLdDescriptions(item, descriptions);
    }
    return;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "description" && typeof child === "string" && isUsefulSnippet(child)) {
        descriptions.push(normalizeSnippet(child));
        continue;
      }

      collectJsonLdDescriptions(child, descriptions);
    }
  }
}

function extractMetaDescriptions(html: string): string[] {
  const descriptions: string[] = [];
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];

  for (const tag of metaTags) {
    const key = (getHtmlAttribute(tag, "name") || getHtmlAttribute(tag, "property") || "").toLowerCase();
    if (!["description", "og:description", "twitter:description"].includes(key)) continue;

    const content = getHtmlAttribute(tag, "content");
    if (content && isUsefulSnippet(content)) {
      descriptions.push(normalizeSnippet(content));
    }
  }

  return descriptions;
}

function extractJsonLdDescription(html: string): string[] {
  const matches = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  const descriptions: string[] = [];

  for (const match of matches) {
    const raw = match[1]?.trim();
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as unknown;
      collectJsonLdDescriptions(parsed, descriptions);
    } catch {
      continue;
    }
  }

  return descriptions;
}

function stripHtmlTags(html: string): string {
  return normalizeSnippet(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function extractParagraphDescriptions(html: string): string[] {
  const matches = html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi);
  const descriptions: string[] = [];

  for (const match of matches) {
    const text = stripHtmlTags(match[1] || "");
    if (isUsefulSnippet(text)) {
      descriptions.push(text);
    }
  }

  return descriptions;
}

export function extractBestCompanyWebsiteSnippet(html: string): string | null {
  const candidates = [
    ...extractMetaDescriptions(html),
    ...extractJsonLdDescription(html),
    ...extractParagraphDescriptions(html)
  ];

  for (const candidate of candidates) {
    if (isUsefulSnippet(candidate)) {
      return candidate;
    }
  }

  return null;
}

function formatHeadquarters(source: CompanyProfileSource): string {
  return [source.hqCity, source.hqState, source.hqCountry].filter(Boolean).join(", ");
}

function formatEmployeeCount(employeeCount?: number): string {
  if (!employeeCount || !Number.isFinite(employeeCount)) return "";
  return `${Math.round(employeeCount).toLocaleString()} employees`;
}

function joinPhrases(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export function hasUsableCompanyAbout(text?: string): boolean {
  if (!text) return false;
  const normalized = normalizeSnippet(text);
  if (normalized.length < 55) return false;
  if (/^(n\/a|unknown|none)$/i.test(normalized)) return false;
  return true;
}

export function buildCompanyAboutFallback(
  source: CompanyProfileSource,
  websiteSnippet?: string | null
): string {
  const normalizedWebsiteSnippet = websiteSnippet ? normalizeSnippet(websiteSnippet) : "";
  const headquarters = formatHeadquarters(source);
  const employeeCount = formatEmployeeCount(source.employeeCount);
  const facts: string[] = [];

  if (source.industry) {
    facts.push(`operates in ${source.industry}`);
  }
  if (headquarters) {
    facts.push(`is headquartered in ${headquarters}`);
  }
  if (employeeCount) {
    facts.push(`has approximately ${employeeCount}`);
  }

  const factSentence = facts.length > 0 ? `${source.companyName} ${joinPhrases(facts)}.` : "";

  if (normalizedWebsiteSnippet && factSentence) {
    return `${normalizedWebsiteSnippet}${/[.!?]$/.test(normalizedWebsiteSnippet) ? "" : "."} ${factSentence}`;
  }

  if (normalizedWebsiteSnippet) {
    return `${normalizedWebsiteSnippet}${/[.!?]$/.test(normalizedWebsiteSnippet) ? "" : "."}`;
  }

  if (factSentence) {
    return factSentence;
  }

  const keywordPhrase =
    source.keywords && source.keywords.length > 0
      ? `${source.companyName} focuses on ${source.keywords.slice(0, 3).join(", ")}.`
      : "";

  return keywordPhrase;
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), COMPANY_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FarmersFridgeBot/1.0; +https://farmersfridge.com)",
        Accept: "text/html,application/xhtml+xml"
      },
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) return null;

    const html = await response.text();
    return html.slice(0, MAX_HTML_CHARS);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWebsiteSnippet(domain?: string): Promise<string | null> {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return null;

  const candidates = [
    ...WEBSITE_PATHS.map((path) => `https://${normalizedDomain}${path}`),
    `http://${normalizedDomain}`
  ];

  for (const url of candidates) {
    const html = await fetchHtml(url);
    if (!html) continue;

    const snippet = extractBestCompanyWebsiteSnippet(html);
    if (snippet) return snippet;
  }

  return null;
}

async function normalizeCompanyAboutWithOpenAI(
  source: CompanyProfileSource,
  websiteSnippet?: string | null
): Promise<string | null> {
  const prompt = [
    "You write concise company profile blurbs for B2B sales research.",
    "Return valid JSON only with one key: about.",
    "Use only facts provided below. Do not invent missing details.",
    "The about string must be 1-2 sentences, 35-80 words, plain text, no em dashes.",
    "Prefer this order: what the company does, headquarters if known, employee count if known.",
    "",
    `Company: ${source.companyName}`,
    `Domain: ${source.companyDomain || "Unknown"}`,
    `Industry: ${source.industry || "Unknown"}`,
    `Headquarters: ${formatHeadquarters(source) || "Unknown"}`,
    `Employee count: ${formatEmployeeCount(source.employeeCount) || "Unknown"}`,
    `Keywords: ${source.keywords?.join(", ") || "None"}`,
    websiteSnippet ? `Website snippet: ${websiteSnippet}` : "Website snippet: None"
  ].join("\n");

  const response = await getOpenAIClient().chat.completions.create(
    {
      model: OPENAI_MODEL,
      temperature: 0,
      max_tokens: 140,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }]
    },
    { timeout: OPENAI_TIMEOUT_MS }
  );

  const rawText = response.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(rawText) as { about?: string };
  const normalized = parsed.about ? normalizeSnippet(parsed.about) : "";
  return normalized || null;
}

async function enrichCompanyAbout(source: CompanyProfileSource): Promise<string> {
  if (hasUsableCompanyAbout(source.about)) {
    return normalizeSnippet(source.about || "");
  }

  const websiteSnippet = await fetchWebsiteSnippet(source.companyDomain);
  const fallback = buildCompanyAboutFallback(source, websiteSnippet);

  if (!fallback) {
    return "";
  }

  try {
    const normalized = await normalizeCompanyAboutWithOpenAI(source, websiteSnippet);
    if (normalized) {
      return normalized;
    }
  } catch {
    // Fall back to the deterministic summary when OpenAI or fetch parsing fails.
  }

  return fallback;
}

export async function enrichProspectCompanyProfile(company: ProspectCompany): Promise<ProspectCompany> {
  const about = await enrichCompanyAbout({
    companyName: company.name,
    companyDomain: company.domain,
    industry: company.company.industry,
    employeeCount: company.company.employeeCount,
    hqCity: company.company.hqCity,
    hqState: company.company.hqState,
    hqCountry: company.company.hqCountry,
    about: company.company.about,
    keywords: company.company.keywords
  });

  if (!about || about === company.company.about) {
    return company;
  }

  return {
    ...company,
    company: {
      ...company.company,
      about
    }
  };
}

export async function enrichSavedLocationCompanyProfile(location: SavedLocation): Promise<SavedLocation> {
  const about = await enrichCompanyAbout({
    companyName: location.companyName,
    companyDomain: location.companyDomain,
    industry: location.industry,
    employeeCount: location.employeeCount,
    hqCity: location.hqCity,
    hqState: location.hqState,
    hqCountry: location.hqCountry,
    about: location.about
  });

  if (!about || about === location.about) {
    return location;
  }

  return {
    ...location,
    about
  };
}
