import { DELIVERY_ZONE_MATCHERS } from "@/lib/constants";
import type {
  ApolloCreditEstimate,
  CompanyFirmographics,
  DeliveryZone,
  LeadRecord,
  SearchFilters
} from "@/lib/types";

export function estimateApolloCredits(limit: number): ApolloCreditEstimate {
  // We use mixed_people/api_search (free) and extract firmographics from the
  // search response directly, so searches no longer cost credits per lead.
  void limit;
  return {
    peopleSearchCalls: 1,
    organizationEnrichCalls: 0,
    totalEstimatedOperations: 1,
    note:
      "Searches use Apollo's mixed_people/api_search endpoint (free) and reuse the embedded organization data, so the search step itself stays at one operation. Optional email lookup later can still consume Apollo enrichment credits depending on your plan."
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

export function priorityLead(record: LeadRecord): number {
  let score = 0;

  if (record.company.deliveryZone !== "Other") {
    score += 100;
  }

  if (record.company.employeeCount && record.company.employeeCount >= 1000) {
    score += 30;
  } else if (record.company.employeeCount && record.company.employeeCount >= 500) {
    score += 20;
  } else if (record.company.employeeCount && record.company.employeeCount >= 200) {
    score += 10;
  }

  if (record.company.keywords.some((keyword) => ["wellness", "sustainability", "employee benefits"].includes(keyword.toLowerCase()))) {
    score += 20;
  }

  return score;
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
