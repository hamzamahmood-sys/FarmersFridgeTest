import { DELIVERY_ZONE_MATCHERS } from "@/lib/constants";
import type {
  ApolloCreditEstimate,
  CompanyFirmographics,
  ContactDepartment,
  DeliveryZone,
  LeadRecord,
  LocationType,
  SearchFilters
} from "@/lib/types";

export function estimateApolloCredits(limit: number): ApolloCreditEstimate {
  // Company search now uses Apollo's organization search endpoint, then the
  // selected company is expanded into contacts via the free people search.
  void limit;
  return {
    peopleSearchCalls: 1,
    organizationEnrichCalls: 1,
    totalEstimatedOperations: 2,
    note:
      "Search starts with Apollo's organization search to find matching companies, then loads contacts for the company you pick using the free mixed_people/api_search endpoint. Organization search may consume Apollo credits depending on your plan."
  };
}

export function resolveDeliveryZone(company: Pick<CompanyFirmographics, "hqCity" | "hqState">): DeliveryZone {
  const haystack = `${company.hqCity || ""} ${company.hqState || ""}`.toLowerCase();

  for (const matcher of DELIVERY_ZONE_MATCHERS) {
    if (matcher.tokens.some((token) => haystack.includes(token))) {
      return matcher.zone;
    }
  }

  return "Other";
}

export function scoreCompanyFit(company: CompanyFirmographics): number {
  let score = 0;

  if (company.deliveryZone !== "Other") {
    score += 100;
  }

  if (company.employeeCount && company.employeeCount >= 1000) {
    score += 30;
  } else if (company.employeeCount && company.employeeCount >= 500) {
    score += 20;
  } else if (company.employeeCount && company.employeeCount >= 200) {
    score += 10;
  }

  if (company.keywords.some((keyword) => ["wellness", "sustainability", "employee benefits"].includes(keyword.toLowerCase()))) {
    score += 20;
  }

  return score;
}

export function priorityLead(record: LeadRecord): number {
  return scoreCompanyFit(record.company);
}

export function sortLeadRecords(records: LeadRecord[]): LeadRecord[] {
  const contactabilityScore = (record: LeadRecord) =>
    record.lead.email ? 2 : record.lead.linkedinUrl ? 1 : 0;

  return [...records].sort(
    (a, b) =>
      b.priorityScore - a.priorityScore ||
      contactabilityScore(b) - contactabilityScore(a) ||
      a.lead.companyName.localeCompare(b.lead.companyName)
  );
}

export function formatLocation(company: CompanyFirmographics): string {
  return [company.hqCity, company.hqState, company.hqCountry].filter(Boolean).join(", ");
}

export function inferLocationType(input: {
  name?: string;
  industry?: string;
  about?: string;
  keywords?: string[];
}): LocationType {
  const haystack = [
    input.name || "",
    input.industry || "",
    input.about || "",
    ...(input.keywords || [])
  ]
    .join(" ")
    .toLowerCase();

  if (/(hospital|health system|healthcare|medical center|medical|clinic|care center|children'?s hospital)/.test(haystack)) {
    return "hospital";
  }

  if (/(airport|terminal|aviation|airlines?)/.test(haystack)) {
    return "airport";
  }

  if (/(university|college|campus|school)/.test(haystack)) {
    return "university";
  }

  if (/(gym|fitness|wellness club|health club)/.test(haystack)) {
    return "gym";
  }

  if (haystack.trim().length > 0) {
    return "corporate";
  }

  return "other";
}

export function inferContactDepartment(title?: string): ContactDepartment {
  const normalized = (title || "").toLowerCase();

  if (/(facilit|real estate|property|workplace services|operations)/.test(normalized)) {
    return "facilities";
  }

  if (/(people|human resources|hr\b|talent|employee experience)/.test(normalized)) {
    return "hr_people";
  }

  if (/(workplace|office manager|office operations|experience manager)/.test(normalized)) {
    return "workplace";
  }

  if (/(food|beverage|dining|hospitality|culinary|cafeteria)/.test(normalized)) {
    return "fnb";
  }

  if (/(chief|ceo|coo|cfo|founder|president|vice president|vp\b|director|general manager)/.test(normalized)) {
    return "csuite";
  }

  return "other";
}

export function personaToApolloTitles(filters: SearchFilters): string[] {
  const titles = new Set<string>();

  for (const persona of filters.personas) {
    if (persona === "custom") {
      if (filters.customPersona) {
        titles.add(filters.customPersona);
      }
      continue;
    }

    switch (persona) {
      case "office_manager":
        titles.add("Office Manager");
        titles.add("Senior Office Manager");
        break;
      case "facilities_director":
        titles.add("Facilities Director");
        titles.add("Director of Facilities");
        titles.add("Workplace Services Director");
        break;
      case "workplace_experience":
        titles.add("Director of Workplace Experience");
        titles.add("Workplace Experience Manager");
        titles.add("Head of Workplace Experience");
        break;
      case "hr":
        titles.add("HR Director");
        titles.add("Head of HR");
        titles.add("People Operations Director");
        break;
      case "csuite":
        titles.add("CEO");
        titles.add("President");
        titles.add("Co-Founder");
        titles.add("Founder");
        titles.add("COO");
        titles.add("CFO");
        titles.add("Chief Operating Officer");
        titles.add("Chief Financial Officer");
        break;
    }
  }

  return titles.size > 0 ? [...titles] : ["Office Manager"];
}

function stripLegacySpecificityPostscript(body: string): string {
  return body
    .replace(/\n\nP\.S\. I thought this could be especially relevant for your .*? footprint\.?\s*$/i, "")
    .trim();
}

/**
 * Returns true when a cached or generated pitch contains generic fallback copy
 * that is not worth showing or serving from the cache.  Defined here so the
 * API route and the dashboard always use the same detection logic.
 */
export function isLowSignalPitch(pitch: { subject: string; body: string }): boolean {
  const body = pitch.body.toLowerCase();
  const subject = pitch.subject.toLowerCase();

  return (
    body.includes("immediate uptick in employee satisfaction scores") ||
    body.includes("similar companies are seeing real upticks in employee satisfaction") ||
    body.includes("p.s. i thought this could be especially relevant for your") ||
    subject.startsWith("quick question for ")
  );
}

export function ensurePitchSpecificity(body: string, subject: string, record: LeadRecord) {
  const evidence = [
    record.company.hqCity,
    record.company.employeeCount ? String(record.company.employeeCount) : undefined,
    record.company.keywords[0]
  ].filter(Boolean) as string[];

  const cleanedBody = stripLegacySpecificityPostscript(body);
  const combined = `${subject}\n${cleanedBody}`.toLowerCase();
  const matched = evidence.filter((item) => combined.includes(item.toLowerCase()));

  if (matched.length > 0) {
    return { subject, body: cleanedBody, variableEvidence: matched };
  }

  return {
    subject,
    body: cleanedBody,
    variableEvidence: []
  };
}
