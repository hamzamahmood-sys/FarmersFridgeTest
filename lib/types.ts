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

export interface Lead {
  id: string;
  name: string;
  email: string;
  title: string;
  linkedinUrl?: string;
  companyName: string;
  companyDomain?: string;
  organizationId?: string;
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
