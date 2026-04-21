// Maps common query phrases to Apollo-compatible location strings
const LOCATION_MATCHERS: Array<{ pattern: RegExp; locations: string[] }> = [
  { pattern: /\bnew york city\b|\bnyc\b|\bmanhattan\b|\bbrooklyn\b|\bqueens\b/i, locations: ["New York"] },
  { pattern: /\bnew york\b/i, locations: ["New York"] },
  { pattern: /\bchicago\b|\bchicagoland\b/i, locations: ["Chicago"] },
  { pattern: /\billinois\b/i, locations: ["Illinois"] },
  { pattern: /\bnew jersey\b|\bnewark\b|\bjersey city\b|\bnj\b/i, locations: ["New Jersey"] },
  { pattern: /\bmidwest\b/i, locations: ["Illinois", "Michigan", "Ohio", "Indiana", "Wisconsin", "Minnesota"] },
  { pattern: /\bnortheast\b/i, locations: ["New York", "Massachusetts", "Connecticut", "New Jersey"] },
  { pattern: /\btri[-\s]?state\b/i, locations: ["New York", "New Jersey", "Connecticut"] },
  { pattern: /\bsan francisco\b|\bbay area\b|\bsf\b/i, locations: ["San Francisco"] },
  { pattern: /\blos angeles\b|\bla\b/i, locations: ["Los Angeles"] },
  { pattern: /\bboston\b/i, locations: ["Boston"] },
  { pattern: /\bmassachusetts\b|\bmass\b/i, locations: ["Massachusetts"] },
  { pattern: /\btexas\b/i, locations: ["Texas"] },
  { pattern: /\bdallas\b/i, locations: ["Dallas"] },
  { pattern: /\bhouston\b/i, locations: ["Houston"] },
  { pattern: /\baustin\b/i, locations: ["Austin"] },
  { pattern: /\bseattle\b/i, locations: ["Seattle"] },
  { pattern: /\bportland\b/i, locations: ["Portland"] },
  { pattern: /\bdenver\b/i, locations: ["Denver"] },
  { pattern: /\batlanta\b/i, locations: ["Atlanta"] },
  { pattern: /\bmiami\b/i, locations: ["Miami"] },
  { pattern: /\bphiladelphia\b|\bphilly\b/i, locations: ["Philadelphia"] },
  { pattern: /\bwashington\s*dc\b|\bwashington\b|\bdc\b/i, locations: ["Washington"] },
  { pattern: /\batlanta\b|\bgeorgia\b/i, locations: ["Georgia"] },
  { pattern: /\bflorida\b/i, locations: ["Florida"] },
  { pattern: /\bcalifornia\b/i, locations: ["California"] }
];

// Institution words that, when followed by "of <location>", form a proper-noun
// company name (e.g. "University of Chicago", "Bank of America", "Children's
// Hospital of Philadelphia"). Without this, the location matcher would strip
// the city out of the query and we'd lose the ability to route to
// organization_names.
const COMPANY_OF_LOCATION_PATTERN =
  /\b(university|college|school|bank|hospital|hospitals|academy|institute|museum|church|society|association|federation|council|foundation|library|clinic|system|state|republic|city|commonwealth|district)\s+of\s+\w+/i;

// Words that hurt keyword search by being too generic
const SEARCH_STOPWORDS = new Set([
  "in", "at", "the", "of", "and", "or", "for", "with", "to", "a", "an",
  "area", "region", "market", "markets",
  "companies", "company", "firms", "firm",
  "business", "businesses", "orgs", "organizations", "org"
]);

// Generic words that are common in exact-company searches but not distinctive
// enough to tell Apollo's broad keyword matches apart.
const COMPANY_QUERY_GENERIC_TOKENS = new Set([
  "hospital",
  "hospitals",
  "health",
  "healthcare",
  "medical",
  "medicine",
  "clinic",
  "clinics",
  "center",
  "centers",
  "centre",
  "centres",
  "system",
  "systems",
  "university",
  "campus",
  "campuses",
  "office",
  "offices",
  "park",
  "parks",
  "inc",
  "llc",
  "ltd",
  "corp",
  "corporation",
  "group"
]);

// Maps common search phrases to Apollo's industry taxonomy.
// Used to pass organization_industries instead of q_keywords when the user
// is describing a category of company rather than a specific company name.
const INDUSTRY_MAPPINGS: Array<{ pattern: RegExp; industries: string[] }> = [
  {
    pattern: /\btech(nology)?\s*(compan(y|ies)|firm|sector|startup|startups|space)?\b|\bsoftware\b|\bsaas\b|\bcloud\b|\bit\s+compan/i,
    industries: ["Information Technology and Services", "Computer Software", "Internet"]
  },
  {
    pattern: /\bhealthcare\b|\bhealth\s+care\b|\bhealth\s+system\b|\bhealth\s+network\b/i,
    industries: ["Hospital & Health Care", "Health, Wellness and Fitness", "Medical Practice"]
  },
  {
    pattern: /\bhospital\b|\bhealth\s+system\b|\bmedical\s+center\b/i,
    industries: ["Hospital & Health Care", "Medical Practice"]
  },
  {
    pattern: /\bfinancial\s*(services?|firm)?\b|\bfinance\s*(compan|firm|sector)?\b|\bbanking?\b|\binvestment\s+firm\b/i,
    industries: ["Financial Services", "Banking", "Investment Management"]
  },
  {
    pattern: /\blaw\s+firm\b|\blegal\s*(firm|compan|services?)?\b|\battorney\b|\blaw\s+office\b/i,
    industries: ["Law Practice", "Legal Services"]
  },
  {
    pattern: /\buniversity\b|\bcollege\b|\bhigher\s+ed(ucation)?\b|\bcampus(es)?\b/i,
    industries: ["Higher Education"]
  },
  {
    pattern: /\bschool\b|\bk-?12\b|\bschool\s+district\b/i,
    industries: ["Education Management", "Primary/Secondary Education"]
  },
  {
    pattern: /\breal\s+estate\b|\bproperty\s+management\b|\boffice\s+park\b|\bcorporate\s+campus\b/i,
    industries: ["Real Estate"]
  },
  {
    pattern: /\bmanufactur(ing|er)\b|\bfactor(y|ies)\b|\bindustrial\b/i,
    industries: ["Manufacturing"]
  },
  {
    pattern: /\bconstruction\b/i,
    industries: ["Construction"]
  },
  {
    pattern: /\barchitect(ure)?\b/i,
    industries: ["Architecture & Planning"]
  },
  {
    pattern: /\bgovernment\b|\bmunicipal\b|\bcity\s+of\b|\bcounty\b/i,
    industries: ["Government Administration"]
  },
  {
    pattern: /\bpharma(ceutical)?\b|\bbiotech(nology)?\b|\blife\s+science\b/i,
    industries: ["Pharmaceuticals", "Biotechnology"]
  },
  {
    pattern: /\binsurance\b/i,
    industries: ["Insurance"]
  },
  {
    pattern: /\bretail\b/i,
    industries: ["Retail", "Consumer Goods"]
  },
  {
    pattern: /\brestaurant\b|\bfood\s+service\b/i,
    industries: ["Restaurants", "Food & Beverages"]
  },
  {
    pattern: /\bhotel\b|\bhospitality\b/i,
    industries: ["Hospitality", "Leisure, Travel & Tourism"]
  },
  {
    pattern: /\bconsulting\b|\bconsultanc(y|ies)\b/i,
    industries: ["Management Consulting"]
  },
  {
    pattern: /\baccounting\b|\bcpa\b|\baudit\b/i,
    industries: ["Accounting"]
  },
  {
    pattern: /\bnon-?profit\b|\bcharity\b|\bcharitable\b/i,
    industries: ["Nonprofit Organization Management"]
  },
  {
    pattern: /\bmedia\b|\bpublish(ing|er)\b|\bnews\b/i,
    industries: ["Media Production", "Publishing"]
  },
];

function detectIndustries(query: string): string[] {
  for (const mapping of INDUSTRY_MAPPINGS) {
    if (mapping.pattern.test(query)) {
      return mapping.industries;
    }
  }
  return [];
}

export interface ParsedQuery {
  locations: string[];
  keywords: string[];
  keywordPhrase: string;
  rawQuery: string;
  looksLikeCompanyName: boolean;
  organizationIndustries: string[];
}

export function looksLikeExactCompanyQuery(query: string): boolean {
  const cleaned = query.trim();
  if (!cleaned) return false;

  // "University of Chicago", "Bank of America", etc. — treat as a company name
  // even though the query contains a location word.
  if (COMPANY_OF_LOCATION_PATTERN.test(cleaned)) return true;

  const hasExplicitLocation = LOCATION_MATCHERS.some((matcher) => matcher.pattern.test(cleaned));
  if (hasExplicitLocation) return false;

  const tokens = cleaned
    .split(/\s+/)
    .map((token) => token.replace(/[^\w&.'-]/g, "").trim().toLowerCase())
    .filter(Boolean);

  if (tokens.length < 2 || tokens.length > 5) return false;

  const distinctiveTokens = tokens.filter(
    (token) => !SEARCH_STOPWORDS.has(token) && !COMPANY_QUERY_GENERIC_TOKENS.has(token)
  );

  return distinctiveTokens.length >= 1;
}

export function parseSearchQuery(query: string, stateHints: string[]): ParsedQuery {
  const cleaned = query.trim();
  let remaining = cleaned;
  const locationsFromQuery = new Set<string>();
  const locationsFromHint = new Set<string>();

  // "University of Chicago" / "Bank of America" must NOT have "Chicago" stripped
  // as a location — the city is part of the proper noun. We detect the pattern
  // up front and skip location extraction from the query in that case.
  const isCompanyOfLocation = COMPANY_OF_LOCATION_PATTERN.test(cleaned);

  if (!isCompanyOfLocation) {
    for (const matcher of LOCATION_MATCHERS) {
      if (matcher.pattern.test(remaining)) {
        matcher.locations.forEach((loc) => locationsFromQuery.add(loc));
        remaining = remaining.replace(matcher.pattern, " ");
        // Break after first match to avoid over-eager location capture
        break;
      }
    }
  }

  // States passed directly from the UI — no regex matching needed
  for (const state of stateHints) {
    if (state.trim()) locationsFromHint.add(state.trim());
  }

  const locations = new Set<string>([...locationsFromQuery, ...locationsFromHint]);

  const keywords = remaining
    .split(/\s+/)
    .map((t) => t.replace(/[^\w&]/g, "").trim())
    .filter((t) => t.length >= 2 && !SEARCH_STOPWORDS.has(t.toLowerCase()));

  // Loose heuristic: "Northwestern Medicine", "Rush Hospital", "University of
  // Chicago", etc. Company-of-location phrases always qualify; otherwise we
  // require that no location was stripped from the query itself (region hint
  // doesn't count).
  const looksLikeCompanyName =
    isCompanyOfLocation ||
    (locationsFromQuery.size === 0 && looksLikeExactCompanyQuery(cleaned));

  const organizationIndustries = looksLikeCompanyName ? [] : detectIndustries(cleaned);

  return {
    locations: [...locations],
    keywords,
    keywordPhrase: keywords.join(" "),
    rawQuery: cleaned,
    looksLikeCompanyName,
    organizationIndustries
  };
}

function tokenizeSearchText(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9&]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function getDistinctiveCompanyTokens(query: string): string[] {
  return tokenizeSearchText(query).filter(
    (token) => !SEARCH_STOPWORDS.has(token) && !COMPANY_QUERY_GENERIC_TOKENS.has(token)
  );
}

export function tokenizeCompanyName(value: string): string {
  return tokenizeSearchText(value).join(" ");
}
