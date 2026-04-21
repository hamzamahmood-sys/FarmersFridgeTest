import { resolveDeliveryZone } from "@/lib/utils";
import type { CompanyFirmographics } from "@/lib/types";

export function getOrganizationName(person: Record<string, unknown>): string {
  const organization = person.organization as Record<string, unknown> | undefined;
  const account = person.account as { name?: unknown } | undefined;

  if (typeof person.organization_name === "string") return person.organization_name;
  if (typeof organization?.name === "string") return organization.name;
  if (typeof account?.name === "string") return account.name;
  return "";
}

export function getPersonName(person: Record<string, unknown>): string {
  const firstName = typeof person.first_name === "string" ? person.first_name.trim() : "";
  const lastName = typeof person.last_name === "string" ? person.last_name.trim() : "";
  const combined = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (combined) return combined;

  return typeof person.name === "string" ? person.name.trim() : "";
}

function normalizeKeywords(org: Record<string, unknown>): string[] {
  const fromKeywords = Array.isArray(org.keywords) ? org.keywords : [];
  const fromSeo = Array.isArray(org.seo_description_keywords) ? org.seo_description_keywords : [];

  return [...new Set([...fromKeywords, ...fromSeo].filter((value): value is string => typeof value === "string"))].slice(0, 8);
}

function normalizeTechStack(org: Record<string, unknown>): string[] {
  const raw = Array.isArray(org.technologies) ? org.technologies : [];

  return raw
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (item && typeof item === "object" && "name" in item && typeof item.name === "string") {
        return item.name;
      }

      return null;
    })
    .filter((value): value is string => Boolean(value))
    .slice(0, 8);
}

export function normalizeDomain(value?: string): string | undefined {
  if (!value) return undefined;

  try {
    const candidate = value.includes("://") ? value : `https://${value}`;
    const hostname = new URL(candidate).hostname.replace(/^www\./i, "");
    return hostname || undefined;
  } catch {
    const hostname = value
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      ?.trim();

    return hostname || undefined;
  }
}

// Apollo returns these placeholder strings when an email exists in its
// database but has not been unlocked/revealed for this API key. Treat them
// as "no email" so we fall through to Tomba.
export function isRealApolloEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed.startsWith("email_not_unlocked@")) return false;
  if (trimmed === "email_not_unlocked") return false;
  if (trimmed.includes("not_unlocked")) return false;
  return true;
}

/**
 * Extract company firmographics directly from a search-response person object.
 * The people search endpoint is FREE — this avoids the separate organizations/enrich
 * call which costs 1 credit per company. Most leads have enough org data embedded
 * in the search response to skip enrichment entirely.
 */
export function extractCompanyFromPerson(person: Record<string, unknown>): CompanyFirmographics {
  const org = (person.organization as Record<string, unknown> | undefined) || {};

  const company: CompanyFirmographics = {
    industry: typeof org.industry === "string" ? org.industry : undefined,
    employeeCount:
      typeof org.estimated_num_employees === "number"
        ? org.estimated_num_employees
        : typeof org.employee_count === "number"
          ? org.employee_count
          : typeof person.organization_num_employees === "number"
            ? (person.organization_num_employees as number)
            : undefined,
    hqCity:
      typeof org.city === "string"
        ? org.city
        : typeof person.organization_city === "string"
          ? (person.organization_city as string)
          : undefined,
    hqState:
      typeof org.state === "string"
        ? org.state
        : typeof person.organization_state === "string"
          ? (person.organization_state as string)
          : undefined,
    hqCountry:
      typeof org.country === "string"
        ? org.country
        : typeof person.organization_country === "string"
          ? (person.organization_country as string)
          : undefined,
    keywords: normalizeKeywords(org),
    techStack: normalizeTechStack(org),
    about:
      typeof org.short_description === "string"
        ? org.short_description
        : typeof org.description === "string"
          ? org.description
          : undefined,
    deliveryZone: "Other"
  };

  company.deliveryZone = resolveDeliveryZone(company);
  return company;
}
