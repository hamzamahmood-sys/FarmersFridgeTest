import type {
  EmailFilter,
  LocationType,
  NavPage,
  PipelineStage,
  PitchType,
  ProspectCompany,
  SavedLocation,
  StoredEmail,
  DepartmentFilter
} from "./types";
import { LayoutDashboard, Mail, Search, Sparkles } from "lucide-react";

export const navItems: Array<{ id: NavPage; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "contacts", label: "Find Contacts", icon: Search },
  { id: "emails", label: "Emails", icon: Mail },
  { id: "tone", label: "Tone of Voice", icon: Sparkles }
];

export const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
  "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina",
  "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
  "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "Washington DC", "West Virginia", "Wisconsin", "Wyoming"
];

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  hospital: "Hospital",
  corporate: "Corporate",
  university: "University",
  gym: "Gym",
  airport: "Airport",
  other: "Other"
};

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  prospect: "Prospect",
  meeting: "Meeting",
  won: "Won",
  lost: "Lost"
};

export const PITCH_TYPE_LABELS: Record<PitchType, string> = {
  farmers_fridge: "Fridge",
  vending: "Vending",
  catering: "Catering"
};

export const EMAIL_STATUS_LABELS: Record<Exclude<EmailFilter, "all">, string> = {
  generated: "Generated",
  approved: "Approved",
  sent: "Sent"
};

export const DEPARTMENT_FILTER_LABELS: Record<Exclude<DepartmentFilter, "all">, string> = {
  facilities: "Facilities",
  hr_people: "HR / People",
  workplace: "Workplace",
  fnb: "F&B",
  csuite: "C-Suite",
  other: "Other"
};

export function locationToProspectCompany(location: SavedLocation): ProspectCompany {
  return {
    id: location.organizationId || location.id,
    name: location.companyName,
    domain: location.companyDomain,
    priorityScore: 0,
    company: {
      industry: location.industry,
      employeeCount: location.employeeCount,
      hqCity: location.hqCity,
      hqState: location.hqState,
      hqCountry: location.hqCountry,
      keywords: [],
      techStack: [],
      about: location.about,
      deliveryZone: location.deliveryZone
    }
  };
}

export function companyToPreviewLocation(company: ProspectCompany): SavedLocation {
  return {
    id: `preview:${company.id}`,
    organizationId: company.id,
    companyName: company.name,
    companyDomain: company.domain,
    industry: company.company.industry,
    employeeCount: company.company.employeeCount,
    hqCity: company.company.hqCity,
    hqState: company.company.hqState,
    hqCountry: company.company.hqCountry,
    about: company.company.about,
    category: company.company.industry,
    locationType: "other",
    pipelineStage: "prospect",
    pitchType: "farmers_fridge",
    notes: "",
    deliveryZone: company.company.deliveryZone,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function formatCompanyMeta(company: {
  hqCity?: string;
  hqState?: string;
  employeeCount?: number;
}): string {
  const location = [company.hqCity, company.hqState].filter(Boolean).join(", ");
  const employees = company.employeeCount ? `${company.employeeCount.toLocaleString()}+` : "";
  return [location, employees].filter(Boolean).join(" · ");
}

export function getStatusClass(status: Exclude<EmailFilter, "all">) {
  return `statusBadge statusBadge--${status}`;
}

export function isPreviewLocationId(locationId: string | null | undefined): boolean {
  return Boolean(locationId?.startsWith("preview:"));
}

export function isPipelineStorageError(message: string): boolean {
  return /relation "saved_locations" does not exist|relation "emails" does not exist/i.test(message);
}

export function filteredEmails(emails: StoredEmail[], emailFilter: EmailFilter, emailSearch: string): StoredEmail[] {
  return emails.filter((email) => {
    const matchesFilter = emailFilter === "all" || email.status === emailFilter;
    const matchesSearch = emailSearch.trim()
      ? [email.subject, email.body, email.companyName, email.contactName, email.contactEmail]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(emailSearch.trim().toLowerCase())
      : true;

    return matchesFilter && matchesSearch;
  });
}
