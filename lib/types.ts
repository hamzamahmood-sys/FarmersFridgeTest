export type DeliveryZone = "Chicago" | "NYC" | "NJ" | "Other";

export interface SearchFilters {
  personas: Array<
    "office_manager" | "facilities_director" | "workplace_experience" | "hr" | "csuite" | "custom"
  >;
  customPersona?: string;
  industryQuery: string;
  states: string[];
  employeeMin: number;
  limit: number;
}

export type ContactSource = "apollo" | "ai";
export type EmailSource = "apollo" | "tomba" | "ai" | "existing";

export interface Lead {
  externalId?: string;
  id: string;
  name: string;
  email: string;
  title: string;
  linkedinUrl?: string;
  companyName: string;
  companyDomain?: string;
  organizationId?: string;
  department?: ContactDepartment;
  locationId?: string;
  /** Where this contact record originated. Undefined = legacy Apollo. */
  source?: ContactSource;
  /** Where the email address came from (only meaningful when email is non-empty). */
  emailSource?: EmailSource;
}

export interface CompanyFirmographics {
  industry?: string;
  employeeCount?: number;
  hqCity?: string;
  hqState?: string;
  hqCountry?: string;
  keywords: string[];
  techStack: string[];
  about?: string;
  deliveryZone: DeliveryZone;
}

export interface LeadRecord {
  lead: Lead;
  company: CompanyFirmographics;
  priorityScore: number;
}

export interface ProspectCompany {
  id: string;
  name: string;
  domain?: string;
  linkedinUrl?: string;
  company: CompanyFirmographics;
  priorityScore: number;
}

export interface ApolloCreditEstimate {
  peopleSearchCalls: number;
  organizationEnrichCalls: number;
  totalEstimatedOperations: number;
  note: string;
}

export interface PitchRequestPayload {
  leadRecord: LeadRecord;
  talkingPointsOverride?: string;
}

export interface GeneratedPitch {
  subject: string;
  body: string;
  talkingPoints: string;
  bridgeInsight: string;
  summary: string;
  painPoints: string[];
  variableEvidence: string[];
}

export interface GmailDraftPayload {
  to: string;
  subject: string;
  body: string;
}

// ─── Saved locations + pipeline ──────────────────────────────────────────────

export type LocationType =
  | "hospital"
  | "corporate"
  | "university"
  | "gym"
  | "airport"
  | "other";

export type PipelineStage = "prospect" | "meeting" | "won" | "lost";

export type PitchType = "farmers_fridge" | "vending" | "catering";

export type ContactDepartment =
  | "facilities"
  | "hr_people"
  | "workplace"
  | "fnb"
  | "csuite"
  | "other";

export interface SavedLocation {
  id: string;
  organizationId?: string;
  companyName: string;
  companyDomain?: string;
  industry?: string;
  employeeCount?: number;
  hqCity?: string;
  hqState?: string;
  hqCountry?: string;
  about?: string;
  category?: string;
  locationType: LocationType;
  pipelineStage: PipelineStage;
  pitchType: PitchType;
  notes?: string;
  deliveryZone: DeliveryZone;
  createdAt: string;
  updatedAt: string;
}

export interface SavedLocationSummary extends SavedLocation {
  contactsCount: number;
  emailsCount: number;
}

export interface DashboardStats {
  locationsCount: number;
  draftsCount: number;
  wonCount: number;
  pipelineByStage: Record<PipelineStage, number>;
  byLocationType: Record<LocationType, number>;
}

// ─── Emails ──────────────────────────────────────────────────────────────────

export type EmailStatus = "generated" | "approved" | "sent";

export interface StoredEmail {
  id: string;
  locationId?: string;
  leadId?: string;
  contactName?: string;
  contactEmail?: string;
  contactTitle?: string;
  companyName?: string;
  locationType?: LocationType;
  sequenceStep: number;
  subject: string;
  body: string;
  status: EmailStatus;
  gmailDraftUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocationDetail {
  location: SavedLocation;
  contacts: LeadRecord[];
  emails: StoredEmail[];
}

// ─── Tone of voice ───────────────────────────────────────────────────────────

export interface ToneSettings {
  voiceDescription: string;
  doExamples: string;
  dontExamples: string;
  sampleEmail: string;
  updatedAt?: string;
}
