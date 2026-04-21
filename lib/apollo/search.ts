import { priorityLead, personaToApolloTitles, sortLeadRecords } from "@/lib/utils";
import type { LeadRecord, SearchFilters } from "@/lib/types";
import { apolloFetch } from "./client";
import {
  parseSearchQuery,
  getDistinctiveCompanyTokens,
  tokenizeCompanyName
} from "./query-parser";
import {
  extractCompanyFromPerson,
  getOrganizationName,
  getPersonName,
  isRealApolloEmail
} from "./normalize";

const BROAD_FALLBACK_TITLES = [
  "Office Manager",
  "Senior Office Manager",
  "Facilities Director",
  "Director of Facilities",
  "Workplace Services Director",
  "Director of Workplace Experience",
  "Workplace Experience Manager",
  "Head of Workplace Experience",
  "HR Director",
  "Head of HR",
  "People Operations Director",
  "Director of Human Resources",
  "Clinic Manager",
  "Director of Environmental Services"
];

function matchesCompanyTokens(person: Record<string, unknown>, companyTokens: string[]): boolean {
  if (companyTokens.length === 0) return true;

  const companyName = getOrganizationName(person);
  if (!companyName) return false;

  const normalizedCompanyName = tokenizeCompanyName(companyName);
  return companyTokens.every((token) => normalizedCompanyName.includes(token));
}

function filterRelevantCompanyMatches(
  results: Array<Record<string, unknown>>,
  companyTokens: string[]
): Array<Record<string, unknown>> {
  if (companyTokens.length === 0) return results;

  // For exact-company searches, return empty rather than falling back to
  // unfiltered results — showing "Calvin University" when the user asked for
  // "University of Chicago" is worse than showing nothing.
  return results.filter((person) => matchesCompanyTokens(person, companyTokens));
}

function hasEmailHint(person: Record<string, unknown>): boolean {
  return person.has_email === true;
}

function scoreTitleMatch(title: string | undefined, selectedTitles: string[]): number {
  if (!title) return 0;

  const normalizedTitle = title.toLowerCase();
  if (selectedTitles.some((selectedTitle) => normalizedTitle.includes(selectedTitle.toLowerCase()))) {
    return 2;
  }

  return 0;
}

function sortPeopleForOutreach(
  people: Array<Record<string, unknown>>,
  selectedTitles: string[]
): Array<Record<string, unknown>> {
  return [...people].sort((a, b) => {
    const emailScore = Number(hasEmailHint(b)) - Number(hasEmailHint(a));
    if (emailScore !== 0) return emailScore;

    const titleScore = scoreTitleMatch(
      typeof b.title === "string" ? b.title : undefined,
      selectedTitles
    ) - scoreTitleMatch(typeof a.title === "string" ? a.title : undefined, selectedTitles);
    if (titleScore !== 0) return titleScore;

    return getOrganizationName(a).localeCompare(getOrganizationName(b));
  });
}

export async function searchLeads(filters: SearchFilters): Promise<LeadRecord[]> {
  type ApolloPeopleSearchResponse = {
    people?: Array<Record<string, unknown>>;
    contacts?: Array<Record<string, unknown>>;
  };

  const parsed = parseSearchQuery(filters.industryQuery, filters.states ?? []);
  const personTitles = personaToApolloTitles(filters);
  const broaderTitles = [...new Set([...personTitles, ...BROAD_FALLBACK_TITLES])];
  const employeeRange = [`${filters.employeeMin},100000`];

  // For post-fetch filtering we use *distinctive* tokens (stopwords + generic
  // company words removed). This prevents "rush hospital" → tokens ["rush","hospital"]
  // from filtering out "Rush University Medical Center" because "hospital" isn't
  // literally in the company name. Using getDistinctiveCompanyTokens gives ["rush"]
  // which correctly matches any Rush entity.
  const companyQueryTokens = parsed.looksLikeCompanyName
    ? getDistinctiveCompanyTokens(parsed.rawQuery)
    : [];

  const baseParams: Record<string, unknown> = {
    page: 1,
    per_page: Math.max(filters.limit, 10),
    person_titles: personTitles,
    // Apollo broadens "Office Manager" → "Senior Office Manager", "Office Services Manager", etc.
    include_similar_titles: true
  };

  // Build attempts from most specific → most lenient. Each attempt is a
  // structurally different shape; we union results across attempts.
  const attempts: Array<{ label: string; params: Record<string, unknown> }> = [];

  if (parsed.looksLikeCompanyName) {
    attempts.push({
      label: "company-name",
      params: { ...baseParams, organization_names: [parsed.rawQuery] }
    });
  }

  if (parsed.locations.length > 0 && parsed.keywordPhrase) {
    attempts.push({
      label: "location+keyword+employees",
      params: {
        ...baseParams,
        organization_locations: parsed.locations,
        q_keywords: parsed.keywordPhrase,
        organization_num_employees_ranges: employeeRange,
        ...(parsed.organizationIndustries.length > 0 ? { organization_industries: parsed.organizationIndustries } : {})
      }
    });
  }

  if (parsed.locations.length > 0) {
    attempts.push({
      label: "location+employees",
      params: {
        ...baseParams,
        organization_locations: parsed.locations,
        organization_num_employees_ranges: employeeRange
      }
    });
  }

  if (parsed.keywordPhrase) {
    attempts.push({
      label: "keyword+employees",
      params: {
        ...baseParams,
        q_keywords: parsed.keywordPhrase,
        organization_num_employees_ranges: employeeRange,
        ...(parsed.organizationIndustries.length > 0 ? { organization_industries: parsed.organizationIndustries } : {})
      }
    });
  }

  if (parsed.rawQuery && parsed.rawQuery !== parsed.keywordPhrase) {
    attempts.push({
      label: "raw-query+employees",
      params: {
        ...baseParams,
        q_keywords: parsed.rawQuery,
        organization_num_employees_ranges: employeeRange
      }
    });
  }

  // Drop employee filter as a last-resort widening
  if (parsed.locations.length > 0 && parsed.keywordPhrase) {
    attempts.push({
      label: "location+keyword (no employee filter)",
      params: {
        ...baseParams,
        organization_locations: parsed.locations,
        q_keywords: parsed.keywordPhrase
      }
    });
  }

  if (parsed.locations.length > 0) {
    attempts.push({
      label: "location only (no employee filter)",
      params: {
        ...baseParams,
        organization_locations: parsed.locations
      }
    });
  }

  attempts.push({
    label: "raw-query (no employee filter)",
    params: { ...baseParams, q_keywords: parsed.rawQuery }
  });

  attempts.push({
    label: "titles only",
    params: baseParams
  });

  const seenIds = new Set<string>();
  const allResults: Array<Record<string, unknown>> = [];
  const desiredPoolSize = parsed.looksLikeCompanyName
    ? Math.max(filters.limit * 3, 25)
    : filters.limit;

  for (const attempt of attempts) {
    try {
      const peopleResponse = await apolloFetch<ApolloPeopleSearchResponse>(
        "/v1/mixed_people/api_search",
        attempt.params
      );
      const batch = peopleResponse.people || peopleResponse.contacts || [];
      console.log(`[Apollo search] ${attempt.label}: ${batch.length} results`);

      for (const person of batch) {
        const id = typeof person.id === "string" ? person.id : null;
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          allResults.push(person);
        }
        if (allResults.length >= desiredPoolSize) break;
      }

      if (parsed.looksLikeCompanyName) {
        const relevantCount = allResults.filter((person) =>
          matchesCompanyTokens(person, companyQueryTokens)
        ).length;

        if (relevantCount >= filters.limit || allResults.length >= desiredPoolSize) {
          break;
        }
      } else if (allResults.length >= filters.limit) {
        break;
      }
    } catch (err) {
      console.warn(
        `[Apollo search] ${attempt.label} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const relevantResults = filterRelevantCompanyMatches(allResults, companyQueryTokens);
  const hasAnyEmailCapableResult = relevantResults.some((person) => hasEmailHint(person));

  if (parsed.looksLikeCompanyName && !hasAnyEmailCapableResult) {
    const supplementalAttempts: Array<{ label: string; params: Record<string, unknown> }> = [
      {
        label: "company-name+broad-titles",
        params: {
          ...baseParams,
          person_titles: broaderTitles,
          organization_names: [parsed.rawQuery]
        }
      },
      {
        label: "raw-query+broad-titles",
        params: {
          ...baseParams,
          person_titles: broaderTitles,
          q_keywords: parsed.rawQuery
        }
      }
    ];

    for (const attempt of supplementalAttempts) {
      try {
        const peopleResponse = await apolloFetch<ApolloPeopleSearchResponse>(
          "/v1/mixed_people/api_search",
          attempt.params
        );
        const batch = peopleResponse.people || peopleResponse.contacts || [];
        console.log(`[Apollo search] ${attempt.label}: ${batch.length} results`);

        for (const person of batch) {
          const id = typeof person.id === "string" ? person.id : null;
          if (id && !seenIds.has(id)) {
            seenIds.add(id);
            allResults.push(person);
          }
        }
      } catch (err) {
        console.warn(
          `[Apollo search] ${attempt.label} failed:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  console.log(
    `[Apollo search] parsed query:`,
    JSON.stringify(parsed),
    `→ ${allResults.length} unique leads`
  );

  const searchResults = sortPeopleForOutreach(
    filterRelevantCompanyMatches(allResults, companyQueryTokens),
    personTitles
  ).slice(0, filters.limit);

  // NOTE: We deliberately skip /v1/people/bulk_match and /v1/organizations/enrich.
  // Both endpoints cost Apollo credits (1 per lead / 1 per company). The free
  // mixed_people/api_search response already includes enough person + org data
  // for our needs. `extractCompanyFromPerson` pulls firmographics directly from
  // the search response instead.

  const leads = await Promise.all(
    searchResults.map(async (person, index) => {
      const organization = person.organization as { primary_domain?: unknown; name?: unknown } | undefined;
      const organizationPrimaryDomain =
        typeof organization?.primary_domain === "string" ? organization.primary_domain : undefined;
      const organizationName =
        typeof organization?.name === "string" ? organization.name : undefined;

      const company = extractCompanyFromPerson(person);

      const record: LeadRecord = {
        lead: {
          id: typeof person.id === "string" ? person.id : `lead-${index}`,
          name: getPersonName(person) || "Unknown Contact",
          email: isRealApolloEmail(person.email) ? (person.email as string) : "",
          title: typeof person.title === "string" ? person.title : "Unknown Title",
          linkedinUrl:
            typeof person.linkedin_url === "string"
              ? person.linkedin_url
              : typeof person.linkedin_profile_url === "string"
                ? person.linkedin_profile_url
                : undefined,
          companyName:
            typeof person.organization_name === "string"
              ? person.organization_name
              : organizationName
                ? organizationName
              : typeof (person.account as { name?: unknown } | undefined)?.name === "string"
                ? ((person.account as { name?: string }).name as string)
                : "Unknown Company",
          companyDomain:
            typeof person.organization_website_url === "string"
              ? person.organization_website_url
              : organizationPrimaryDomain,
          organizationId: typeof person.organization_id === "string" ? person.organization_id : undefined
        },
        company,
        priorityScore: 0
      };

      record.priorityScore = priorityLead(record);
      if (hasEmailHint(person)) {
        record.priorityScore += 15;
      }
      return record;
    })
  );

  return sortLeadRecords(leads);
}
