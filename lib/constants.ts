export const DELIVERY_ZONE_MATCHERS = [
  { zone: "Chicago", tokens: ["chicago", "il"] },
  { zone: "NYC", tokens: ["new york", "nyc", "brooklyn", "manhattan", "queens"] },
  { zone: "NJ", tokens: ["new jersey", "nj", "jersey city", "newark", "hoboken"] }
] as const;

export const PERSONA_LABELS: Record<string, string> = {
  office_manager: "Office Manager",
  facilities_director: "Facilities Director",
  workplace_experience: "Workplace Experience",
  hr: "HR",
  csuite: "C-Suite / Exec",
  custom: "Custom"
};

export const DEFAULT_SEARCH_FILTERS = {
  personas: ["office_manager"],
  industryQuery: "Hospitals in the Midwest",
  states: [] as string[],
  employeeMin: 200,
  limit: 10
};

export const CONTACT_SEARCH_INCREMENT = 10;
export const MAX_CONTACT_SEARCH_LIMIT = 100;

// OpenAI
export const OPENAI_MODEL = "gpt-4.1";
/** Abort OpenAI requests that have been pending longer than this. */
export const OPENAI_TIMEOUT_MS = 30_000;

/** Discard a cached pitch that is older than this many hours. */
export const PITCH_CACHE_TTL_HOURS = 24;
