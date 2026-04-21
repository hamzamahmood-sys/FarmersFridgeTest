"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  LayoutDashboard,
  Mail,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Zap
} from "lucide-react";
import { DEFAULT_SEARCH_FILTERS, PERSONA_LABELS } from "@/lib/constants";
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

type GmailStatus = {
  connected: boolean;
  scope: string | null;
  expiresAt: number | null;
};

type CompanySearchResponse = {
  companies: ProspectCompany[];
  creditEstimate: ApolloCreditEstimate;
};

type LocationListResponse = {
  locations: SavedLocationSummary[];
};

type DashboardResponse = {
  stats: DashboardStats;
  recentLocations: SavedLocationSummary[];
};

type EmailsResponse = {
  emails: StoredEmail[];
};

type ToneResponse = {
  tone: ToneSettings;
};

type EnrichEmailResponse = {
  leadRecord: LeadRecord;
  source: "existing" | "apollo" | "tomba" | "none";
  emailFound: boolean;
  emailStatus?: string;
  providersTried?: string[];
  providerNotes?: string[];
  error?: string;
};

type FollowUpDraft = {
  subject: string;
  body: string;
};

type ResearchState = {
  status: "idle" | "researched";
  pitch: GeneratedPitch;
  talkingPoints: string;
  followUp1?: FollowUpDraft;
  followUp2?: FollowUpDraft;
  sequenceStatus?: "idle" | "generating" | "ready" | "error";
  sequenceError?: string;
  researchedAt?: string;
};

type EmailLookupState = "idle" | "looking" | "found" | "not_found";
type EmailSource = "existing" | "apollo" | "tomba" | "none";
type NavPage = "dashboard" | "contacts" | "emails" | "tone";
type SearchMode = "search" | "bulk";
type EmailFilter = "all" | "generated" | "approved" | "sent";
type DepartmentFilter = "all" | "facilities" | "hr_people" | "workplace" | "fnb" | "csuite" | "other";

const navItems: Array<{ id: NavPage; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "contacts", label: "Find Contacts", icon: Search },
  { id: "emails", label: "Emails", icon: Mail },
  { id: "tone", label: "Tone of Voice", icon: Sparkles }
];

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
  "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina",
  "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
  "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "Washington DC", "West Virginia", "Wisconsin", "Wyoming"
];

const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  hospital: "Hospital",
  corporate: "Corporate",
  university: "University",
  gym: "Gym",
  airport: "Airport",
  other: "Other"
};

const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  prospect: "Prospect",
  meeting: "Meeting",
  won: "Won",
  lost: "Lost"
};

const PITCH_TYPE_LABELS: Record<PitchType, string> = {
  farmers_fridge: "Fridge",
  vending: "Vending",
  catering: "Catering"
};

const EMAIL_STATUS_LABELS: Record<Exclude<EmailFilter, "all">, string> = {
  generated: "Generated",
  approved: "Approved",
  sent: "Sent"
};

const DEPARTMENT_FILTER_LABELS: Record<Exclude<DepartmentFilter, "all">, string> = {
  facilities: "Facilities",
  hr_people: "HR / People",
  workplace: "Workplace",
  fnb: "F&B",
  csuite: "C-Suite",
  other: "Other"
};

function isLowSignalPitch(pitch: GeneratedPitch): boolean {
  const body = pitch.body.toLowerCase();
  const subject = pitch.subject.toLowerCase();

  return (
    body.includes("immediate uptick in employee satisfaction scores") ||
    body.includes("similar companies are seeing real upticks in employee satisfaction") ||
    body.includes("p.s. i thought this could be especially relevant for your") ||
    subject.startsWith("quick question for ")
  );
}

function locationToProspectCompany(location: SavedLocation): ProspectCompany {
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

function companyToPreviewLocation(company: ProspectCompany): SavedLocation {
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

function formatCompanyMeta(company: {
  hqCity?: string;
  hqState?: string;
  employeeCount?: number;
}): string {
  const location = [company.hqCity, company.hqState].filter(Boolean).join(", ");
  const employees = company.employeeCount ? `${company.employeeCount.toLocaleString()}+` : "";
  return [location, employees].filter(Boolean).join(" · ");
}

function getStatusClass(status: Exclude<EmailFilter, "all">) {
  return `statusBadge statusBadge--${status}`;
}

function isPreviewLocationId(locationId: string | null | undefined): boolean {
  return Boolean(locationId?.startsWith("preview:"));
}

function isPipelineStorageError(message: string): boolean {
  return /relation "saved_locations" does not exist|relation "emails" does not exist/i.test(message);
}

export function OutreachDashboard() {
  const [activePage, setActivePage] = useState<NavPage>("dashboard");
  const [searchMode, setSearchMode] = useState<SearchMode>("search");
  const [filters, setFilters] = useState<SearchFilters>({
    personas: [...DEFAULT_SEARCH_FILTERS.personas] as SearchFilters["personas"],
    industryQuery: DEFAULT_SEARCH_FILTERS.industryQuery,
    states: [...DEFAULT_SEARCH_FILTERS.states],
    employeeMin: DEFAULT_SEARCH_FILTERS.employeeMin,
    limit: DEFAULT_SEARCH_FILTERS.limit
  });
  const [query, setQuery] = useState("Midwest hospitals");
  const [bulkInput, setBulkInput] = useState("");
  const [limitInput, setLimitInput] = useState(String(DEFAULT_SEARCH_FILTERS.limit));
  const [hasSearched, setHasSearched] = useState(false);
  const [creditEstimate, setCreditEstimate] = useState<ApolloCreditEstimate | null>(null);
  const [companies, setCompanies] = useState<ProspectCompany[]>([]);
  const [locations, setLocations] = useState<SavedLocationSummary[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>({
    locationsCount: 0,
    draftsCount: 0,
    wonCount: 0,
    pipelineByStage: { prospect: 0, meeting: 0, won: 0, lost: 0 },
    byLocationType: { hospital: 0, corporate: 0, university: 0, gym: 0, airport: 0, other: 0 }
  });
  const [recentLocations, setRecentLocations] = useState<SavedLocationSummary[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [locationDetail, setLocationDetail] = useState<LocationDetail | null>(null);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationTypeFilter, setLocationTypeFilter] = useState<LocationType | "all">("all");
  const [pipelineStageFilter, setPipelineStageFilter] = useState<PipelineStage | "all">("all");
  const [emails, setEmails] = useState<StoredEmail[]>([]);
  const [emailFilter, setEmailFilter] = useState<EmailFilter>("all");
  const [emailSearch, setEmailSearch] = useState("");
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [emailEditor, setEmailEditor] = useState<{ subject: string; body: string; status: Exclude<EmailFilter, "all"> }>({
    subject: "",
    body: "",
    status: "generated"
  });
  const [toneSettings, setToneSettings] = useState<ToneSettings>({
    voiceDescription: "",
    doExamples: "",
    dontExamples: "",
    sampleEmail: ""
  });
  const [notesDraft, setNotesDraft] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<DepartmentFilter>("all");
  const [researchByLeadId, setResearchByLeadId] = useState<Record<string, ResearchState>>({});
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);
  const [emailLookupLeadId, setEmailLookupLeadId] = useState<string | null>(null);
  const [emailLookupStateByLeadId, setEmailLookupStateByLeadId] = useState<Record<string, EmailLookupState>>({});
  const [emailSourceByLeadId, setEmailSourceByLeadId] = useState<Record<string, EmailSource>>({});
  const [bulkResearchProgress, setBulkResearchProgress] = useState<{
    total: number;
    completed: number;
    active: boolean;
  } | null>(null);
  const [isBulkResearching, setIsBulkResearching] = useState(false);
  const [loadingLocationId, setLoadingLocationId] = useState<string | null>(null);
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [searchPending, startSearchTransition] = useTransition();
  const [pitchPending, startPitchTransition] = useTransition();
  const [draftPending, startDraftTransition] = useTransition();
  const [savePending, startSaveTransition] = useTransition();
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageSuccess, setPageSuccess] = useState<string | null>(null);

  const selectedEmail = useMemo(
    () => filteredEmails(emails, emailFilter, emailSearch).find((email) => email.id === selectedEmailId)
      || filteredEmails(emails, emailFilter, emailSearch)[0]
      || null,
    [emails, emailFilter, emailSearch, selectedEmailId]
  );

  const currentLocation = locationDetail?.location ?? null;
  const currentContacts = locationDetail?.contacts ?? [];
  const currentLocationEmails = locationDetail?.emails ?? [];
  const isPreviewLocation = isPreviewLocationId(currentLocation?.id);

  const visibleLocations = useMemo(() => {
    return locations.filter((location) => {
      const matchesQuery = locationQuery.trim()
        ? [
            location.companyName,
            location.companyDomain,
            location.industry,
            location.category,
            location.hqCity,
            location.hqState
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(locationQuery.trim().toLowerCase())
        : true;

      const matchesType = locationTypeFilter === "all" || location.locationType === locationTypeFilter;
      const matchesStage = pipelineStageFilter === "all" || location.pipelineStage === pipelineStageFilter;

      return matchesQuery && matchesType && matchesStage;
    });
  }, [locationQuery, locationTypeFilter, locations, pipelineStageFilter]);

  const visibleContacts = useMemo(() => {
    return currentContacts.filter((record) => {
      const matchesQuery = contactSearch.trim()
        ? [
            record.lead.name,
            record.lead.email,
            record.lead.title,
            record.lead.companyName,
            record.lead.department
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(contactSearch.trim().toLowerCase())
        : true;

      const matchesDepartment = departmentFilter === "all" || record.lead.department === departmentFilter;
      return matchesQuery && matchesDepartment;
    });
  }, [contactSearch, currentContacts, departmentFilter]);

  const contactCountsByDepartment = useMemo(() => {
    return currentContacts.reduce<Record<Exclude<DepartmentFilter, "all">, number>>(
      (counts, record) => {
        const department = record.lead.department || "other";
        counts[department] += 1;
        return counts;
      },
      {
        facilities: 0,
        hr_people: 0,
        workplace: 0,
        fnb: 0,
        csuite: 0,
        other: 0
      }
    );
  }, [currentContacts]);

  const hasActiveContactFilters = departmentFilter !== "all" || Boolean(contactSearch.trim());

  const unresearchedCount = useMemo(
    () =>
      currentContacts.filter((record) => {
        const research = researchByLeadId[record.lead.id];
        return !research || isLowSignalPitch(research.pitch);
      }).length,
    [currentContacts, researchByLeadId]
  );

  useEffect(() => {
    void refreshInitialData();
  }, []);

  useEffect(() => {
    setLimitInput(String(filters.limit));
  }, [filters.limit]);

  useEffect(() => {
    if (!currentLocation) {
      setNotesDraft("");
      return;
    }

    setNotesDraft(currentLocation.notes || "");
  }, [currentLocation?.id, currentLocation?.notes]);

  useEffect(() => {
    if (!selectedEmail) {
      setEmailEditor({ subject: "", body: "", status: "generated" });
      return;
    }

    setEmailEditor({
      subject: selectedEmail.subject,
      body: selectedEmail.body,
      status: selectedEmail.status
    });
  }, [selectedEmail?.id, selectedEmail?.subject, selectedEmail?.body, selectedEmail?.status]);

  async function refreshInitialData() {
    await Promise.all([
      refreshGmailStatus(),
      loadDashboard(),
      loadLocations(),
      loadEmails(),
      loadTone()
    ]);
  }

  async function refreshGmailStatus() {
    try {
      const response = await fetch("/api/gmail/status");
      const data = (await response.json()) as GmailStatus;
      setGmailStatus(data);
    } catch {
      setGmailStatus(null);
    }
  }

  async function loadDashboard() {
    const response = await fetch("/api/dashboard");
    const data = (await response.json()) as DashboardResponse & { error?: string };

    if (!response.ok) {
      throw new Error(data.error || "Failed to load dashboard.");
    }

    setDashboardStats(data.stats);
    setRecentLocations(data.recentLocations);
  }

  async function loadLocations() {
    const response = await fetch("/api/locations");
    const data = (await response.json()) as LocationListResponse & { error?: string };

    if (!response.ok) {
      throw new Error(data.error || "Failed to load locations.");
    }

    setLocations(data.locations);
  }

  async function loadEmails() {
    const response = await fetch("/api/emails");
    const data = (await response.json()) as EmailsResponse & { error?: string };

    if (!response.ok) {
      throw new Error(data.error || "Failed to load emails.");
    }

    setEmails(data.emails);
  }

  async function loadTone() {
    const response = await fetch("/api/tone");
    const data = (await response.json()) as ToneResponse & { error?: string };

    if (!response.ok) {
      throw new Error(data.error || "Failed to load tone settings.");
    }

    setToneSettings(data.tone);
  }

  async function openLocation(locationId: string) {
    setLoadingLocationId(locationId);
    setPageError(null);
    setPageSuccess(null);

    try {
      const response = await fetch(`/api/locations/${locationId}`);
      const data = (await response.json()) as LocationDetail & { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "Failed to load location.");
      }

      setSelectedLocationId(locationId);
      setLocationDetail(data);
      setExpandedLeadId(null);
      setResearchByLeadId({});
      setEmailLookupStateByLeadId({});
      setEmailSourceByLeadId({});
      setContactSearch("");
      setDepartmentFilter("all");
      setActivePage("contacts");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to load location.");
    } finally {
      setLoadingLocationId(null);
    }
  }

  async function saveCompanyToPipeline(company: ProspectCompany) {
    const response = await fetch("/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company })
    });

    const data = (await response.json()) as { location: SavedLocation; error?: string };
    if (!response.ok || !data.location) {
      throw new Error(data.error || "Failed to save location.");
    }

    await Promise.all([loadLocations(), loadDashboard()]);
    setPageSuccess(`${company.name} saved to the pipeline.`);
    return data.location;
  }

  async function handleSaveCompanyToPipeline(company: ProspectCompany) {
    try {
      await saveCompanyToPipeline(company);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save location.";
      setPageError(
        isPipelineStorageError(message)
          ? "Pipeline saving is unavailable because the database migration has not been run yet."
          : message
      );
    }
  }

  async function handleOpenCompany(company: ProspectCompany) {
    try {
      const location = await saveCompanyToPipeline(company);
      await openLocation(location.id);
      await loadContactsForLocation(location);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open company.";

      if (isPipelineStorageError(message)) {
        const previewLocation = companyToPreviewLocation(company);
        setSelectedLocationId(previewLocation.id);
        setLocationDetail({ location: previewLocation, contacts: [], emails: [] });
        setExpandedLeadId(null);
        setResearchByLeadId({});
        setEmailLookupStateByLeadId({});
        setEmailSourceByLeadId({});
        setContactSearch("");
        setDepartmentFilter("all");
        setActivePage("contacts");
        setPageError(null);
        setPageSuccess("Opened in preview mode. Pipeline saving is unavailable until the database migration is run.");
        await loadContactsForLocation(previewLocation);
        return;
      }

      setPageError(message);
    }
  }

  async function loadContactsForLocation(locationArg?: SavedLocation) {
    const location = locationArg || currentLocation;
    if (!location) return;

    setLoadingLocationId(location.id);
    setPageError(null);

    try {
      const response = await fetch("/api/leads/by-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: locationToProspectCompany(location),
          filters: {
            ...filters,
            industryQuery: query || location.companyName
          },
          searchQuery: query || location.companyName,
          locationId: isPreviewLocationId(location.id) ? undefined : location.id
        })
      });

      const data = (await response.json()) as {
        leads?: LeadRecord[];
        error?: string;
      };

      if (!response.ok || !data.leads) {
        throw new Error(data.error || "Failed to load contacts.");
      }

      setLocationDetail((current) =>
        current && current.location.id === location.id
          ? { ...current, contacts: data.leads ?? [] }
          : {
              location,
              contacts: data.leads ?? [],
              emails: currentLocationEmails
            }
      );

      await Promise.all([loadLocations(), loadDashboard()]);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to load contacts.");
    } finally {
      setLoadingLocationId(null);
    }
  }

  async function runSearch() {
    setPageError(null);
    setPageSuccess(null);

    startSearchTransition(async () => {
      try {
        const response = await fetch("/api/companies/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...filters, industryQuery: query })
        });

        const data = (await response.json()) as CompanySearchResponse & { error?: string };
        if (!response.ok) {
          throw new Error(data.error || "Search failed.");
        }

        setHasSearched(true);
        setCompanies(data.companies);
        setCreditEstimate(data.creditEstimate);
        setActivePage("contacts");
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Search failed.");
      }
    });
  }

  async function runBulkImport() {
    const lines = bulkInput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      setPageError("Paste at least one company, domain, or market query for bulk import.");
      return;
    }

    setQuery(lines[0] || query);
    await runSearchWithQuery(lines[0] || query, Math.min(Math.max(lines.length, 10), 20));
  }

  async function runSearchWithQuery(nextQuery: string, nextLimit?: number) {
    setPageError(null);
    setPageSuccess(null);

    const payload = {
      ...filters,
      industryQuery: nextQuery,
      limit: nextLimit ?? filters.limit
    };

    startSearchTransition(async () => {
      try {
        const response = await fetch("/api/companies/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const data = (await response.json()) as CompanySearchResponse & { error?: string };
        if (!response.ok) {
          throw new Error(data.error || "Search failed.");
        }

        setHasSearched(true);
        setQuery(nextQuery);
        setCompanies(data.companies);
        setCreditEstimate(data.creditEstimate);
        setFilters((current) => ({ ...current, limit: payload.limit }));
        setActivePage("contacts");
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Search failed.");
      }
    });
  }

  function replaceLeadRecord(nextRecord: LeadRecord) {
    setLocationDetail((current) => {
      if (!current) return current;
      return {
        ...current,
        contacts: current.contacts.map((record) =>
          record.lead.id === nextRecord.lead.id ? nextRecord : record
        )
      };
    });
  }

  function getEmailDisplay(record: LeadRecord): string {
    if (record.lead.email) return record.lead.email;

    const lookupState = emailLookupStateByLeadId[record.lead.id] || "idle";
    if (lookupState === "looking") return "Looking up...";
    if (lookupState === "not_found") return "No email found";
    return "Not looked up yet";
  }

  async function ensureLeadEmail(record: LeadRecord): Promise<LeadRecord | null> {
    if (record.lead.email) {
      setEmailLookupStateByLeadId((current) => ({ ...current, [record.lead.id]: "found" }));
      setEmailSourceByLeadId((current) =>
        current[record.lead.id] ? current : { ...current, [record.lead.id]: "existing" }
      );
      return record;
    }

    setEmailLookupLeadId(record.lead.id);
    setEmailLookupStateByLeadId((current) => ({ ...current, [record.lead.id]: "looking" }));

    try {
      const response = await fetch("/api/leads/enrich-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadRecord: record })
      });

      const data = (await response.json()) as EnrichEmailResponse;
      if (!response.ok || !data.leadRecord) {
        throw new Error(data.error || "Email lookup failed.");
      }

      replaceLeadRecord(data.leadRecord);

      if (!data.emailFound) {
        const note = data.providerNotes?.[0];
        const status = data.emailStatus ? ` Apollo marked the email status as ${data.emailStatus}.` : "";
        setEmailLookupStateByLeadId((current) => ({ ...current, [record.lead.id]: "not_found" }));
        setPageError(
          note
            ? `No email found for ${record.lead.name} yet. ${note}${status}`
            : `No email found for ${record.lead.name} yet.${status}`
        );
        return data.leadRecord;
      }

      setEmailLookupStateByLeadId((current) => ({ ...current, [record.lead.id]: "found" }));
      setEmailSourceByLeadId((current) => ({ ...current, [record.lead.id]: data.source }));
      return data.leadRecord;
    } catch (error) {
      setEmailLookupStateByLeadId((current) => ({ ...current, [record.lead.id]: "not_found" }));
      setPageError(error instanceof Error ? error.message : "Email lookup failed.");
      return null;
    } finally {
      setEmailLookupLeadId(null);
    }
  }

  async function fetchPitch(
    record: LeadRecord,
    talkingPointsOverride?: string,
    step: 1 | 2 | 3 = 1,
    forceRefresh = false
  ): Promise<GeneratedPitch> {
    const response = await fetch("/api/pitch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadRecord: record, talkingPointsOverride, step, forceRefresh })
    });

    const data = (await response.json()) as { pitch?: GeneratedPitch; error?: string };
    if (!response.ok || !data.pitch) {
      throw new Error(data.error || "Pitch generation failed.");
    }

    return data.pitch;
  }

  async function generateFollowUps(record: LeadRecord, talkingPoints: string) {
    try {
      const [fu1, fu2] = await Promise.all([
        fetchPitch(record, talkingPoints, 2),
        fetchPitch(record, talkingPoints, 3)
      ]);

      const next = {
        followUp1: { subject: fu1.subject, body: fu1.body },
        followUp2: { subject: fu2.subject, body: fu2.body }
      };

      setResearchByLeadId((current) => {
        const existing = current[record.lead.id];
        if (!existing) return current;
        return {
          ...current,
          [record.lead.id]: {
            ...existing,
            sequenceStatus: "ready",
            sequenceError: undefined,
            ...next
          }
        };
      });

      return next;
    } catch (error) {
      setResearchByLeadId((current) => {
        const existing = current[record.lead.id];
        if (!existing) return current;
        return {
          ...current,
          [record.lead.id]: {
            ...existing,
            sequenceStatus: "error",
            sequenceError: error instanceof Error ? error.message : "Follow-up draft generation failed."
          }
        };
      });
      return null;
    }
  }

  async function ensureLeadResearch(record: LeadRecord): Promise<ResearchState | null> {
    const existingResearch = researchByLeadId[record.lead.id];
    if (existingResearch && !isLowSignalPitch(existingResearch.pitch)) {
      return existingResearch;
    }

    try {
      const pitch = await fetchPitch(record, undefined, 1, Boolean(existingResearch));
      const nextResearch: ResearchState = {
        status: "researched",
        pitch,
        talkingPoints: pitch.talkingPoints,
        sequenceStatus: "generating",
        sequenceError: undefined,
        followUp1: undefined,
        followUp2: undefined,
        researchedAt: new Date().toISOString()
      };

      setResearchByLeadId((current) => ({
        ...current,
        [record.lead.id]: nextResearch
      }));
      setExpandedLeadId(record.lead.id);
      void generateFollowUps(record, pitch.talkingPoints);
      return nextResearch;
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Pitch generation failed.");
      return null;
    }
  }

  async function researchLead(record: LeadRecord, talkingPointsOverride?: string) {
    setPageError(null);
    setPageSuccess(null);

    startPitchTransition(async () => {
      try {
        const existingResearch = researchByLeadId[record.lead.id];
        const forceRefresh = Boolean(existingResearch && isLowSignalPitch(existingResearch.pitch));
        const pitch = await fetchPitch(record, talkingPointsOverride, 1, forceRefresh);

        setResearchByLeadId((current) => ({
          ...current,
          [record.lead.id]: {
            status: "researched",
            pitch,
            talkingPoints: pitch.talkingPoints,
            sequenceStatus: "generating",
            sequenceError: undefined,
            followUp1: undefined,
            followUp2: undefined,
            researchedAt: new Date().toISOString()
          }
        }));
        setExpandedLeadId(record.lead.id);
        void generateFollowUps(record, pitch.talkingPoints);
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Pitch generation failed.");
      }
    });
  }

  async function researchAllLeads() {
    if (isBulkResearching || currentContacts.length === 0) return;

    const unresearched = currentContacts.filter((record) => {
      const existingResearch = researchByLeadId[record.lead.id];
      return !existingResearch || isLowSignalPitch(existingResearch.pitch);
    });

    if (unresearched.length === 0) return;

    setIsBulkResearching(true);
    setBulkResearchProgress({ total: unresearched.length, completed: 0, active: true });
    setPageError(null);

    for (const record of unresearched) {
      try {
        const existingResearch = researchByLeadId[record.lead.id];
        const forceRefresh = Boolean(existingResearch && isLowSignalPitch(existingResearch.pitch));
        const pitch = await fetchPitch(record, undefined, 1, forceRefresh);

        setResearchByLeadId((current) => ({
          ...current,
          [record.lead.id]: {
            status: "researched",
            pitch,
            talkingPoints: pitch.talkingPoints,
            sequenceStatus: "generating",
            sequenceError: undefined,
            followUp1: undefined,
            followUp2: undefined,
            researchedAt: new Date().toISOString()
          }
        }));
        void generateFollowUps(record, pitch.talkingPoints);
      } catch {
        // Keep going so one miss does not block the rest.
      }

      setBulkResearchProgress((prev) =>
        prev ? { ...prev, completed: prev.completed + 1 } : null
      );
    }

    setBulkResearchProgress((prev) => (prev ? { ...prev, active: false } : null));
    setIsBulkResearching(false);
  }

  async function queueLeadSequence(record: LeadRecord) {
    const location = currentLocation;
    if (!location) return;
    if (isPreviewLocation) {
      setPageError("This company is open in preview mode. Run the database migration first to queue email sequences.");
      return;
    }

    setPageError(null);
    setPageSuccess(null);

    startDraftTransition(async () => {
      try {
        let draftRecord = record;
        if (!draftRecord.lead.email) {
          const enrichedRecord = await ensureLeadEmail(draftRecord);
          if (!enrichedRecord?.lead.email) {
            throw new Error("We still don't have an email for this contact, so the sequence can't be queued yet.");
          }
          draftRecord = enrichedRecord;
        }

        const research = await ensureLeadResearch(draftRecord);
        if (!research) {
          throw new Error("Research is required before queuing the sequence.");
        }

        let followUp1 = research.followUp1;
        let followUp2 = research.followUp2;

        if (!followUp1 || !followUp2) {
          const generated = await generateFollowUps(draftRecord, research.talkingPoints);
          followUp1 = generated?.followUp1;
          followUp2 = generated?.followUp2;
        }

        const sequence = [
          {
            locationId: location.id,
            contactName: draftRecord.lead.name,
            contactEmail: draftRecord.lead.email,
            contactTitle: draftRecord.lead.title,
            companyName: draftRecord.lead.companyName,
            locationType: location.locationType,
            sequenceStep: 1,
            subject: research.pitch.subject,
            body: research.pitch.body,
            status: "generated" as const
          }
        ];

        if (followUp1) {
          sequence.push({
            locationId: location.id,
            contactName: draftRecord.lead.name,
            contactEmail: draftRecord.lead.email,
            contactTitle: draftRecord.lead.title,
            companyName: draftRecord.lead.companyName,
            locationType: location.locationType,
            sequenceStep: 2,
            subject: followUp1.subject,
            body: followUp1.body,
            status: "generated" as const
          });
        }

        if (followUp2) {
          sequence.push({
            locationId: location.id,
            contactName: draftRecord.lead.name,
            contactEmail: draftRecord.lead.email,
            contactTitle: draftRecord.lead.title,
            companyName: draftRecord.lead.companyName,
            locationType: location.locationType,
            sequenceStep: 3,
            subject: followUp2.subject,
            body: followUp2.body,
            status: "generated" as const
          });
        }

        const response = await fetch("/api/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId: draftRecord.lead.id,
            emails: sequence
          })
        });

        const data = (await response.json()) as { emails?: StoredEmail[]; error?: string };
        if (!response.ok || !data.emails) {
          throw new Error(data.error || "Failed to save sequence.");
        }

        await Promise.all([loadEmails(), loadDashboard(), openLocation(location.id)]);
        setSelectedEmailId(data.emails[0]?.id ?? null);
        setActivePage("emails");
        setPageSuccess(`3-step outreach sequence queued for ${draftRecord.lead.name}.`);
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Failed to queue sequence.");
      }
    });
  }

  async function saveLocationNotes() {
    if (!currentLocation) return;
    if (isPreviewLocation) {
      setPageError("Preview mode is read-only. Run the database migration first to save notes.");
      return;
    }

    startSaveTransition(async () => {
      try {
        const response = await fetch(`/api/locations/${currentLocation.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: notesDraft })
        });

        const data = (await response.json()) as { location?: SavedLocation; error?: string };
        if (!response.ok || !data.location) {
          throw new Error(data.error || "Failed to save notes.");
        }

        await Promise.all([openLocation(currentLocation.id), loadLocations(), loadDashboard()]);
        setPageSuccess("Notes saved.");
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Failed to save notes.");
      }
    });
  }

  async function updateCurrentLocationField(
    field: "pipelineStage" | "locationType" | "pitchType",
    value: PipelineStage | LocationType | PitchType
  ) {
    if (!currentLocation) return;
    if (isPreviewLocation) {
      setPageError("Preview mode is read-only. Run the database migration first to update pipeline fields.");
      return;
    }

    try {
      const response = await fetch(`/api/locations/${currentLocation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value })
      });

      const data = (await response.json()) as { location?: SavedLocation; error?: string };
      if (!response.ok || !data.location) {
        throw new Error(data.error || "Failed to update location.");
      }

      await Promise.all([openLocation(currentLocation.id), loadLocations(), loadDashboard()]);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to update location.");
    }
  }

  async function deleteLocation(locationId: string) {
    if (isPreviewLocationId(locationId)) {
      setSelectedLocationId(null);
      setLocationDetail(null);
      setExpandedLeadId(null);
      setPageSuccess("Closed preview.");
      return;
    }

    try {
      const response = await fetch(`/api/locations/${locationId}`, {
        method: "DELETE"
      });

      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Failed to delete location.");
      }

      if (selectedLocationId === locationId) {
        setSelectedLocationId(null);
        setLocationDetail(null);
        setExpandedLeadId(null);
      }

      await Promise.all([loadLocations(), loadDashboard(), loadEmails()]);
      setPageSuccess("Location removed from the pipeline.");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to delete location.");
    }
  }

  async function saveSelectedEmail() {
    if (!selectedEmail) return;

    setPageError(null);
    setPageSuccess(null);

    startSaveTransition(async () => {
      try {
        const response = await fetch(`/api/emails/${selectedEmail.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(emailEditor)
        });

        const data = (await response.json()) as { email?: StoredEmail; error?: string };
        if (!response.ok || !data.email) {
          throw new Error(data.error || "Failed to save email.");
        }

        await Promise.all([loadEmails(), currentLocation ? openLocation(currentLocation.id) : Promise.resolve()]);
        setPageSuccess("Email updated.");
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Failed to save email.");
      }
    });
  }

  async function createGmailDraftForSelectedEmail() {
    if (!selectedEmail) return;
    if (!selectedEmail.contactEmail) {
      setPageError("This sequence does not have a contact email yet, so Gmail draft creation is unavailable.");
      return;
    }

    setPageError(null);
    setPageSuccess(null);

    startDraftTransition(async () => {
      try {
        const response = await fetch("/api/gmail/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: selectedEmail.contactEmail,
            subject: emailEditor.subject,
            body: emailEditor.body
          })
        });

        const data = (await response.json()) as { gmailUrl?: string; error?: string };
        if (!response.ok) {
          throw new Error(data.error || "Failed to create Gmail draft.");
        }

        const patchResponse = await fetch(`/api/emails/${selectedEmail.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: emailEditor.subject,
            body: emailEditor.body,
            status: "approved",
            gmailDraftUrl: data.gmailUrl || "https://mail.google.com/mail/u/0/#drafts"
          })
        });

        const patchData = (await patchResponse.json()) as { email?: StoredEmail; error?: string };
        if (!patchResponse.ok || !patchData.email) {
          throw new Error(patchData.error || "Failed to update email after draft creation.");
        }

        await Promise.all([loadEmails(), refreshGmailStatus(), currentLocation ? openLocation(currentLocation.id) : Promise.resolve()]);
        setPageSuccess("Draft created in Gmail.");
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Failed to create Gmail draft.");
      }
    });
  }

  async function saveToneSettings() {
    setPageError(null);
    setPageSuccess(null);

    startSaveTransition(async () => {
      try {
        const response = await fetch("/api/tone", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toneSettings)
        });

        const data = (await response.json()) as { tone?: ToneSettings; error?: string };
        if (!response.ok || !data.tone) {
          throw new Error(data.error || "Failed to save tone settings.");
        }

        setToneSettings(data.tone);
        setPageSuccess("Tone settings saved. New research runs will use this voice.");
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Failed to save tone settings.");
      }
    });
  }

  function updateTalkingPoints(leadId: string, value: string) {
    setResearchByLeadId((current) => {
      const research = current[leadId];
      if (!research) return current;
      return {
        ...current,
        [leadId]: {
          ...research,
          talkingPoints: value
        }
      };
    });
  }

  function downloadCSV(filename: string, rows: Array<Array<string | number>>) {
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportEmailsCSV() {
    const rows = [
      ["Company", "Contact", "Email", "Title", "Step", "Status", "Subject", "Body"],
      ...filteredEmails(emails, emailFilter, emailSearch).map((email) => [
        email.companyName || "",
        email.contactName || "",
        email.contactEmail || "",
        email.contactTitle || "",
        email.sequenceStep,
        email.status,
        email.subject,
        email.body
      ])
    ];

    downloadCSV("ff_emails.csv", rows);
  }

  function exportEmailContactsCSV() {
    const seen = new Set<string>();
    const rows: Array<Array<string | number>> = [["Company", "Contact", "Email", "Title"]];

    for (const email of filteredEmails(emails, emailFilter, emailSearch)) {
      const key = `${email.companyName}-${email.contactEmail}`;
      if (!email.contactEmail || seen.has(key)) continue;
      seen.add(key);
      rows.push([
        email.companyName || "",
        email.contactName || "",
        email.contactEmail || "",
        email.contactTitle || ""
      ]);
    }

    downloadCSV("ff_email_contacts.csv", rows);
  }

  function renderFeedback() {
    return (
      <>
        {pageError ? <p className="error">{pageError}</p> : null}
        {pageSuccess ? <p className="success">{pageSuccess}</p> : null}
      </>
    );
  }

  function resetContactFilters() {
    setContactSearch("");
    setDepartmentFilter("all");
  }

  function renderDashboardPage() {
    const stageRows = (Object.keys(PIPELINE_STAGE_LABELS) as PipelineStage[]).map((stage) => ({
      label: PIPELINE_STAGE_LABELS[stage],
      value: dashboardStats.pipelineByStage[stage]
    }));

    const locationTypeRows = (Object.keys(LOCATION_TYPE_LABELS) as LocationType[]).map((type) => ({
      label: LOCATION_TYPE_LABELS[type],
      value: dashboardStats.byLocationType[type]
    }));

    return (
      <>
        <header className="pageHeader">
          <div>
            <h1>Dashboard</h1>
            <p>Farmers Fridge placement pipeline overview, from saved locations to drafted outreach.</p>
          </div>
          <div className="inlineActions">
            <button className="primaryButton" type="button" onClick={() => setActivePage("contacts")}>
              <Search size={16} />
              Find Contacts
            </button>
          </div>
        </header>

        {renderFeedback()}

        <section className="dashboardGrid">
          <article className="statCard">
            <span>Locations</span>
            <strong>{dashboardStats.locationsCount}</strong>
          </article>
          <article className="statCard">
            <span>Emails</span>
            <strong>{dashboardStats.draftsCount}</strong>
          </article>
          <article className="statCard">
            <span>Won</span>
            <strong>{dashboardStats.wonCount}</strong>
          </article>
          <article className="statCard">
            <span>Meetings</span>
            <strong>{dashboardStats.pipelineByStage.meeting}</strong>
          </article>
        </section>

        <section className="dashboardPanels">
          <article className="dashboardPanel">
            <h2>Pipeline</h2>
            <div className="summaryList">
              {stageRows.map((row) => (
                <div key={row.label} className="summaryRow">
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
          </article>

          <article className="dashboardPanel">
            <h2>By Location Type</h2>
            <div className="summaryList">
              {locationTypeRows.map((row) => (
                <div key={row.label} className="summaryRow">
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="resultsPanel sectionCard">
          <div className="sectionHeader">
            <div>
              <h2>Recent Locations</h2>
              <p>Quickly jump back into the places already in your pipeline.</p>
            </div>
          </div>

          {recentLocations.length > 0 ? (
            <div className="locationGrid">
              {recentLocations.map((location) => (
                <article key={location.id} className="locationCard">
                  <div className="locationCardBody">
                    <div className="locationCardTop">
                      <div>
                        <h3>{location.companyName}</h3>
                        <p>{location.companyDomain || "No domain found"}</p>
                      </div>
                      <span className="statusPill">{PIPELINE_STAGE_LABELS[location.pipelineStage]}</span>
                    </div>
                    <div className="locationMeta">
                      <span>{LOCATION_TYPE_LABELS[location.locationType]}</span>
                      {location.hqCity || location.hqState ? <span>{formatCompanyMeta(location)}</span> : null}
                    </div>
                    <div className="locationCounts">
                      <span>{location.contactsCount} contacts</span>
                      <span>{location.emailsCount} emails</span>
                    </div>
                  </div>
                  <button className="iconButton" type="button" onClick={() => void openLocation(location.id)}>
                    <ArrowRight size={16} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="emptyStateTable">
              <Building2 size={34} />
              <p>No saved locations yet. Start in Find Contacts and add your first target.</p>
            </div>
          )}
        </section>
      </>
    );
  }

  function renderContactsHome() {
    return (
      <>
        <header className="pageHeader">
          <div>
            <h1>Find Contacts</h1>
            <p>Search by domain, company name, or a target market, then save the best-fit locations into the Farmers Fridge pipeline.</p>
          </div>
          <div className="pagePills">
            <button
              className={`topPill ${searchMode === "search" ? "active" : ""}`}
              type="button"
              onClick={() => setSearchMode("search")}
            >
              Search
            </button>
            <button
              className={`topPill ${searchMode === "bulk" ? "active" : ""}`}
              type="button"
              onClick={() => setSearchMode("bulk")}
            >
              Bulk Import
            </button>
          </div>
        </header>

        {renderFeedback()}

        <section className="searchComposer">
          {searchMode === "search" ? (
            <>
              <div className="searchBox">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Enter domain (stripe.com) or target market (e.g. hospitals in Chicago)"
                />
                <button className="primaryButton" type="button" onClick={() => void runSearch()} disabled={searchPending}>
                  <Search size={16} />
                  {searchPending ? "Searching..." : "Search"}
                </button>
              </div>
              <p className="helperText">
                Search company-first, then save the best target into your pipeline and load the right contacts inside it.
              </p>
            </>
          ) : (
            <>
              <div className="bulkBox">
                <textarea
                  value={bulkInput}
                  onChange={(event) => setBulkInput(event.target.value)}
                  placeholder={"Paste one company or market query per line\nNorthwestern Medicine\nJLL Chicago\nO'Hare airport vendors"}
                />
                <button className="primaryButton" type="button" onClick={() => void runBulkImport()} disabled={searchPending}>
                  <Upload size={16} />
                  {searchPending ? "Importing..." : "Import & Search"}
                </button>
              </div>
              <p className="helperText">
                Use bulk import to quickly seed a region, employer list, or account plan.
              </p>
            </>
          )}
        </section>

        <section className="filterBar">
          <div className="filterBarRow">
            <div className="filterField filterField--role">
              <label>Target Role</label>
              <div className="multiCheck">
                {Object.entries(PERSONA_LABELS).map(([value, label]) => {
                  const personaValue = value as SearchFilters["personas"][number];
                  return (
                    <label key={value} className="checkOption">
                      <input
                        type="checkbox"
                        checked={filters.personas.includes(personaValue)}
                        onChange={(event) => {
                          setFilters((current) => {
                            const nextPersonas = event.target.checked
                              ? [...new Set([...current.personas, personaValue])]
                              : current.personas.filter((item) => item !== personaValue);
                            return {
                              ...current,
                              personas: nextPersonas.length > 0 ? nextPersonas : ["office_manager"]
                            };
                          });
                        }}
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            {filters.personas.includes("custom") ? (
              <div className="filterField wide">
                <label>Custom Job Title</label>
                <input
                  type="text"
                  value={filters.customPersona || ""}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, customPersona: event.target.value }))
                  }
                  placeholder="Director of Workplace Experience"
                />
              </div>
            ) : null}
          </div>

          <div className="filterBarRow">
            <div className="filterField">
              <label>Company Limit</label>
              <input
                type="text"
                inputMode="numeric"
                value={limitInput}
                onChange={(event) => setLimitInput(event.target.value.replace(/[^\d]/g, ""))}
                onBlur={() => {
                  const parsed = Number(limitInput);
                  const nextLimit = Number.isFinite(parsed)
                    ? Math.max(1, Math.min(50, parsed))
                    : filters.limit;
                  setFilters((current) => ({ ...current, limit: nextLimit }));
                  setLimitInput(String(nextLimit));
                }}
              />
            </div>
            <div className="filterField">
              <label>Minimum Employees</label>
              <input
                type="number"
                min={50}
                value={filters.employeeMin}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, employeeMin: Number(event.target.value) || 50 }))
                }
              />
            </div>
            <div className="filterField statesField">
              <label>States</label>
              <div className="statesControls">
                <div className="statesActions">
                  <button className="statesBtn" type="button" onClick={() => setFilters((c) => ({ ...c, states: [...US_STATES] }))}>
                    All
                  </button>
                  <button className="statesBtn" type="button" onClick={() => setFilters((c) => ({ ...c, states: [] }))}>
                    Clear
                  </button>
                </div>
                <select
                  multiple
                  className="statesSelect"
                  value={filters.states}
                  onChange={(event) => {
                    const selected = [...event.target.selectedOptions].map((option) => option.value);
                    setFilters((current) => ({ ...current, states: selected }));
                  }}
                >
                  {US_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        {creditEstimate ? (
          <section className="creditBanner">
            <strong>Estimated Apollo flow: {creditEstimate.totalEstimatedOperations} operations</strong>
            <span>{creditEstimate.note}</span>
          </section>
        ) : null}

        {companies.length > 0 ? (
          <section className="resultsPanel sectionCard">
            <div className="sectionHeader">
              <div>
                <h2>Search Results</h2>
                <p>{companies.length} company matches from Apollo.</p>
              </div>
            </div>
            <div className="locationGrid">
              {companies.map((company) => (
                <article key={company.id} className="locationCard">
                  <div className="locationCardBody">
                    <div className="locationCardTop">
                      <div>
                        <h3>{company.name}</h3>
                        <p>{company.domain || "No domain found"}</p>
                      </div>
                      <span className="confidencePill">
                        {company.company.deliveryZone !== "Other" ? "Zone Match" : "General Fit"}
                      </span>
                    </div>
                    <div className="locationMeta">
                      <span>{company.company.industry || "Industry unavailable"}</span>
                      <span>{formatCompanyMeta(company.company) || "Location unavailable"}</span>
                    </div>
                    <div className="cardActionRow">
                      <button className="secondaryButton" type="button" onClick={() => void handleSaveCompanyToPipeline(company)}>
                        Save to Pipeline
                      </button>
                      <button className="primaryButton" type="button" onClick={() => void handleOpenCompany(company)}>
                        <Search size={15} />
                        Open
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : hasSearched ? (
          <section className="resultsPanel">
            <div className="emptyStateTable">
              <Building2 size={34} />
              <p>No companies came back for "{query}". Try a broader market, location, or company name.</p>
            </div>
          </section>
        ) : null}

        <section className="resultsPanel sectionCard">
          <div className="sectionHeader sectionHeader--filters">
            <div>
              <h2>Pipeline Locations</h2>
              <p>{visibleLocations.length} saved locations.</p>
            </div>
            <div className="sectionControls">
              <input
                className="compactInput"
                value={locationQuery}
                onChange={(event) => setLocationQuery(event.target.value)}
                placeholder="Filter locations..."
              />
              <select value={locationTypeFilter} onChange={(event) => setLocationTypeFilter(event.target.value as LocationType | "all")}>
                <option value="all">All Types</option>
                {(Object.keys(LOCATION_TYPE_LABELS) as LocationType[]).map((type) => (
                  <option key={type} value={type}>
                    {LOCATION_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              <select value={pipelineStageFilter} onChange={(event) => setPipelineStageFilter(event.target.value as PipelineStage | "all")}>
                <option value="all">All Stages</option>
                {(Object.keys(PIPELINE_STAGE_LABELS) as PipelineStage[]).map((stage) => (
                  <option key={stage} value={stage}>
                    {PIPELINE_STAGE_LABELS[stage]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {visibleLocations.length > 0 ? (
            <div className="locationGrid">
              {visibleLocations.map((location) => (
                <article key={location.id} className="locationCard">
                  <div className="locationCardBody">
                    <div className="locationCardTop">
                      <div>
                        <h3>{location.companyName}</h3>
                        <p>{location.companyDomain || "No domain found"}</p>
                      </div>
                      <button className="iconButton" type="button" onClick={() => void deleteLocation(location.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="locationMeta">
                      <span>{LOCATION_TYPE_LABELS[location.locationType]}</span>
                      {formatCompanyMeta(location) ? <span>{formatCompanyMeta(location)}</span> : null}
                    </div>
                    <div className="locationCounts">
                      <span>{location.contactsCount} contacts</span>
                      <span>{location.emailsCount} emails</span>
                    </div>
                    <div className="cardActionRow">
                      <span className="statusPill">{PIPELINE_STAGE_LABELS[location.pipelineStage]}</span>
                      <button className="iconButton" type="button" onClick={() => void openLocation(location.id)} disabled={loadingLocationId === location.id}>
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="emptyStateTable">
              <Building2 size={34} />
              <p>No pipeline locations match the current filters.</p>
            </div>
          )}
        </section>
      </>
    );
  }

  function renderLocationDetail() {
    if (!currentLocation) {
      return renderContactsHome();
    }

    return (
      <>
        <header className="pageHeader">
          <div>
            <button className="backLink" type="button" onClick={() => {
              setSelectedLocationId(null);
              setLocationDetail(null);
              setExpandedLeadId(null);
            }}>
              <ArrowLeft size={16} />
              Back to Locations
            </button>
            <h1>{currentLocation.companyName}</h1>
            <p>
              {currentLocation.companyDomain || "No domain"} · {formatCompanyMeta(currentLocation) || "Location unavailable"}
            </p>
          </div>
        </header>

        {renderFeedback()}

        <section className="detailToolbarCard">
          <div className="detailToolbar">
            <div className="detailSelect">
              <label>Pipeline</label>
              <select
                value={currentLocation.pipelineStage}
                disabled={isPreviewLocation}
                onChange={(event) => void updateCurrentLocationField("pipelineStage", event.target.value as PipelineStage)}
              >
                {(Object.keys(PIPELINE_STAGE_LABELS) as PipelineStage[]).map((stage) => (
                  <option key={stage} value={stage}>
                    {PIPELINE_STAGE_LABELS[stage]}
                  </option>
                ))}
              </select>
            </div>

            <div className="detailSelect">
              <label>Type</label>
              <select
                value={currentLocation.locationType}
                disabled={isPreviewLocation}
                onChange={(event) => void updateCurrentLocationField("locationType", event.target.value as LocationType)}
              >
                {(Object.keys(LOCATION_TYPE_LABELS) as LocationType[]).map((type) => (
                  <option key={type} value={type}>
                    {LOCATION_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>

            <span className="statusPill">{currentLocation.category || currentLocation.industry || "Target account"}</span>

            <div className="detailSelect detailSelect--pitch">
              <label>Pitch</label>
              <select
                value={currentLocation.pitchType}
                disabled={isPreviewLocation}
                onChange={(event) => void updateCurrentLocationField("pitchType", event.target.value as PitchType)}
              >
                {(Object.keys(PITCH_TYPE_LABELS) as PitchType[]).map((pitchType) => (
                  <option key={pitchType} value={pitchType}>
                    {PITCH_TYPE_LABELS[pitchType]}
                  </option>
                ))}
              </select>
            </div>

            <button className="primaryButton" type="button" onClick={() => void researchAllLeads()} disabled={pitchPending || currentContacts.length === 0}>
              <Sparkles size={16} />
              {isBulkResearching ? "Running..." : "Run FF Outreach AI"}
            </button>
          </div>
        </section>

        <section className="detailGrid">
          <article className="dashboardPanel">
            <h2>About</h2>
            <p>{currentLocation.about || "No background captured yet. Load contacts or update notes to build out the account brief."}</p>
            <div className="locationCounts locationCounts--detail">
              <span>{currentContacts.length} contacts loaded</span>
              <span>{currentLocationEmails.length} queued emails</span>
            </div>
            {isPreviewLocation ? (
              <p className="helperText">
                Preview mode is active because pipeline storage is not available yet. You can review contacts and run research, but notes, pipeline fields, and queued emails are disabled until the DB migration is run.
              </p>
            ) : null}
          </article>

          <article className="dashboardPanel">
            <h2>Notes & Insights</h2>
            <textarea
              className="detailNotes"
              value={notesDraft}
              onChange={(event) => setNotesDraft(event.target.value)}
              disabled={isPreviewLocation}
              placeholder="Capture account context, food access notes, stakeholder hints, and operational cues here..."
            />
            <div className="inlineActions">
              <button className="secondaryButton" type="button" onClick={() => setNotesDraft(currentLocation.notes || "")} disabled={isPreviewLocation}>
                Reset
              </button>
              <button className="primaryButton" type="button" onClick={() => void saveLocationNotes()} disabled={savePending || isPreviewLocation}>
                {savePending ? "Saving..." : "Save Notes"}
              </button>
            </div>
          </article>
        </section>

        <section className="resultsPanel sectionCard">
          <div className="sectionHeader sectionHeader--filters">
            <div>
              <h2>Contacts</h2>
              <p>
                {visibleContacts.length} visible of {currentContacts.length} loaded contacts at this location.
              </p>
            </div>
            <div className="sectionControls">
              <input
                className="compactInput"
                value={contactSearch}
                onChange={(event) => setContactSearch(event.target.value)}
                placeholder="Filter by name, email, title, or department..."
              />
              <button className="secondaryButton" type="button" onClick={() => void loadContactsForLocation()} disabled={loadingLocationId === currentLocation.id}>
                <RefreshCw size={15} />
                {loadingLocationId === currentLocation.id ? "Loading..." : currentContacts.length > 0 ? "Refresh Contacts" : "Find Contacts"}
              </button>
            </div>
          </div>

          <div className="departmentPills">
            <button
              className={`topPill ${departmentFilter === "all" ? "active" : ""}`}
              type="button"
              onClick={() => setDepartmentFilter("all")}
            >
              All ({currentContacts.length})
            </button>
            {(Object.keys(DEPARTMENT_FILTER_LABELS) as Array<Exclude<DepartmentFilter, "all">>).map((department) => (
              <button
                key={department}
                className={`topPill ${departmentFilter === department ? "active" : ""}`}
                type="button"
                onClick={() => setDepartmentFilter(department)}
              >
                {DEPARTMENT_FILTER_LABELS[department]} ({contactCountsByDepartment[department]})
              </button>
            ))}
          </div>

          {bulkResearchProgress ? (
            <div className="bulkProgressWrap bulkProgressWrap--detail">
              <div className="bulkProgressBar">
                <div
                  className="bulkProgressFill"
                  style={{ width: `${(bulkResearchProgress.completed / bulkResearchProgress.total) * 100}%` }}
                />
              </div>
              <span className="bulkProgressLabel">
                {bulkResearchProgress.completed}/{bulkResearchProgress.total}
                {bulkResearchProgress.active ? " — researching..." : " complete"}
              </span>
            </div>
          ) : null}

          {visibleContacts.length > 0 ? (
            <div className="tableWrap contactTable">
              <div className="tableHeader contactTableHeader">
                <span>Name</span>
                <span>Email</span>
                <span>Position</span>
                <span>Department</span>
                <span>Actions</span>
              </div>

              {visibleContacts.map((record) => {
                const research = researchByLeadId[record.lead.id];
                const isExpanded = expandedLeadId === record.lead.id;
                const isFindingEmail = emailLookupLeadId === record.lead.id;
                const hasQueuedEmails = currentLocationEmails.some((email) => email.leadId === record.lead.id);

                return (
                  <div key={record.lead.id} className="tableRowGroup">
                    <div className="tableRow contactTableRow">
                      <div className="cell primaryCell">
                        <div className="nameBlock">
                          <strong>{record.lead.name}</strong>
                          <span>{record.lead.companyName}</span>
                          {research?.researchedAt ? (
                            <span className="researchedBadge">
                              Researched {new Date(research.researchedAt).toLocaleDateString()}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="cell mono">
                        {getEmailDisplay(record)}
                        {record.lead.email && emailSourceByLeadId[record.lead.id] ? (
                          <span className={`sourceBadge sourceBadge--${emailSourceByLeadId[record.lead.id]}`}>
                            {emailSourceByLeadId[record.lead.id] === "apollo"
                              ? "via Apollo"
                              : emailSourceByLeadId[record.lead.id] === "tomba"
                                ? "via Tomba"
                                : "existing"}
                          </span>
                        ) : null}
                      </div>
                      <div className="cell">{record.lead.title}</div>
                      <div className="cell">
                        <span className="statusPill">
                          {record.lead.department ? DEPARTMENT_FILTER_LABELS[record.lead.department] : "Other"}
                        </span>
                      </div>
                      <div className="cell actionCell">
                        <button
                          className={`iconButton${research ? " iconButton--done" : ""}`}
                          type="button"
                          onClick={() => void researchLead(record, research?.talkingPoints)}
                          disabled={pitchPending}
                          title={research ? "Refresh research" : "Research contact"}
                        >
                          <Sparkles size={16} />
                        </button>
                        <button
                          className={`iconButton${hasQueuedEmails ? " iconButton--done" : ""}`}
                          type="button"
                          onClick={() => void queueLeadSequence(record)}
                          disabled={draftPending || isFindingEmail || isPreviewLocation}
                          title={hasQueuedEmails ? "Replace queued email sequence" : "Queue 3-email sequence"}
                        >
                          <Mail size={16} />
                        </button>
                        <button
                          className="iconButton"
                          type="button"
                          onClick={() => setExpandedLeadId(isExpanded ? null : record.lead.id)}
                          title={isExpanded ? "Hide details" : "Review details"}
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </div>
                    </div>

                    {isExpanded ? (
                      <div className="researchPanel">
                        {research ? (
                          <>
                            <div className="researchCol">
                              <h3>Summary</h3>
                              <p>{research.pitch.summary}</p>
                            </div>
                            <div className="researchCol">
                              <h3>Talking Points</h3>
                              <textarea
                                value={research.talkingPoints}
                                onChange={(event) => updateTalkingPoints(record.lead.id, event.target.value)}
                              />
                            </div>
                            <div className="researchCol">
                              <h3>Pain Points</h3>
                              <ul className="plainList">
                                {research.pitch.painPoints.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                              {research.sequenceStatus === "ready" && research.followUp1 && research.followUp2 ? (
                                <div className="sequenceReadyBadge">
                                  {isPreviewLocation ? "Follow-up drafts ready (preview only)" : "Follow-up drafts ready"}
                                </div>
                              ) : research.sequenceStatus === "error" ? (
                                <div className="sequenceErrorBadge">Follow-up drafts failed</div>
                              ) : (
                                <div className="sequenceLoadingBadge">Preparing follow-up copy...</div>
                              )}
                            </div>
                            <div className="researchFooter">
                              <div className="microMeta">
                                <span>Bridge insight: {research.pitch.bridgeInsight}</span>
                                <span>Specificity anchors: {research.pitch.variableEvidence.join(", ") || "None detected"}</span>
                                <span>Contact email: {getEmailDisplay(record)}</span>
                                <span>
                                  {isPreviewLocation
                                    ? "Preview mode: research can prepare follow-up copy, but emails cannot be saved yet."
                                    : "Research prepares the copy. Click Queue Sequence to save emails into the Emails page."}
                                </span>
                                {research.sequenceStatus === "error" && research.sequenceError ? (
                                  <span>Follow-up status: {research.sequenceError}</span>
                                ) : null}
                              </div>
                              <div className="inlineActions">
                                <button className="secondaryButton" type="button" onClick={() => void researchLead(record, research.talkingPoints)}>
                                  <RefreshCw size={16} />
                                  Regenerate
                                </button>
                                <button className="primaryButton" type="button" onClick={() => void queueLeadSequence(record)} disabled={isPreviewLocation}>
                                  <Mail size={16} />
                                  Queue Sequence
                                </button>
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="researchCol">
                              <h3>Profile</h3>
                              <p>{record.lead.name} is {record.lead.title} at {record.lead.companyName}.</p>
                            </div>
                            <div className="researchCol">
                              <h3>Contact Details</h3>
                              <ul className="plainList">
                                <li>Email: {getEmailDisplay(record)}</li>
                                <li>LinkedIn: {record.lead.linkedinUrl || "Not available yet"}</li>
                                <li>Domain: {record.lead.companyDomain || "Not available yet"}</li>
                              </ul>
                            </div>
                            <div className="researchCol">
                              <h3>Next Step</h3>
                              <p>Run Farmers Fridge research here, then queue the outreach sequence into the Emails page for review and Gmail drafting.</p>
                            </div>
                            <div className="researchFooter">
                              <div className="microMeta">
                                <span>Contact email: {getEmailDisplay(record)}</span>
                                <span>Department: {record.lead.department ? DEPARTMENT_FILTER_LABELS[record.lead.department] : "Other"}</span>
                                <span>Title: {record.lead.title}</span>
                              </div>
                              <div className="inlineActions">
                                <button className="secondaryButton" type="button" onClick={() => void researchLead(record)} disabled={pitchPending}>
                                  <Sparkles size={16} />
                                  {pitchPending ? "Researching..." : "Research Contact"}
                                </button>
                                <button className="primaryButton" type="button" onClick={() => void queueLeadSequence(record)} disabled={draftPending || isPreviewLocation}>
                                  <Mail size={16} />
                                  Queue Sequence
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : currentContacts.length > 0 ? (
            <div className="emptyStateTable">
              <Building2 size={34} />
              <p>
                No contacts match the current filters.
                {departmentFilter !== "all" ? ` ${DEPARTMENT_FILTER_LABELS[departmentFilter]} is selected.` : ""}
              </p>
              {hasActiveContactFilters ? (
                <button className="secondaryButton" type="button" onClick={resetContactFilters}>
                  Show All Contacts
                </button>
              ) : null}
            </div>
          ) : (
            <div className="emptyStateTable">
              <Building2 size={34} />
              <p>Load contacts for this location to review stakeholders and queue outreach.</p>
            </div>
          )}
        </section>
      </>
    );
  }

  function renderEmailsPage() {
    const visibleEmailRows = filteredEmails(emails, emailFilter, emailSearch);

    return (
      <>
        <header className="pageHeader">
          <div>
            <h1>Emails</h1>
            <p>{visibleEmailRows.length} of {emails.length} total emails queued for review, edits, and Gmail drafting.</p>
          </div>
          <div className="sectionControls">
            <select value={emailFilter} onChange={(event) => setEmailFilter(event.target.value as EmailFilter)}>
              <option value="all">all</option>
              <option value="generated">generated</option>
              <option value="approved">approved</option>
              <option value="sent">sent</option>
            </select>
            <button className="secondaryButton" type="button" onClick={exportEmailsCSV}>
              <Download size={15} />
              Export All
            </button>
            <button className="secondaryButton" type="button" onClick={exportEmailContactsCSV}>
              <Download size={15} />
              Export Contacts
            </button>
          </div>
        </header>

        {renderFeedback()}

        {visibleEmailRows.length > 0 ? (
          <section className="emailWorkbench">
            <div className="resultsPanel emailListPane">
              <div className="sectionHeader sectionHeader--filters">
                <div>
                  <h2>Queue</h2>
                  <p>Generated, approved, and sent sequences.</p>
                </div>
                <input
                  className="compactInput"
                  value={emailSearch}
                  onChange={(event) => setEmailSearch(event.target.value)}
                  placeholder="Filter emails..."
                />
              </div>
              <div className="emailList">
                {visibleEmailRows.map((email) => (
                  <button
                    key={email.id}
                    className={`emailRowCard ${selectedEmail?.id === email.id ? "active" : ""}`}
                    type="button"
                    onClick={() => setSelectedEmailId(email.id)}
                  >
                    <div className="emailRowTop">
                      <strong>{email.subject}</strong>
                      <span className={getStatusClass(email.status)}>
                        {EMAIL_STATUS_LABELS[email.status]}
                      </span>
                    </div>
                    <div className="emailRowMeta">
                      <span>{email.contactName || "Unknown contact"}</span>
                      <span>{email.contactEmail || "No email found"}</span>
                    </div>
                    <div className="emailRowMeta">
                      <span>{email.companyName || "No company"}</span>
                      <span>Step {email.sequenceStep}</span>
                    </div>
                    <p>{email.body.slice(0, 180)}{email.body.length > 180 ? "..." : ""}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="draftEditor emailEditorPane">
              {selectedEmail ? (
                <>
                  <div className="draftHeader">
                    <div>
                      <h2>{selectedEmail.companyName || "Draft Email"}</h2>
                      <p>
                        To: {selectedEmail.contactName || "Unknown"}{" "}
                        <span className="mono">{selectedEmail.contactEmail || "No email found"}</span>
                      </p>
                    </div>
                    <div className="draftHeaderActions">
                      <span className={getStatusClass(emailEditor.status)}>
                        {EMAIL_STATUS_LABELS[emailEditor.status]}
                      </span>
                    </div>
                  </div>

                  <div className="draftField">
                    <label>Subject</label>
                    <input
                      value={emailEditor.subject}
                      onChange={(event) =>
                        setEmailEditor((current) => ({ ...current, subject: event.target.value }))
                      }
                    />
                  </div>

                  <div className="draftField">
                    <label>Body</label>
                    <textarea
                      value={emailEditor.body}
                      onChange={(event) =>
                        setEmailEditor((current) => ({ ...current, body: event.target.value }))
                      }
                    />
                  </div>

                  <div className="draftField">
                    <label>Status</label>
                    <select
                      value={emailEditor.status}
                      onChange={(event) =>
                        setEmailEditor((current) => ({
                          ...current,
                          status: event.target.value as Exclude<EmailFilter, "all">
                        }))
                      }
                    >
                      <option value="generated">Generated</option>
                      <option value="approved">Approved</option>
                      <option value="sent">Sent</option>
                    </select>
                  </div>

                  <div className="draftFooter">
                    {!selectedEmail.contactEmail ? (
                      <p className="error">
                        No email found yet for this contact. You can still edit the copy here, but Gmail draft creation is disabled until an address is found.
                      </p>
                    ) : null}
                    <div className="inlineActions">
                      <button className="secondaryButton" type="button" onClick={() => navigator.clipboard.writeText(emailEditor.body)}>
                        <Copy size={16} />
                        Copy
                      </button>
                      <button className="secondaryButton" type="button" onClick={() => void saveSelectedEmail()} disabled={savePending}>
                        {savePending ? "Saving..." : "Save"}
                      </button>
                      <button className="primaryButton" type="button" onClick={() => void createGmailDraftForSelectedEmail()} disabled={draftPending || !selectedEmail.contactEmail}>
                        <Send size={16} />
                        {draftPending ? "Creating..." : "Create Gmail Draft"}
                      </button>
                    </div>
                  </div>

                  <section className="gmailCard">
                    <strong>Gmail connection</strong>
                    <p>
                      {gmailStatus?.connected
                        ? "Gmail is connected with compose access."
                        : "Connect Gmail before creating drafts. Each teammate can authorize their own mailbox from this same app."}
                    </p>
                    <div className="inlineActions">
                      <a className="secondaryLink" href="/signin">
                        {gmailStatus?.connected ? "Reauthorize Gmail" : "Connect Gmail"}
                      </a>
                      <a className="secondaryLink" href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noreferrer">
                        Open Gmail Drafts <ArrowUpRight size={14} />
                      </a>
                    </div>
                  </section>
                </>
              ) : (
                <div className="emptyStateTable">
                  <Mail size={34} />
                  <p>No emails match the current filter.</p>
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="resultsPanel">
            <div className="emptyStateTable">
              <Mail size={34} />
              <p>No emails yet. Queue a sequence from a location detail view to populate this page.</p>
            </div>
          </section>
        )}
      </>
    );
  }

  function renderTonePage() {
    return (
      <>
        <header className="pageHeader">
          <div>
            <h1>Tone of Voice</h1>
            <p>Set the Farmers Fridge outbound style you want the AI to follow for future research and sequence generation.</p>
          </div>
        </header>

        {renderFeedback()}

        <section className="toneGrid">
          <article className="dashboardPanel">
            <h2>How This Works</h2>
            <p>These settings feed directly into the outreach prompt. Keep the guidance concrete so the copy stays consistent across new account research runs.</p>
            <div className="summaryList">
              <div className="summaryRow">
                <span>Best for</span>
                <strong>Voice direction, phrasing examples, and red lines</strong>
              </div>
              <div className="summaryRow">
                <span>Applied to</span>
                <strong>Initial emails plus follow-ups</strong>
              </div>
              <div className="summaryRow">
                <span>Last updated</span>
                <strong>{toneSettings.updatedAt ? new Date(toneSettings.updatedAt).toLocaleString() : "Not yet saved"}</strong>
              </div>
            </div>
          </article>

          <section className="draftEditor toneEditor">
            <div className="draftField">
              <label>Voice Description</label>
              <textarea
                value={toneSettings.voiceDescription}
                onChange={(event) => setToneSettings((current) => ({ ...current, voiceDescription: event.target.value }))}
                placeholder="Warm, credible, practical, and specific. Sound like a strong account executive, not a marketing campaign."
              />
            </div>

            <div className="draftField">
              <label>Do Examples</label>
              <textarea
                value={toneSettings.doExamples}
                onChange={(event) => setToneSettings((current) => ({ ...current, doExamples: event.target.value }))}
                placeholder="Use specific observations, mention food access or employee experience, keep CTAs low-friction."
              />
            </div>

            <div className="draftField">
              <label>Don't Examples</label>
              <textarea
                value={toneSettings.dontExamples}
                onChange={(event) => setToneSettings((current) => ({ ...current, dontExamples: event.target.value }))}
                placeholder="Avoid corporate speak, inflated ROI claims, or generic wellness buzzwords."
              />
            </div>

            <div className="draftField">
              <label>Sample Email</label>
              <textarea
                value={toneSettings.sampleEmail}
                onChange={(event) => setToneSettings((current) => ({ ...current, sampleEmail: event.target.value }))}
                placeholder="Paste a strong example you want future AI-generated outreach to rhyme with."
              />
            </div>

            <div className="draftFooter">
              <button className="primaryButton" type="button" onClick={() => void saveToneSettings()} disabled={savePending}>
                {savePending ? "Saving..." : "Save Tone Settings"}
              </button>
            </div>
          </section>
        </section>
      </>
    );
  }

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brandBlock">
          <h2>Farmer&apos;s Fridge</h2>
          <p>Smart outreach for workplace placement.</p>
        </div>

        <nav className="sidebarNav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activePage;
            const badge =
              item.id === "contacts"
                ? locations.length
                : item.id === "emails"
                  ? emails.length
                  : null;

            return (
              <button
                key={item.id}
                className={`navItem ${isActive ? "active" : ""}`}
                type="button"
                onClick={() => setActivePage(item.id)}
              >
                <Icon size={18} />
                {item.label}
                {badge !== null ? <span className="navBadge">{badge}</span> : null}
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="mainPane">
        {activePage === "dashboard" ? renderDashboardPage() : null}
        {activePage === "contacts" ? (selectedLocationId ? renderLocationDetail() : renderContactsHome()) : null}
        {activePage === "emails" ? renderEmailsPage() : null}
        {activePage === "tone" ? renderTonePage() : null}
      </section>
    </main>
  );
}

function filteredEmails(emails: StoredEmail[], emailFilter: EmailFilter, emailSearch: string) {
  return emails.filter((email) => {
    const matchesFilter = emailFilter === "all" || email.status === emailFilter;
    const matchesSearch = emailSearch.trim()
      ? [
          email.subject,
          email.body,
          email.companyName,
          email.contactName,
          email.contactEmail
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(emailSearch.trim().toLowerCase())
      : true;

    return matchesFilter && matchesSearch;
  });
}
