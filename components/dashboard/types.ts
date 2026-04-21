import type {
  ApolloCreditEstimate,
  DashboardStats,
  GeneratedPitch,
  LeadRecord,
  LocationDetail,
  LocationType,
  PipelineStage,
  PitchType,
  ProspectCompany,
  SavedLocation,
  SavedLocationSummary,
  SearchFilters,
  StoredEmail,
  ToneSettings
} from "@/lib/types";

export type {
  ApolloCreditEstimate,
  DashboardStats,
  GeneratedPitch,
  LeadRecord,
  LocationDetail,
  LocationType,
  PipelineStage,
  PitchType,
  ProspectCompany,
  SavedLocation,
  SavedLocationSummary,
  SearchFilters,
  StoredEmail,
  ToneSettings
};

export type GmailStatus = {
  connected: boolean;
  scope: string | null;
  expiresAt: number | null;
};

export type EnrichEmailResponse = {
  leadRecord: LeadRecord;
  source: EmailSource;
  emailFound: boolean;
  emailStatus?: string;
  providersTried?: string[];
  providerNotes?: string[];
  error?: string;
};

export type FollowUpDraft = {
  subject: string;
  body: string;
};

export type ResearchState = {
  status: "idle" | "researched";
  pitch: GeneratedPitch;
  talkingPoints: string;
  followUp1?: FollowUpDraft;
  followUp2?: FollowUpDraft;
  sequenceStatus?: "idle" | "generating" | "ready" | "error";
  sequenceError?: string;
  researchedAt?: string;
};

export type EmailLookupState = "idle" | "looking" | "found" | "not_found";
export type EmailSource = "existing" | "apollo" | "tomba" | "ai" | "none";
export type NavPage = "dashboard" | "contacts" | "emails" | "tone";
export type SearchMode = "search" | "bulk";
export type EmailFilter = "all" | "generated" | "approved" | "sent";
export type DepartmentFilter = "all" | "facilities" | "hr_people" | "workplace" | "fnb" | "csuite" | "other";
