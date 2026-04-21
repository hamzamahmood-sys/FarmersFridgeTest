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
  const fullName = typeof person.name === "string" ? person.name.trim() : "";
  const combined = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (firstName && lastName) return combined;

  // Apollo sometimes omits last_name while still providing a fuller name string.
  // Prefer that fuller value when the split fields are incomplete.
  if (fullName) {
    const splitTokenCount = [firstName, lastName].filter(Boolean).length;
    const fullTokenCount = fullName.split(/\s+/).filter(Boolean).length;

    if (fullTokenCount > splitTokenCount) {
      return fullName;
    }
  }

  return combined || fullName;
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

function extractCompanyFirmographics(
  source: Record<string, unknown>,
  fallback?: Partial<CompanyFirmographics>
): CompanyFirmographics {
  const company: CompanyFirmographics = {
    industry:
      typeof source.industry === "string"
        ? source.industry
        : fallback?.industry,
    employeeCount:
      typeof source.estimated_num_employees === "number"
        ? source.estimated_num_employees
        : typeof source.employee_count === "number"
          ? source.employee_count
          : fallback?.employeeCount,
    hqCity:
      typeof source.city === "string"
        ? source.city
        : fallback?.hqCity,
    hqState:
      typeof source.state === "string"
        ? source.state
        : fallback?.hqState,
    hqCountry:
      typeof source.country === "string"
        ? source.country
        : fallback?.hqCountry,
    keywords: normalizeKeywords(source),
    techStack: normalizeTechStack(source),
    about:
      typeof source.short_description === "string"
        ? source.short_description
        : typeof source.description === "string"
          ? source.description
          : fallback?.about,
    deliveryZone: "Other"
  };

  company.deliveryZone = resolveDeliveryZone(company);
  return company;
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
  return extractCompanyFirmographics(org, {
    employeeCount:
      typeof person.organization_num_employees === "number"
        ? (person.organization_num_employees as number)
        : undefined,
    hqCity:
      typeof person.organization_city === "string"
        ? (person.organization_city as string)
        : undefined,
    hqState:
      typeof person.organization_state === "string"
        ? (person.organization_state as string)
        : undefined,
    hqCountry:
      typeof person.organization_country === "string"
        ? (person.organization_country as string)
        : undefined
  });
}

export function extractCompanyFromOrganization(
  organization: Record<string, unknown>
): CompanyFirmographics {
  return extractCompanyFirmographics(organization);
}
