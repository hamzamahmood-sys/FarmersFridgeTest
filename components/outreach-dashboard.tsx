"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowUpRight,
  Building2,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Copy,
  Download,
  LayoutDashboard,
  Mail,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Upload,
  Zap
} from "lucide-react";
import { DEFAULT_SEARCH_FILTERS, PERSONA_LABELS } from "@/lib/constants";
import type {
  ApolloCreditEstimate,
  GeneratedPitch,
  LeadRecord,
  ProspectCompany,
  SearchFilters
} from "@/lib/types";

type GmailStatus = {
  connected: boolean;
  scope: string | null;
  expiresAt: number | null;
};

type CompanySearchResponse = {
  companies: ProspectCompany[];
  creditEstimate: ApolloCreditEstimate;
  fromCache?: boolean;
};

type CompanyContactsResponse = {
  company: ProspectCompany;
  leads: LeadRecord[];
  fromCache?: boolean;
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

type RecentSearch = {
  query: string;
  count: number;
  fetchedAt: string;
};

type LeadContactStatus = "new" | "contacted" | "replied" | "no_response" | "disqualified";

type FollowUpRecord = {
  subject: string;
  body: string;
  state: "generated" | "drafted";
};

type DraftRecord = {
  leadId: string;
  contactName: string;
  companyName: string;
  email: string;
  subject: string;
  body: string;
  state: "generated" | "drafted";
  followUps: FollowUpRecord[];
};

type DraftFilter = "all" | "generated" | "drafted";

type ResearchState = {
  status: "idle" | "researched";
  pitch: GeneratedPitch;
  talkingPoints: string;
  followUp1?: { subject: string; body: string };
  followUp2?: { subject: string; body: string };
  researchedAt?: string; // ISO timestamp of when research was last run
};

type EmailLookupState = "idle" | "looking" | "found" | "not_found";
type EmailSource = "existing" | "apollo" | "tomba" | "none";

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

const CONTACT_STATUS_LABELS: Record<LeadContactStatus, string> = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  no_response: "No Response",
  disqualified: "DQ'd"
};

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "search", label: "Search", icon: Search },
  { id: "drafts", label: "Drafts", icon: Mail }
] as const;

const US_STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
  "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
  "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
  "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
  "New Hampshire","New Jersey","New Mexico","New York","North Carolina",
  "North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island",
  "South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
  "Virginia","Washington","Washington DC","West Virginia","Wisconsin","Wyoming"
];

const DRAFTS_STORAGE_KEY = "ff-email-drafts-v1";
const RESEARCH_STORAGE_KEY = "ff-email-research-v1";

export function OutreachDashboard() {
  const [activePage, setActivePage] = useState<"dashboard" | "search" | "drafts">("search");
  const [searchMode, setSearchMode] = useState<"search" | "bulk">("search");
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
  const [selectedCompany, setSelectedCompany] = useState<ProspectCompany | null>(null);
  const [companyLoadingId, setCompanyLoadingId] = useState<string | null>(null);
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pitchError, setPitchError] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftSuccess, setDraftSuccess] = useState<string | null>(null);
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [searchPending, startSearchTransition] = useTransition();
  const [pitchPending, startPitchTransition] = useTransition();
  const [draftPending, startDraftTransition] = useTransition();
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);
  const [researchByLeadId, setResearchByLeadId] = useState<Record<string, ResearchState>>({});
  const [emailLookupLeadId, setEmailLookupLeadId] = useState<string | null>(null);
  const [emailLookupStateByLeadId, setEmailLookupStateByLeadId] = useState<Record<string, EmailLookupState>>({});
  const [emailSourceByLeadId, setEmailSourceByLeadId] = useState<Record<string, EmailSource>>({});
  const [draftPrepLeadId, setDraftPrepLeadId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [selectedDraftLeadId, setSelectedDraftLeadId] = useState<string | null>(null);
  const [draftFilter, setDraftFilter] = useState<DraftFilter>("all");
  const [fromCache, setFromCache] = useState<boolean>(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [leadStatusById, setLeadStatusById] = useState<Record<string, LeadContactStatus>>({});
  const [bulkResearchProgress, setBulkResearchProgress] = useState<{
    total: number;
    completed: number;
    active: boolean;
  } | null>(null);
  const [isBulkResearching, setIsBulkResearching] = useState(false);
  const [draftSequenceTab, setDraftSequenceTab] = useState<0 | 1 | 2>(0);
  const [draftsHydrated, setDraftsHydrated] = useState(false);
  const [researchHydrated, setResearchHydrated] = useState(false);

  const filteredDrafts = useMemo(
    () => (draftFilter === "all" ? drafts : drafts.filter((d) => d.state === draftFilter)),
    [drafts, draftFilter]
  );

  const selectedDraft = useMemo(
    () => filteredDrafts.find((draft) => draft.leadId === selectedDraftLeadId) || filteredDrafts[0] || null,
    [filteredDrafts, selectedDraftLeadId]
  );

  useEffect(() => {
    setDraftSequenceTab(0);
  }, [selectedDraftLeadId]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFTS_STORAGE_KEY);
      if (!raw) {
        setDraftsHydrated(true);
        return;
      }

      const parsed = JSON.parse(raw) as {
        drafts?: DraftRecord[];
        selectedDraftLeadId?: string | null;
        draftFilter?: DraftFilter;
      };

      if (Array.isArray(parsed.drafts)) {
        setDrafts(parsed.drafts);
      }
      if (typeof parsed.selectedDraftLeadId === "string" || parsed.selectedDraftLeadId === null) {
        setSelectedDraftLeadId(parsed.selectedDraftLeadId ?? null);
      }
      if (parsed.draftFilter === "all" || parsed.draftFilter === "generated" || parsed.draftFilter === "drafted") {
        setDraftFilter(parsed.draftFilter);
      }
    } catch {
      // Ignore malformed local state and start fresh.
    } finally {
      setDraftsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!draftsHydrated) return;

    window.localStorage.setItem(
      DRAFTS_STORAGE_KEY,
      JSON.stringify({
        drafts,
        selectedDraftLeadId,
        draftFilter
      })
    );
  }, [draftFilter, drafts, draftsHydrated, selectedDraftLeadId]);

  // ── Research persistence ──────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RESEARCH_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, ResearchState>;
        if (parsed && typeof parsed === "object") {
          setResearchByLeadId(parsed);
        }
      }
    } catch {
      // Ignore corrupted data
    } finally {
      setResearchHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!researchHydrated) return;
    try {
      window.localStorage.setItem(RESEARCH_STORAGE_KEY, JSON.stringify(researchByLeadId));
    } catch {
      // localStorage quota exceeded — skip silently
    }
  }, [researchByLeadId, researchHydrated]);

  const researchedCount = Object.keys(researchByLeadId).length;
  const deliveryZoneMatches = leads.filter((lead) => lead.company.deliveryZone !== "Other").length;
  const dashboardStats = [
    { label: selectedCompany ? "Contacts loaded" : "Companies loaded", value: selectedCompany ? leads.length : companies.length },
    { label: "Researched", value: researchedCount },
    { label: "Drafts queued", value: drafts.length },
    { label: "Zone matches", value: deliveryZoneMatches }
  ];

  useEffect(() => {
    setCreditEstimate({
      peopleSearchCalls: 1,
      organizationEnrichCalls: 1,
      totalEstimatedOperations: 2,
      note:
        "Search starts with Apollo's organization search, then loads contacts from the company you pick using Apollo's free people search endpoint."
    });
  }, [filters.limit]);

  useEffect(() => {
    setLimitInput(String(filters.limit));
  }, [filters.limit]);

  useEffect(() => {
    void refreshGmailStatus();
    void fetch("/api/leads/recent")
      .then((r) => r.json())
      .then((d) => setRecentSearches((d as { searches: RecentSearch[] }).searches ?? []));
  }, []);

  async function refreshGmailStatus() {
    const response = await fetch("/api/gmail/status");
    const data = (await response.json()) as GmailStatus;
    setGmailStatus(data);
  }

  function replaceLeadRecord(nextRecord: LeadRecord) {
    setLeads((current) =>
      current.map((record) => (record.lead.id === nextRecord.lead.id ? nextRecord : record))
    );
  }

  function resetLeadResults() {
    setLeads([]);
    setSelectedCompany(null);
    setResearchByLeadId({});
    setEmailLookupStateByLeadId({});
    setEmailSourceByLeadId({});
    setExpandedLeadId(null);
    setLeadStatusById({});
    setBulkResearchProgress(null);
    setIsBulkResearching(false);
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

    setPitchError(null);
    setDraftError(null);
    setDraftSuccess(null);
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
        setDraftError(
          note
            ? `No email found for ${record.lead.name} yet. ${note}${status} We can still generate the outreach copy, but Gmail draft creation will stay disabled until an email is found.`
            : `No email found for ${record.lead.name} yet.${status} We can still generate the outreach copy, but Gmail draft creation will stay disabled until an email is found.`
        );
        return data.leadRecord;
      }

      setEmailLookupStateByLeadId((current) => ({ ...current, [record.lead.id]: "found" }));
      setEmailSourceByLeadId((current) => ({ ...current, [record.lead.id]: data.source }));
      return data.leadRecord;
    } catch (error) {
      setEmailLookupStateByLeadId((current) => ({ ...current, [record.lead.id]: "not_found" }));
      setDraftError(error instanceof Error ? error.message : "Email lookup failed.");
      return null;
    } finally {
      setEmailLookupLeadId(null);
    }
  }

  async function ensureLeadResearch(record: LeadRecord): Promise<ResearchState | null> {
    const existingResearch = researchByLeadId[record.lead.id];
    if (existingResearch && !isLowSignalPitch(existingResearch.pitch)) {
      setExpandedLeadId(record.lead.id);
      return existingResearch;
    }

    try {
      const pitch = await fetchPitch(record, undefined, 1, Boolean(existingResearch));
      const nextResearch: ResearchState = {
        status: "researched",
        pitch,
        talkingPoints: pitch.talkingPoints,
        researchedAt: new Date().toISOString()
      };

      setExpandedLeadId(record.lead.id);
      setResearchByLeadId((current) => ({
        ...current,
        [record.lead.id]: nextResearch
      }));
      void generateFollowUps(record, pitch.talkingPoints);

      return nextResearch;
    } catch (error) {
      setPitchError(error instanceof Error ? error.message : "Pitch generation failed.");
      return null;
    }
  }

  async function runSearch(forceRefresh = false) {
    void forceRefresh;
    setSearchError(null);
    setPitchError(null);
    setDraftError(null);
    setDraftSuccess(null);

    startSearchTransition(async () => {
      const response = await fetch("/api/companies/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...filters, industryQuery: query })
      });

      const data = (await response.json()) as CompanySearchResponse & { error?: string };

      if (!response.ok) {
        setSearchError(data.error || "Search failed.");
        return;
      }

      setHasSearched(true);
      setCreditEstimate(data.creditEstimate);
      setCompanies(data.companies);
      resetLeadResults();
      setFromCache(data.fromCache ?? false);
    });
  }

  async function runBulkImport() {
    const lines = bulkInput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      setSearchError("Paste at least one company, domain, or market query for bulk import.");
      return;
    }

    setSearchError(null);
    setPitchError(null);
    setDraftError(null);
    setDraftSuccess(null);

    const firstQuery = lines[0];
    setQuery(firstQuery);
    await runSearchWithQuery(firstQuery, Math.min(Math.max(lines.length, 10), 20));
  }

  async function runSearchWithQuery(nextQuery: string, nextLimit?: number) {
    setSearchError(null);
    setPitchError(null);
    setDraftError(null);
    setDraftSuccess(null);

    const effectiveFilters = {
      ...filters,
      industryQuery: nextQuery,
      limit: nextLimit ?? filters.limit
    };

    startSearchTransition(async () => {
      const response = await fetch("/api/companies/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(effectiveFilters)
      });

      const data = (await response.json()) as CompanySearchResponse & { error?: string };

      if (!response.ok) {
        setSearchError(data.error || "Search failed.");
        return;
      }

      setHasSearched(true);
      setCreditEstimate(data.creditEstimate);
      setCompanies(data.companies);
      resetLeadResults();
      setFromCache(data.fromCache ?? false);
      setFilters((current) => ({ ...current, limit: effectiveFilters.limit }));
    });
  }

  async function loadCompanyLeads(company: ProspectCompany) {
    setSearchError(null);
    setPitchError(null);
    setDraftError(null);
    setDraftSuccess(null);
    setCompanyLoadingId(company.id);

    try {
      const response = await fetch("/api/leads/by-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company,
          filters: { ...filters, industryQuery: query },
          searchQuery: query
        })
      });

      const data = (await response.json()) as CompanyContactsResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "Failed to load company contacts.");
      }

      setSelectedCompany(data.company);
      setLeads(data.leads);
      setResearchByLeadId({});
      setEmailLookupStateByLeadId({});
      setEmailSourceByLeadId({});
      setExpandedLeadId(null);
      setLeadStatusById({});
      setBulkResearchProgress(null);
      setIsBulkResearching(false);
      setFromCache(data.fromCache ?? false);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Failed to load company contacts.");
    } finally {
      setCompanyLoadingId(null);
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
      setResearchByLeadId((current) => {
        const existing = current[record.lead.id];
        if (!existing) return current;
        return {
          ...current,
          [record.lead.id]: {
            ...existing,
            followUp1: { subject: fu1.subject, body: fu1.body },
            followUp2: { subject: fu2.subject, body: fu2.body }
          }
        };
      });
    } catch {
      // Follow-up generation is non-critical
    }
  }

  async function researchLead(record: LeadRecord, talkingPointsOverride?: string) {
    setPitchError(null);
    setDraftError(null);
    setDraftSuccess(null);

    startPitchTransition(async () => {
      try {
        const existingResearch = researchByLeadId[record.lead.id];
        const forceRefresh = Boolean(existingResearch && isLowSignalPitch(existingResearch.pitch));
        const pitch = await fetchPitch(record, talkingPointsOverride, 1, forceRefresh);
        setExpandedLeadId(record.lead.id);
        setResearchByLeadId((current) => ({
          ...current,
          [record.lead.id]: {
            status: "researched",
            pitch,
            talkingPoints: pitch.talkingPoints,
            researchedAt: new Date().toISOString()
          }
        }));
        void generateFollowUps(record, pitch.talkingPoints);
      } catch (err) {
        setPitchError(err instanceof Error ? err.message : "Pitch generation failed.");
      }
    });
  }

  async function researchAllLeads() {
    const unresearched = leads.filter((record) => {
      const existingResearch = researchByLeadId[record.lead.id];
      return !existingResearch || isLowSignalPitch(existingResearch.pitch);
    });
    if (unresearched.length === 0 || isBulkResearching) return;

    setIsBulkResearching(true);
    setPitchError(null);
    setBulkResearchProgress({ total: unresearched.length, completed: 0, active: true });

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
            researchedAt: new Date().toISOString()
          }
        }));
        void generateFollowUps(record, pitch.talkingPoints);
      } catch {
        // Continue with next lead if one fails
      }
      setBulkResearchProgress((prev) =>
        prev ? { ...prev, completed: prev.completed + 1 } : null
      );
    }

    setBulkResearchProgress((prev) => (prev ? { ...prev, active: false } : null));
    setIsBulkResearching(false);
  }

  async function approveDraft(record: LeadRecord) {
    setPitchError(null);
    setDraftError(null);
    setDraftSuccess(null);
    setDraftPrepLeadId(record.lead.id);

    try {
      let draftRecord = record;
      if (!draftRecord.lead.email) {
        const enrichedRecord = await ensureLeadEmail(draftRecord);
        if (!enrichedRecord) {
          return;
        }
        draftRecord = enrichedRecord;
      }

      const research = await ensureLeadResearch(draftRecord);
      if (!research) {
        return;
      }

      const followUps: FollowUpRecord[] = [];
      if (research.followUp1) followUps.push({ ...research.followUp1, state: "generated" });
      if (research.followUp2) followUps.push({ ...research.followUp2, state: "generated" });

      const nextDraft: DraftRecord = {
        leadId: draftRecord.lead.id,
        contactName: draftRecord.lead.name,
        companyName: draftRecord.lead.companyName,
        email: draftRecord.lead.email,
        subject: research.pitch.subject,
        body: research.pitch.body,
        state: "generated",
        followUps
      };

      setDrafts((current) => {
        const withoutCurrent = current.filter((draft) => draft.leadId !== draftRecord.lead.id);
        return [nextDraft, ...withoutCurrent];
      });
      setSelectedDraftLeadId(draftRecord.lead.id);
      setDraftFilter("all");
      setDraftSequenceTab(0);
      setActivePage("drafts");
    } finally {
      setDraftPrepLeadId(null);
    }
  }

  async function rebuildDraftFromTalkingPoints(record: LeadRecord) {
    const research = researchByLeadId[record.lead.id];
    if (!research) return;
    await researchLead(record, research.talkingPoints);
  }

  function getCurrentDraftContent(draft: DraftRecord): { subject: string; body: string } {
    if (draftSequenceTab === 1 && draft.followUps[0]) {
      return { subject: draft.followUps[0].subject, body: draft.followUps[0].body };
    }
    if (draftSequenceTab === 2 && draft.followUps[1]) {
      return { subject: draft.followUps[1].subject, body: draft.followUps[1].body };
    }
    return { subject: draft.subject, body: draft.body };
  }

  async function createGmailDraft() {
    if (!selectedDraft) return;
    if (!selectedDraft.email) {
      setDraftError("This lead doesn't have an email address yet, so Gmail draft creation is unavailable.");
      return;
    }

    const { subject, body } = getCurrentDraftContent(selectedDraft);
    setDraftError(null);
    setDraftSuccess(null);

    startDraftTransition(async () => {
      const response = await fetch("/api/gmail/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: selectedDraft.email, subject, body })
      });

      const data = (await response.json()) as { gmailUrl?: string; error?: string };

      if (!response.ok) {
        setDraftError(data.error || "Draft creation failed.");
        return;
      }

      setDrafts((current) =>
        current.map((draft) => {
          if (draft.leadId !== selectedDraft.leadId) return draft;
          if (draftSequenceTab === 0) return { ...draft, state: "drafted" };
          const idx = draftSequenceTab - 1;
          const newFollowUps = [...draft.followUps];
          if (newFollowUps[idx]) newFollowUps[idx] = { ...newFollowUps[idx]!, state: "drafted" };
          return { ...draft, followUps: newFollowUps };
        })
      );
      setDraftSuccess(data.gmailUrl || "https://mail.google.com/mail/u/0/#drafts");
      await refreshGmailStatus();
    });
  }

  async function createAllGmailDrafts() {
    if (!selectedDraft) return;
    if (!selectedDraft.email) {
      setDraftError("This lead doesn't have an email address yet, so Gmail draft creation is unavailable.");
      return;
    }
    setDraftError(null);
    setDraftSuccess(null);

    const emailsToCreate = [
      { subject: selectedDraft.subject, body: selectedDraft.body },
      ...selectedDraft.followUps.map((fu) => ({ subject: fu.subject, body: fu.body }))
    ];

    startDraftTransition(async () => {
      let lastUrl: string | null = null;
      for (const email of emailsToCreate) {
        const response = await fetch("/api/gmail/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: selectedDraft.email, subject: email.subject, body: email.body })
        });
        const data = (await response.json()) as { gmailUrl?: string; error?: string };
        if (!response.ok) {
          setDraftError(data.error || "Draft creation failed.");
          return;
        }
        lastUrl = data.gmailUrl || null;
      }
      setDrafts((current) =>
        current.map((draft) => {
          if (draft.leadId !== selectedDraft.leadId) return draft;
          return {
            ...draft,
            state: "drafted",
            followUps: draft.followUps.map((fu) => ({ ...fu, state: "drafted" as const }))
          };
        })
      );
      setDraftSuccess(lastUrl || "https://mail.google.com/mail/u/0/#drafts");
      await refreshGmailStatus();
    });
  }

  function updateDraft(field: "subject" | "body", value: string) {
    if (!selectedDraft) return;

    setDrafts((current) =>
      current.map((draft) => {
        if (draft.leadId !== selectedDraft.leadId) return draft;
        if (draftSequenceTab === 0) return { ...draft, [field]: value };
        const idx = draftSequenceTab - 1;
        const newFollowUps = [...draft.followUps];
        if (newFollowUps[idx]) newFollowUps[idx] = { ...newFollowUps[idx]!, [field]: value };
        return { ...draft, followUps: newFollowUps };
      })
    );
  }

  function updateTalkingPoints(leadId: string, value: string) {
    setResearchByLeadId((current) => {
      const research = current[leadId];
      if (!research) return current;
      return { ...current, [leadId]: { ...research, talkingPoints: value } };
    });
  }

  function setLeadStatus(leadId: string, status: LeadContactStatus) {
    setLeadStatusById((current) => ({ ...current, [leadId]: status }));
  }

  function downloadCSV(filename: string, rows: Array<Array<string | number>>) {
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportLeadsCSV() {
    const headers = [
      "Name", "Email", "Title", "Company", "Industry",
      "Employees", "City", "Zone", "Priority Score", "Contact Status"
    ];
    const rows = leads.map((r) => [
      r.lead.name,
      r.lead.email,
      r.lead.title,
      r.lead.companyName,
      r.company.industry || "",
      r.company.employeeCount || "",
      r.company.hqCity || "",
      r.company.deliveryZone,
      r.priorityScore,
      CONTACT_STATUS_LABELS[leadStatusById[r.lead.id] || "new"]
    ]);
    downloadCSV("ff_leads.csv", [headers, ...rows]);
  }

  function exportDraftsCSV() {
    const headers = ["Contact", "Company", "Email", "Sequence", "Subject", "Body", "Draft Status"];
    const rows: Array<Array<string>> = [];
    for (const draft of drafts) {
      rows.push([draft.contactName, draft.companyName, draft.email, "Email 1", draft.subject, draft.body, draft.state]);
      draft.followUps.forEach((fu, i) => {
        rows.push([draft.contactName, draft.companyName, draft.email, `Follow-up ${i + 1}`, fu.subject, fu.body, fu.state]);
      });
    }
    downloadCSV("ff_drafts.csv", [headers, ...rows]);
  }

  function renderSearchPage() {
    const unresearchedCount = leads.filter((r) => !researchByLeadId[r.lead.id]).length;
    const resultsCountLabel = selectedCompany
      ? `${leads.length} contacts`
      : `${companies.length} companies`;

    return (
      <>
        <header className="pageHeader">
          <div>
            <h1>Farmer&apos;s Fridge Lead Gen Hub</h1>
            <p>Search companies first, then load the right workplace contacts inside the company you choose and move them into personalized outreach.</p>
          </div>
          <div className="pagePills">
            <button
              type="button"
              className={`topPill ${searchMode === "search" ? "active" : ""}`}
              onClick={() => setSearchMode("search")}
            >
              Search
            </button>
            <button
              type="button"
              className={`topPill ${searchMode === "bulk" ? "active" : ""}`}
              onClick={() => setSearchMode("bulk")}
            >
              Bulk Import
            </button>
          </div>
        </header>

        <section className="searchComposer">
          {searchMode === "search" ? (
            <>
              <div className="searchBox">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Try: Rush Hospital, law firm NYC, or office parks in New Jersey"
                />
                <button className="primaryButton" type="button" onClick={() => void runSearch()} disabled={searchPending}>
                  <Search size={16} />
                  {searchPending ? "Searching..." : "Search"}
                </button>
              </div>
              <p className="helperText">
                Search by company name, company type, or geography. We&apos;ll show matching companies first, then you can load the best-fit contacts inside one company.
              </p>
            </>
          ) : (
            <>
              <div className="bulkBox">
                <textarea
                  value={bulkInput}
                  onChange={(event) => setBulkInput(event.target.value)}
                  placeholder={"Paste one company or target per line\nNorthwestern Medicine\nJLL Chicago\nNewark office parks"}
                />
                <button className="primaryButton" type="button" onClick={() => void runBulkImport()} disabled={searchPending}>
                  <Upload size={16} />
                  {searchPending ? "Importing..." : "Import & Search"}
                </button>
              </div>
              <p className="helperText">
                Bulk import helps you seed the pipeline quickly. Start with target companies, campuses, hospital systems, or office portfolios.
              </p>
            </>
          )}
        </section>

        <section className="filterBar">
          <div className="filterBarRow">
            <div className="filterField filterField--role">
              <label>Target role</label>
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
                <label>Custom job title</label>
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
            <span className="resultsCount">{resultsCountLabel}</span>
            <div className="filterField">
              <label>{selectedCompany ? "Contact count" : "Company count"}</label>
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
                placeholder="10"
              />
            </div>
            <div className="filterField">
              <label>Minimum employees</label>
              <input
                type="number"
                min={200}
                value={filters.employeeMin}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, employeeMin: Number(event.target.value) || 200 }))
                }
              />
            </div>
            <div className="filterField statesField">
              <label>States</label>
              <div className="statesControls">
                <div className="statesActions">
                  <button
                    type="button"
                    className="statesBtn"
                    onClick={() => setFilters((c) => ({ ...c, states: [...US_STATES] }))}
                  >All</button>
                  <button
                    type="button"
                    className="statesBtn"
                    onClick={() => setFilters((c) => ({ ...c, states: [] }))}
                  >Clear</button>
                  <span className="statesCount">
                    {filters.states.length === 0
                      ? "Nationwide"
                      : filters.states.length === US_STATES.length
                      ? "All states"
                      : `${filters.states.length} selected`}
                  </span>
                </div>
                <select
                  multiple
                  className="statesSelect"
                  value={filters.states}
                  onChange={(e) => {
                    const selected = [...e.target.selectedOptions].map((o) => o.value);
                    setFilters((c) => ({ ...c, states: selected }));
                  }}
                >
                  {US_STATES.map((state) => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className={`ffGuidance ${filters.employeeMin < 150 ? "ffGuidance--csuite" : "ffGuidance--ops"}`}>
            <span className="ffGuidanceLabel">FF Targeting Rule</span>
            {filters.employeeMin < 150 ? (
              <>
                <strong>Under 150 employees → C-Suite</strong>
                <span>At smaller companies, decision-makers are founders, CEOs, and COOs — not HR or office managers.</span>
                {!filters.personas.includes("csuite") && (
                  <button
                    type="button"
                    className="ffGuidanceApply"
                    onClick={() => setFilters((c) => ({ ...c, personas: ["csuite"] }))}
                  >
                    Switch to C-Suite
                  </button>
                )}
              </>
            ) : (
              <>
                <strong>150+ employees → HR / Facilities / Office Manager</strong>
                <span>Larger companies have dedicated operations roles that own workplace decisions.</span>
                {filters.personas.includes("csuite") && (
                  <button
                    type="button"
                    className="ffGuidanceApply"
                    onClick={() => setFilters((c) => ({ ...c, personas: ["office_manager", "facilities_director"] }))}
                  >
                    Switch to Ops roles
                  </button>
                )}
              </>
            )}
          </div>
        </section>

        {creditEstimate ? (
          <section className="creditBanner">
            <strong>Estimated Apollo search flow: {creditEstimate.totalEstimatedOperations} operations</strong>
            <span>{creditEstimate.note}</span>
          </section>
        ) : null}

        {fromCache && selectedCompany && leads.length > 0 ? (
          <div className="cacheBanner">
            <span>Showing cached contacts for this company.</span>
            <button className="cacheRefreshBtn" type="button" onClick={() => void runSearch(true)} disabled={searchPending}>
              <RefreshCw size={13} /> Refresh from Apollo
            </button>
          </div>
        ) : null}

        {searchError ? <p className="error">{searchError}</p> : null}
        {pitchError ? <p className="error">{pitchError}</p> : null}
        {draftError ? <p className="error">{draftError}</p> : null}

        <section className="resultsPanel">
          {!selectedCompany ? (
            companies.length === 0 ? (
              <div className="emptyStateTable">
                <Building2 size={34} />
                <p>
                  {hasSearched
                    ? `No Apollo companies came back for "${query}". Try a broader market, company name, or location.`
                    : "Search for an office, hospital, university, law firm, or employer footprint to start building your outreach list."}
                </p>
              </div>
            ) : (
              <div className="tableWrap">
                <div className="tableHeader tableHeader--companies">
                  <span>Company</span>
                  <span>Location</span>
                  <span>Industry</span>
                  <span>Employees</span>
                  <span>Fit</span>
                  <span>Actions</span>
                </div>

                {companies.map((company) => {
                  const location = [company.company.hqCity, company.company.hqState].filter(Boolean).join(", ");

                  return (
                    <div key={company.id} className="tableRowGroup">
                      <div className="tableRow tableRow--companies">
                        <div className="cell primaryCell">
                          <div className="nameBlock">
                            <strong>{company.name}</strong>
                            <span>{company.domain || "No domain found"}</span>
                          </div>
                        </div>
                        <div className="cell">{location || "Location unavailable"}</div>
                        <div className="cell">{company.company.industry || "Industry unavailable"}</div>
                        <div className="cell">{company.company.employeeCount?.toLocaleString() || "Unknown"}</div>
                        <div className="cell">
                          <span className="confidencePill">
                            {company.company.deliveryZone !== "Other" ? "Zone Match" : "General Fit"}
                          </span>
                        </div>
                        <div className="cell actionCell">
                          <button
                            className="primaryButton"
                            type="button"
                            onClick={() => void loadCompanyLeads(company)}
                            disabled={companyLoadingId === company.id}
                          >
                            <Search size={16} />
                            {companyLoadingId === company.id ? "Loading..." : "Find Contacts"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : leads.length === 0 ? (
            <div className="emptyStateTable">
              <Building2 size={34} />
              <p>
                No matching contacts came back for {selectedCompany.name}. Try another company, broaden the role filter, or lower the minimum employee count.
              </p>
              <button
                className="secondaryButton"
                type="button"
                onClick={() => {
                  setSelectedCompany(null);
                  setLeads([]);
                  setExpandedLeadId(null);
                }}
              >
                Back to Companies
              </button>
            </div>
          ) : (
            <>
              <section className="companySelectionBanner">
                <div>
                  <strong>{selectedCompany.name}</strong>
                  <span>
                    {[
                      selectedCompany.company.industry,
                      selectedCompany.company.hqCity,
                      selectedCompany.company.hqState
                    ].filter(Boolean).join(" · ") || "Company selected"}
                  </span>
                </div>
                <div className="inlineActions">
                  {selectedCompany.domain ? (
                    <a
                      className="secondaryLink"
                      href={`https://${selectedCompany.domain}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Visit Site <ArrowUpRight size={14} />
                    </a>
                  ) : null}
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() => {
                      setSelectedCompany(null);
                      setLeads([]);
                      setExpandedLeadId(null);
                    }}
                  >
                    Back to Companies
                  </button>
                </div>
              </section>

              <div className="tableWrap">
                <div className="tableToolbar">
                  <div className="tableToolbarLeft">
                    <button
                      className="secondaryButton"
                      type="button"
                      onClick={() => void researchAllLeads()}
                      disabled={isBulkResearching || unresearchedCount === 0}
                      title={unresearchedCount === 0 ? "All leads already researched" : `Research ${unresearchedCount} remaining leads`}
                    >
                      <Zap size={15} />
                      {isBulkResearching ? "Researching..." : `Research All${unresearchedCount > 0 ? ` (${unresearchedCount})` : ""}`}
                    </button>
                    {bulkResearchProgress ? (
                      <div className="bulkProgressWrap">
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
                  </div>
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={exportLeadsCSV}
                  >
                    <Download size={15} />
                    Export CSV
                  </button>
                </div>

                <div className="tableHeader">
                  <span>Name</span>
                  <span>Email</span>
                  <span>Position</span>
                  <span>Priority</span>
                  <span>Status</span>
                  <span>Actions</span>
                </div>

                {leads.map((record) => {
                  const research = researchByLeadId[record.lead.id];
                  const isExpanded = expandedLeadId === record.lead.id;
                  const contactStatus = leadStatusById[record.lead.id] || "new";
                  const isResearched = research?.status === "researched";
                  const canDraft = Boolean(record.lead.email);
                  const isFindingEmail = emailLookupLeadId === record.lead.id;
                  const isPreparingDraft = draftPrepLeadId === record.lead.id;

                  return (
                    <div key={record.lead.id} className="tableRowGroup">
                      <div className="tableRow">
                        <div className="cell primaryCell">
                          <div className="nameBlock">
                            <strong>{record.lead.name}</strong>
                            <span>{record.lead.companyName}</span>
                            {isResearched && research?.researchedAt && (
                              <span className="researchedBadge" title={`Researched on ${new Date(research.researchedAt).toLocaleString()}`}>
                                ✓ Researched {new Date(research.researchedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              </span>
                            )}
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
                          <span className="confidencePill">
                            {record.company.deliveryZone !== "Other" ? "Zone Match" : "General Fit"}
                          </span>
                        </div>
                        <div className="cell">
                          <select
                            className={`statusSelect statusSelect--${contactStatus}`}
                            value={contactStatus}
                            onChange={(e) => setLeadStatus(record.lead.id, e.target.value as LeadContactStatus)}
                          >
                            {Object.entries(CONTACT_STATUS_LABELS).map(([val, label]) => (
                              <option key={val} value={val}>{label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="cell actionCell">
                          <button
                            className={`iconButton${isResearched ? " iconButton--done" : ""}`}
                            type="button"
                            onClick={() => void researchLead(record, research?.talkingPoints)}
                            title={isResearched ? "Re-research lead" : "Research lead"}
                            disabled={pitchPending}
                          >
                            <Sparkles size={16} />
                          </button>
                          <button
                            className="iconButton"
                            type="button"
                            onClick={() => void approveDraft(record)}
                            title={
                              canDraft
                                ? isPreparingDraft
                                  ? "Preparing draft"
                                  : "Research and move to drafts"
                                : isPreparingDraft || isFindingEmail
                                  ? "Finding email and preparing draft"
                                  : "Find email, research, and move to drafts"
                            }
                            disabled={isPreparingDraft || isFindingEmail}
                          >
                            <Mail size={16} />
                          </button>
                          <button
                            className="iconButton"
                            type="button"
                            onClick={() => setExpandedLeadId(isExpanded ? null : record.lead.id)}
                            title={isExpanded ? "Hide lead details" : "Review lead details"}
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
                                {(research.followUp1 || research.followUp2) ? (
                                  <div className="sequenceReadyBadge">
                                    3-email sequence ready
                                  </div>
                                ) : (
                                  <div className="sequenceLoadingBadge">
                                    Generating sequence...
                                  </div>
                                )}
                              </div>
                              <div className="researchFooter">
                                <div className="microMeta">
                                  <span>Bridge insight: {research.pitch.bridgeInsight}</span>
                                  <span>Specificity anchors: {research.pitch.variableEvidence.join(", ") || "None detected"}</span>
                                  <span>Contact email: {getEmailDisplay(record)}</span>
                                </div>
                                <div className="inlineActions">
                                  <button className="secondaryButton" type="button" onClick={() => void rebuildDraftFromTalkingPoints(record)}>
                                    <RefreshCw size={16} />
                                    Regenerate
                                  </button>
                                  <button
                                    className="primaryButton"
                                    type="button"
                                    onClick={() => void approveDraft(record)}
                                    disabled={isFindingEmail || isPreparingDraft}
                                    title={
                                      canDraft
                                        ? "Research is done. Move this lead into drafts."
                                        : "Find email, then move this researched lead into drafts."
                                    }
                                  >
                                    <CircleCheck size={16} />
                                    {isPreparingDraft
                                      ? "Preparing Draft..."
                                      : isFindingEmail
                                        ? "Finding Email..."
                                        : canDraft
                                          ? "Move to Drafts"
                                          : "Find Email & Move to Drafts"}
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
                                <p>Review the lead here, then run research or go straight to draft prep. Draft prep will look up the email first, then generate the outreach sequence.</p>
                              </div>
                              <div className="researchFooter">
                                <div className="microMeta">
                                  <span>Contact email: {getEmailDisplay(record)}</span>
                                  <span>Company: {record.lead.companyName}</span>
                                  <span>Title: {record.lead.title}</span>
                                </div>
                                <div className="inlineActions">
                                  <button
                                    className="secondaryButton"
                                    type="button"
                                    onClick={() => void researchLead(record)}
                                    disabled={pitchPending || isPreparingDraft}
                                  >
                                    <Sparkles size={16} />
                                    {pitchPending ? "Researching..." : "Research Lead"}
                                  </button>
                                  <button
                                    className="primaryButton"
                                    type="button"
                                    onClick={() => void approveDraft(record)}
                                    disabled={isFindingEmail || isPreparingDraft}
                                    title="Find email, run research, and move the lead into drafts."
                                  >
                                    <Mail size={16} />
                                    {isPreparingDraft
                                      ? "Preparing Draft..."
                                      : isFindingEmail
                                        ? "Finding Email..."
                                        : "Find Email, Research & Draft"}
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
            </>
          )}
        </section>
      </>
    );
  }

  function renderDraftsPage() {
    const currentContent = selectedDraft ? getCurrentDraftContent(selectedDraft) : null;
    const hasSequence = selectedDraft && selectedDraft.followUps.length > 0;
    const sequenceLabels = ["Email 1", "Follow-up 1", "Follow-up 2"];

    return (
      <>
        <header className="pageHeader">
          <div>
            <h1>Outreach Drafts</h1>
            <p>{filteredDrafts.length} of {drafts.length} {drafts.length === 1 ? "draft" : "drafts"} — review, edit, and push to Gmail</p>
          </div>
          <div className="draftHeaderControls">
            <select
              className="draftFilter"
              value={draftFilter}
              onChange={(event) => setDraftFilter(event.target.value as DraftFilter)}
            >
              <option value="all">all</option>
              <option value="generated">generated</option>
              <option value="drafted">gmail drafted</option>
            </select>
            {drafts.length > 0 ? (
              <button className="secondaryButton" type="button" onClick={exportDraftsCSV}>
                <Download size={15} />
                Export CSV
              </button>
            ) : null}
          </div>
        </header>

        {selectedDraft && currentContent ? (
          <section className="draftEditor">
            {/* Sequence tabs */}
            {hasSequence ? (
              <div className="sequenceTabs">
                {sequenceLabels.slice(0, 1 + selectedDraft.followUps.length).map((label, i) => {
                  const isDrafted =
                    i === 0
                      ? selectedDraft.state === "drafted"
                      : selectedDraft.followUps[i - 1]?.state === "drafted";
                  return (
                    <button
                      key={i}
                      className={`sequenceTab ${draftSequenceTab === i ? "active" : ""}`}
                      type="button"
                      onClick={() => setDraftSequenceTab(i as 0 | 1 | 2)}
                    >
                      {label}
                      {isDrafted ? <span className="sequenceTabDot" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="sequenceLoadingBadge sequenceLoadingBadge--inline">
                Generating follow-up sequence in the background...
              </div>
            )}

            <div className="draftHeader">
              <div>
                <h2>
                  {currentContent.subject}{" "}
                  <span className="generatedBadge">
                    {draftSequenceTab === 0 ? selectedDraft.state : (selectedDraft.followUps[draftSequenceTab - 1]?.state ?? "generated")}
                  </span>
                </h2>
                <p>
                  To: {selectedDraft.contactName} at {selectedDraft.companyName}{" "}
                  <span className="mono">{selectedDraft.email || "No email found"}</span>
                </p>
              </div>
              <div className="draftHeaderActions">
                <button
                  className="iconButton"
                  type="button"
                  onClick={() => navigator.clipboard.writeText(currentContent.body)}
                  title="Copy body"
                >
                  <Copy size={16} />
                </button>
              </div>
            </div>

            <div className="draftField">
              <label>Subject</label>
              <input value={currentContent.subject} onChange={(event) => updateDraft("subject", event.target.value)} />
            </div>

            <div className="draftField">
              <label>Body</label>
              <textarea value={currentContent.body} onChange={(event) => updateDraft("body", event.target.value)} />
            </div>

            <div className="draftFooter">
              {!selectedDraft.email ? (
                <p className="error">
                  No email found yet for this lead. You can still review and copy the sequence here, but Gmail draft creation is disabled until an email is found.
                </p>
              ) : null}
              <div className="inlineActions">
                <button className="secondaryButton" type="button" onClick={() => setActivePage("search")}>
                  Back to Search
                </button>
                <button className="secondaryButton" type="button" onClick={() => navigator.clipboard.writeText(currentContent.body)}>
                  <Copy size={16} />
                  Copy
                </button>
                {hasSequence ? (
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() => void createAllGmailDrafts()}
                    disabled={draftPending || !selectedDraft.email}
                  >
                    <Send size={16} />
                    {draftPending ? "Creating..." : "Create All Gmail Drafts"}
                  </button>
                ) : null}
                <button
                  className="primaryButton"
                  type="button"
                  onClick={() => void createGmailDraft()}
                  disabled={draftPending || !selectedDraft.email}
                >
                  <Send size={16} />
                  {draftPending ? "Creating Gmail Draft..." : "Create Gmail Draft"}
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

            {draftError ? <p className="error">{draftError}</p> : null}
            {draftSuccess ? (
              <p className="success">
                Draft created in Gmail. Open{" "}
                <a className="inlineLink" href={draftSuccess} target="_blank" rel="noreferrer">
                  Gmail drafts
                </a>{" "}
                to review and send.
              </p>
            ) : null}
          </section>
        ) : (
          <section className="resultsPanel">
            <div className="emptyStateTable">
              <Mail size={34} />
              {drafts.length > 0 ? (
                <>
                  <p>No drafts match the current filter.</p>
                  <button className="secondaryButton" type="button" onClick={() => setDraftFilter("all")}>
                    Show All Drafts
                  </button>
                </>
              ) : (
                <p>No drafts yet. Research a lead, approve the pitch, and it lands here ready to push to Gmail.</p>
              )}
            </div>
          </section>
        )}
      </>
    );
  }

  function renderDashboardPage() {
    return (
      <>
        <header className="pageHeader">
          <div>
            <h1>Your Pipeline</h1>
            <p>Every deal starts here — track leads from first search through drafted outreach and into Gmail.</p>
          </div>
        </header>

        <section className="dashboardGrid">
          {dashboardStats.map((stat) => (
            <article key={stat.label} className="statCard">
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </article>
          ))}
        </section>

        {recentSearches.length > 0 ? (
          <section className="recentSearches">
            <h2 className="recentSearchesTitle">Recent Searches</h2>
            <div className="recentSearchList">
              {recentSearches.map((s) => (
                <button
                  key={s.query}
                  className="recentSearchItem"
                  type="button"
                  onClick={() => {
                    setQuery(s.query);
                    setActivePage("search");
                  }}
                >
                  <span className="recentSearchQuery">{s.query}</span>
                  <span className="recentSearchMeta">
                    {s.count} leads · {new Date(s.fetchedAt).toLocaleDateString()}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="dashboardPanels">
          <article className="dashboardPanel">
            <h2>Search Coverage</h2>
            <p>
              Current ICP: <strong>{query}</strong>
            </p>
            <p>
              Role filter:{" "}
              <strong>
                {filters.personas
                  .map((persona) => (persona === "custom" ? filters.customPersona || "Custom role" : PERSONA_LABELS[persona]))
                  .join(", ")}
              </strong>
            </p>
            <p>
              States: <strong>{filters.states.length === 0 ? "Nationwide" : filters.states.length === US_STATES.length ? "All states" : `${filters.states.length} selected`}</strong> · Minimum employees: <strong>{filters.employeeMin}</strong>
            </p>
          </article>

          <article className="dashboardPanel">
            <h2>The Sales Playbook</h2>
            <p>Find the right location, anchor the pitch in real workplace pain points, then push a polished email straight into Gmail — ready to send.</p>
            <div className="inlineActions">
              <button className="primaryButton" type="button" onClick={() => setActivePage("search")}>
                Go to Search
              </button>
              <button className="secondaryButton" type="button" onClick={() => setActivePage("drafts")}>
                Review Drafts
              </button>
            </div>
          </article>
        </section>

        <section className="creditsPanel">
          <article className="creditServiceCard">
            <div className="creditServiceHeader">
              <ArrowUpRight size={16} />
              <strong>Apollo</strong>
            </div>
            <p className="creditMuted">Free search runs through Apollo first. Optional review-stage email enrichment can use Apollo credits.</p>
            <a
              className="secondaryLink creditDashLink"
              href="https://app.apollo.io/#/settings/credits/current"
              target="_blank"
              rel="noreferrer"
            >
              View usage dashboard <ArrowUpRight size={13} />
            </a>
          </article>

          <article className="creditServiceCard">
            <div className="creditServiceHeader">
              <ArrowUpRight size={16} />
              <strong>Tavily</strong>
            </div>
            <p className="creditMuted">Tavily does not expose credit balance via API.</p>
            <a
              className="secondaryLink creditDashLink"
              href="https://app.tavily.com"
              target="_blank"
              rel="noreferrer"
            >
              View usage dashboard <ArrowUpRight size={13} />
            </a>
          </article>

          <article className="creditServiceCard">
            <div className="creditServiceHeader">
              <ArrowUpRight size={16} />
              <strong>Tomba</strong>
            </div>
            <p className="creditMuted">Fallback email finder — only used after you review a lead and Apollo enrichment still doesn't return an email.</p>
            <a
              className="secondaryLink creditDashLink"
              href="https://app.tomba.io"
              target="_blank"
              rel="noreferrer"
            >
              View usage dashboard <ArrowUpRight size={13} />
            </a>
          </article>
        </section>
      </>
    );
  }

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brandBlock">
          <h2>FF Lead Gen Hub</h2>
          <p>Find leads. Close deals.</p>
        </div>

        <nav className="sidebarNav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activePage;
            const badge =
              item.id === "search" && (selectedCompany ? leads.length > 0 : companies.length > 0)
                ? selectedCompany
                  ? leads.length
                  : companies.length
                : item.id === "drafts" && drafts.length > 0
                  ? drafts.length
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
        {activePage === "search" ? renderSearchPage() : null}
        {activePage === "drafts" ? renderDraftsPage() : null}
      </section>
    </main>
  );
}
