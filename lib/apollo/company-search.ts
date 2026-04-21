import { personaToApolloTitles, resolveContactDepartment, scoreCompanyFit, sortLeadRecords } from "@/lib/utils";
import type { LeadRecord, ProspectCompany, SearchFilters } from "@/lib/types";
import { apolloFetch } from "./client";
import { enrichLeadContactFromApollo } from "./enrich";
import {
  getCompactCompanyNameVariant,
  getCompanyKeywordFallback,
  getDistinctiveCompanyTokens,
  parseSearchQuery,
  tokenizeCompanyName
} from "./query-parser";
import {
  extractCompanyFromOrganization,
  extractCompanyFromPerson,
  getOrganizationName,
  getPersonName,
  isRealApolloEmail,
  normalizeDomain
} from "./normalize";

const BROAD_CONTACT_TITLES = [
  "Office Manager",
  "Senior Office Manager",
  "Office Administrator",
  "Administrative Director",
  "Director of Administration",
  "Facilities Director",
  "Director of Facilities",
  "Operations Manager",
  "Director of Operations",
  "Workplace Services Director",
  "Workplace Operations Manager",
  "Director of Workplace Experience",
  "Workplace Experience Manager",
  "Head of Workplace Experience",
  "HR Director",
  "Head of HR",
  "People Operations Director",
  "Director of Human Resources",
  "Practice Manager",
  "Legal Operations Manager",
  "Clinic Manager",
  "Director of Environmental Services"
] as const;

type ApolloOrganizationSearchResponse = {
  organizations?: Array<Record<string, unknown>>;
  accounts?: Array<Record<string, unknown>>;
  companies?: Array<Record<string, unknown>>;
};

type ApolloPeopleSearchResponse = {
  people?: Array<Record<string, unknown>>;
  contacts?: Array<Record<string, unknown>>;
};

const COMMON_SECOND_LEVEL_DOMAIN_SUFFIXES = new Set([
  "ac",
  "co",
  "com",
  "edu",
  "gov",
  "net",
  "org"
]);

const CONTACT_ENRICHMENT_LIMIT = 10;

function getOrganizationResults(
  response: ApolloOrganizationSearchResponse
): Array<Record<string, unknown>> {
  return response.organizations || response.accounts || response.companies || [];
}

function getPeopleResults(
  response: ApolloPeopleSearchResponse
): Array<Record<string, unknown>> {
  return response.people || response.contacts || [];
}

function matchesCompanyTokens(name: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const normalized = tokenizeCompanyName(name);
  return tokens.every((token) => normalized.includes(token));
}

function filterRelevantCompanies(
  companies: ProspectCompany[],
  companyTokens: string[]
): ProspectCompany[] {
  if (companyTokens.length === 0) return companies;
  return companies.filter((company) => matchesCompanyTokens(company.name, companyTokens));
}

function filterCompaniesForIntent(
  companies: ProspectCompany[],
  query: ReturnType<typeof parseSearchQuery>,
  companyTokens: string[]
): ProspectCompany[] {
  if (query.domainQuery) {
    const domainLabel = getDomainCompanyLabel(query.domainQuery);

    return companies
      .map((company) => {
        const normalizedCompanyDomain = normalizeDomain(company.domain);
        let matchScore = 0;

        if (normalizedCompanyDomain === query.domainQuery) {
          matchScore = 4;
        } else if (normalizedCompanyDomain?.endsWith(`.${query.domainQuery}`)) {
          matchScore = 3;
        } else if (companyTokens.length > 0 && matchesCompanyTokens(company.name, companyTokens)) {
          matchScore = 2;
        } else if (
          domainLabel &&
          normalizedCompanyDomain &&
          getDomainCompanyLabel(normalizedCompanyDomain) === domainLabel
        ) {
          matchScore = 1;
        }

        return { company, matchScore };
      })
      .filter((entry) => entry.matchScore > 0)
      .sort(
        (a, b) =>
          b.matchScore - a.matchScore ||
          b.company.priorityScore - a.company.priorityScore ||
          a.company.name.localeCompare(b.company.name)
      )
      .map((entry) => entry.company);
  }

  const exactFiltered = filterRelevantCompanies(companies, companyTokens);
  if (query.looksLikeCompanyName) return exactFiltered;

  const hasIntentHints = query.keywords.length > 0 || query.organizationIndustries.length > 0;
  if (!hasIntentHints) return exactFiltered;

  const strictMatches = exactFiltered.filter((company) => {
    const haystack = [
      company.name,
      company.company.industry,
      company.company.about,
      company.company.keywords.join(" ")
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const keywordMatch =
      query.keywords.length > 0 &&
      query.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));

    const industryMatch =
      query.organizationIndustries.length > 0 &&
      query.organizationIndustries.some((industry) => {
        const normalizedIndustry = industry.toLowerCase();
        if (haystack.includes(normalizedIndustry)) return true;

        return normalizedIndustry
          .split(/[^a-z0-9]+/)
          .filter((token) => token.length > 2)
          .some((token) => haystack.includes(token));
      });

    return keywordMatch || industryMatch;
  });

  return strictMatches.length >= Math.min(3, exactFiltered.length)
    ? strictMatches
    : exactFiltered;
}

function sortCompanies(companies: ProspectCompany[]): ProspectCompany[] {
  return [...companies].sort(
    (a, b) => b.priorityScore - a.priorityScore || a.name.localeCompare(b.name)
  );
}

function getDomainCompanyLabel(domain: string): string {
  const labels = domain
    .toLowerCase()
    .split(".")
    .map((label) => label.trim())
    .filter(Boolean);

  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0] || "";

  const lastLabel = labels[labels.length - 1];
  const secondLastLabel = labels[labels.length - 2];

  if (
    labels.length >= 3 &&
    lastLabel &&
    lastLabel.length === 2 &&
    secondLastLabel &&
    COMMON_SECOND_LEVEL_DOMAIN_SUFFIXES.has(secondLastLabel)
  ) {
    return labels[labels.length - 3] || "";
  }

  return secondLastLabel || labels[0] || "";
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
    const emailScore = Number(b.has_email === true) - Number(a.has_email === true);
    if (emailScore !== 0) return emailScore;

    const titleScore = scoreTitleMatch(
      typeof b.title === "string" ? b.title : undefined,
      selectedTitles
    ) - scoreTitleMatch(typeof a.title === "string" ? a.title : undefined, selectedTitles);
    if (titleScore !== 0) return titleScore;

    return getOrganizationName(a).localeCompare(getOrganizationName(b));
  });
}

function toProspectCompany(
  organization: Record<string, unknown>,
  fallbackName?: string
): ProspectCompany | null {
  const rawId = organization.id ?? organization.organization_id;
  const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : "";
  const name =
    typeof organization.name === "string"
      ? organization.name
      : fallbackName || "";

  if (!id || !name) return null;

  const company = extractCompanyFromOrganization(organization);
  return {
    id,
    name,
    domain: normalizeDomain(
      typeof organization.primary_domain === "string"
        ? organization.primary_domain
        : typeof organization.website_url === "string"
          ? organization.website_url
          : typeof organization.domain === "string"
            ? organization.domain
            : undefined
    ),
    linkedinUrl:
      typeof organization.linkedin_url === "string"
        ? organization.linkedin_url
        : typeof organization.linkedin_profile_url === "string"
          ? organization.linkedin_profile_url
          : undefined,
    company,
    priorityScore: scoreCompanyFit(company)
  };
}

export async function searchCompanies(filters: SearchFilters): Promise<ProspectCompany[]> {
  const parsed = parseSearchQuery(filters.industryQuery, filters.states ?? []);
  const employeeRange = [`${filters.employeeMin},100000`];
  const domainCompanyLabel = parsed.domainQuery
    ? getDomainCompanyLabel(parsed.domainQuery)
    : "";
  const companyTokens = parsed.looksLikeCompanyName
    ? parsed.domainQuery
      ? [domainCompanyLabel].filter(Boolean)
      : getDistinctiveCompanyTokens(parsed.rawQuery)
    : [];
  const compactCompanyNameVariant = parsed.looksLikeCompanyName
    && !parsed.domainQuery
    ? getCompactCompanyNameVariant(parsed.rawQuery)
    : null;
  const companyKeywordFallback = parsed.looksLikeCompanyName
    && !parsed.domainQuery
    ? getCompanyKeywordFallback(parsed.rawQuery)
    : null;
  const companyKeywordTags = [...new Set([parsed.descriptivePhrase, ...parsed.keywords].filter(Boolean))];

  const baseParams: Record<string, unknown> = {
    page: 1,
    per_page: Math.max(filters.limit * 2, 10)
  };

  const attempts: Array<{ label: string; params: Record<string, unknown> }> = [];

  if (parsed.looksLikeCompanyName) {
    if (parsed.domainQuery) {
      attempts.push({
        label: "company-domain",
        params: { ...baseParams, q_organization_name: parsed.domainQuery }
      });

      if (domainCompanyLabel) {
        attempts.push({
          label: "company-domain-label",
          params: { ...baseParams, q_organization_name: domainCompanyLabel }
        });
      }
    } else {
      attempts.push({
        label: "company-name",
        params: { ...baseParams, q_organization_name: parsed.rawQuery }
      });
    }

    if (compactCompanyNameVariant) {
      attempts.push({
        label: "company-name-compact",
        params: { ...baseParams, q_organization_name: compactCompanyNameVariant }
      });
    }

    if (companyKeywordFallback) {
      attempts.push({
        label: "company-name-fallback",
        params: { ...baseParams, q_organization_name: companyKeywordFallback }
      });
    }
  } else {
    if (parsed.locations.length > 0 && parsed.keywords.length > 0) {
      attempts.push({
        label: "location+keywords+employees",
        params: {
          ...baseParams,
          organization_locations: parsed.locations,
          q_organization_keyword_tags: companyKeywordTags,
          organization_num_employees_ranges: employeeRange
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

    if (parsed.keywords.length > 0) {
      attempts.push({
        label: "keywords+employees",
        params: {
          ...baseParams,
          q_organization_keyword_tags: companyKeywordTags,
          organization_num_employees_ranges: employeeRange
        }
      });
    }

    if (parsed.locations.length > 0 && parsed.keywords.length > 0) {
      attempts.push({
        label: "location+keywords",
        params: {
          ...baseParams,
          organization_locations: parsed.locations,
          q_organization_keyword_tags: companyKeywordTags
        }
      });
    }

    if (parsed.locations.length > 0) {
      attempts.push({
        label: "location-only",
        params: {
          ...baseParams,
          organization_locations: parsed.locations
        }
      });
    }

    if (parsed.keywords.length > 0) {
      attempts.push({
        label: "keywords-only",
        params: {
          ...baseParams,
          q_organization_keyword_tags: companyKeywordTags
        }
      });
    }
  }

  const seenIds = new Set<string>();
  const companies: ProspectCompany[] = [];
  let successfulAttemptCount = 0;
  let lastApolloError: Error | null = null;

  for (const attempt of attempts) {
    try {
      const response = await apolloFetch<ApolloOrganizationSearchResponse>(
        "/v1/mixed_companies/search",
        attempt.params
      );
      successfulAttemptCount += 1;
      const batch = getOrganizationResults(response);

      for (const organization of batch) {
        const mapped = toProspectCompany(organization);
        if (!mapped || seenIds.has(mapped.id)) continue;
        seenIds.add(mapped.id);
        companies.push(mapped);
        if (companies.length >= Math.max(filters.limit * 3, 20)) break;
      }

      const matchingCompanies = filterCompaniesForIntent(companies, parsed, companyTokens);

      if (parsed.looksLikeCompanyName) {
        if (matchingCompanies.length >= filters.limit) {
          break;
        }
      } else if (matchingCompanies.length >= filters.limit) {
        break;
      }
    } catch (error) {
      lastApolloError =
        error instanceof Error
          ? error
          : new Error(typeof error === "string" ? error : "Apollo organization search failed.");
    }
  }

  if (successfulAttemptCount === 0 && lastApolloError) {
    throw lastApolloError;
  }

  return sortCompanies(filterCompaniesForIntent(companies, parsed, companyTokens)).slice(0, filters.limit);
}

export async function searchLeadsForCompany(
  filters: SearchFilters,
  company: ProspectCompany
): Promise<LeadRecord[]> {
  const personTitles = personaToApolloTitles(filters);
  const broaderTitles = [...new Set([...personTitles, ...BROAD_CONTACT_TITLES])];

  const baseParams: Record<string, unknown> = {
    page: 1,
    per_page: Math.max(filters.limit, 10),
    include_similar_titles: true,
    organization_ids: [company.id]
  };

  const attempts: Array<{ label: string; params: Record<string, unknown> }> = [
    {
      label: "selected-company+titles",
      params: { ...baseParams, person_titles: personTitles }
    },
    {
      label: "selected-company+broad-titles",
      params: { ...baseParams, person_titles: broaderTitles }
    },
    {
      label: "selected-company+keywords",
      params: { ...baseParams, person_titles: personTitles, q_keywords: company.name }
    },
    {
      label: "selected-company+keywords+broad-titles",
      params: { ...baseParams, person_titles: broaderTitles, q_keywords: company.name }
    },
    {
      label: "selected-company+no-title-filter",
      params: baseParams
    }
  ];

  const seenIds = new Set<string>();
  const people: Array<Record<string, unknown>> = [];
  let successfulAttemptCount = 0;
  let lastApolloError: Error | null = null;

  for (const attempt of attempts) {
    try {
      const response = await apolloFetch<ApolloPeopleSearchResponse>(
        "/v1/mixed_people/api_search",
        attempt.params
      );
      successfulAttemptCount += 1;
      const batch = getPeopleResults(response);

      for (const person of batch) {
        const rawId = person.id;
        const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : null;
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        people.push(person);
        if (people.length >= filters.limit) break;
      }

      if (people.length >= filters.limit) {
        break;
      }
    } catch (error) {
      lastApolloError =
        error instanceof Error
          ? error
          : new Error(typeof error === "string" ? error : "Apollo people search failed.");
    }
  }

  if (successfulAttemptCount === 0 && lastApolloError) {
    throw lastApolloError;
  }

  const leads = sortPeopleForOutreach(people, personTitles).slice(0, filters.limit).map((person, index) => {
    const organization = person.organization as { primary_domain?: unknown; name?: unknown } | undefined;
    const organizationPrimaryDomain =
      typeof organization?.primary_domain === "string" ? organization.primary_domain : undefined;
    const organizationName =
      typeof organization?.name === "string" ? organization.name : undefined;

    const mappedCompany = extractCompanyFromPerson(person);
    const finalCompany = {
      ...company.company,
      ...mappedCompany,
      keywords: mappedCompany.keywords.length > 0 ? mappedCompany.keywords : company.company.keywords,
      techStack: mappedCompany.techStack.length > 0 ? mappedCompany.techStack : company.company.techStack,
      about: mappedCompany.about || company.company.about
    };

    const apolloEmail = isRealApolloEmail(person.email) ? (person.email as string) : "";
    const titleValue = typeof person.title === "string" ? person.title : "Unknown Title";
    const record: LeadRecord = {
      lead: {
        id: typeof person.id === "string" || typeof person.id === "number" ? String(person.id) : `lead-${index}`,
        name: getPersonName(person) || "Unknown Contact",
        email: apolloEmail,
        title: titleValue,
        linkedinUrl:
          typeof person.linkedin_url === "string"
            ? person.linkedin_url
            : typeof person.linkedin_profile_url === "string"
              ? person.linkedin_profile_url
              : undefined,
        companyName:
          typeof person.organization_name === "string"
            ? person.organization_name
            : organizationName || company.name,
        companyDomain:
          typeof person.organization_website_url === "string"
            ? normalizeDomain(person.organization_website_url)
            : normalizeDomain(organizationPrimaryDomain) || company.domain,
        organizationId: company.id,
        department: resolveContactDepartment(undefined, titleValue),
        source: "apollo",
        emailSource: apolloEmail ? "apollo" : undefined
      },
      company: finalCompany,
      priorityScore: scoreCompanyFit(finalCompany)
    };

    if (person.has_email === true) {
      record.priorityScore += 15;
    }

    return record;
  });

  const sortedLeads = sortLeadRecords(leads);
  const enrichmentCount = Math.min(sortedLeads.length, CONTACT_ENRICHMENT_LIMIT);

  if (enrichmentCount === 0) {
    return sortedLeads;
  }

  const enrichedResults = await Promise.allSettled(
    sortedLeads
      .slice(0, enrichmentCount)
      .map(async (record) => (await enrichLeadContactFromApollo(record)).leadRecord)
  );

  return sortLeadRecords(
    sortedLeads.map((record, index) => {
      if (index >= enrichmentCount) return record;

      const result = enrichedResults[index];
      if (!result || result.status !== "fulfilled") {
        return record;
      }

      return {
        ...record,
        ...result.value,
        lead: {
          ...record.lead,
          ...result.value.lead,
          emailSource: isRealApolloEmail(result.value.lead.email) ? "apollo" : record.lead.emailSource,
          source: record.lead.source
        },
        company: {
          ...record.company,
          ...result.value.company
        },
        priorityScore: record.priorityScore
      };
    })
  );
}
