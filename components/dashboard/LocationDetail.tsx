"use client";

import { useState, useMemo, useEffect, useRef, useTransition } from "react";
import {
  ArrowLeft,
  Building2,
  ChevronDown,
  ChevronUp,
  Mail,
  Plus,
  RefreshCw,
  Sparkles
} from "lucide-react";
import { MAX_CONTACT_SEARCH_LIMIT } from "@/lib/constants";
import { isLowSignalPitch } from "@/lib/utils";
import type {
  DepartmentFilter,
  EnrichEmailResponse,
  EmailLookupState,
  EmailSource,
  FollowUpDraft,
  GeneratedPitch,
  LeadRecord,
  LocationDetail as LocationDetailType,
  LocationType,
  PipelineStage,
  PitchType,
  ResearchState,
  SavedLocation
} from "./types";
import {
  DEPARTMENT_FILTER_LABELS,
  LOCATION_TYPE_LABELS,
  PIPELINE_STAGE_LABELS,
  PITCH_TYPE_LABELS,
  formatCompanyMeta,
  isPreviewLocationId
} from "./utils";

type Props = {
  locationDetail: LocationDetailType;
  currentContactSearchLimit: number;
  nextContactSearchIncrement: number;
  loadingLocationId: string | null;
  pageError: string | null;
  pageSuccess: string | null;
  setPageError: (msg: string | null) => void;
  setPageSuccess: (msg: string | null) => void;
  onBack: () => void;
  onLoadContacts: (options?: { limit?: number }) => Promise<void>;
  onLoadMore: () => Promise<void>;
  onUpdateField: (field: "pipelineStage" | "locationType" | "pitchType", value: string) => Promise<void>;
  onSaveNotes: (notes: string) => Promise<void>;
  onSequenceQueued: (locationId: string) => Promise<void>;
};

export function LocationDetail({
  locationDetail,
  currentContactSearchLimit,
  nextContactSearchIncrement,
  loadingLocationId,
  pageError,
  pageSuccess,
  setPageError,
  setPageSuccess,
  onBack,
  onLoadContacts,
  onLoadMore,
  onUpdateField,
  onSaveNotes,
  onSequenceQueued
}: Props) {
  const currentLocation = locationDetail.location;
  const currentContacts = locationDetail.contacts;
  const currentLocationEmails = locationDetail.emails;
  const isPreviewLocation = isPreviewLocationId(currentLocation.id);

  const [notesDraft, setNotesDraft] = useState(currentLocation.notes || "");
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
  const [activeEmailTabByLeadId, setActiveEmailTabByLeadId] = useState<Record<string, 1 | 2 | 3>>({});
  const [pitchPending, startPitchTransition] = useTransition();
  const [draftPending, startDraftTransition] = useTransition();
  const [savePending, startSaveTransition] = useTransition();

  // Sync notes when location changes
  useEffect(() => {
    setNotesDraft(currentLocation.notes || "");
  }, [currentLocation.id, currentLocation.notes]);

  const visibleContacts = useMemo(() => {
    return currentContacts.filter((record) => {
      const matchesQuery = contactSearch.trim()
        ? [record.lead.name, record.lead.email, record.lead.title, record.lead.companyName, record.lead.department]
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
      { facilities: 0, hr_people: 0, workplace: 0, fnb: 0, csuite: 0, other: 0 }
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

  function replaceLeadRecord(nextRecord: LeadRecord) {
    // No-op: contact enrichment (email lookup) updates the lead's email in place.
    // The contacts array lives in the parent's locationDetail, but for display purposes
    // we track email lookup state separately (emailLookupStateByLeadId / emailSourceByLeadId).
    // When email lookup succeeds, the enriched record is returned from ensureLeadEmail
    // and used directly for pitch/draft calls — we don't need to push it back to the parent
    // since the parent's contacts array is only refreshed on explicit "Refresh Contacts".
    void nextRecord;
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
      if (!response.ok || !data.leadRecord) throw new Error(data.error || "Email lookup failed.");

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
    if (!response.ok || !data.pitch) throw new Error(data.error || "Pitch generation failed.");
    return data.pitch;
  }

  async function fetchFollowUpWithRetry(record: LeadRecord, talkingPoints: string, step: 2 | 3): Promise<GeneratedPitch> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await fetchPitch(record, talkingPoints, step);
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Follow-up draft generation failed.");
  }

  async function generateFollowUps(record: LeadRecord, talkingPoints: string): Promise<{ followUp1: FollowUpDraft; followUp2: FollowUpDraft } | null> {
    try {
      const fu1 = await fetchFollowUpWithRetry(record, talkingPoints, 2);
      const fu2 = await fetchFollowUpWithRetry(record, talkingPoints, 3);
      const next = {
        followUp1: { subject: fu1.subject, body: fu1.body },
        followUp2: { subject: fu2.subject, body: fu2.body }
      };

      setResearchByLeadId((current) => {
        const existing = current[record.lead.id];
        if (!existing) return current;
        return { ...current, [record.lead.id]: { ...existing, sequenceStatus: "ready", sequenceError: undefined, ...next } };
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
    if (existingResearch && !isLowSignalPitch(existingResearch.pitch)) return existingResearch;

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

      setResearchByLeadId((current) => ({ ...current, [record.lead.id]: nextResearch }));
      setExpandedLeadId(record.lead.id);
      void generateFollowUps(record, pitch.talkingPoints);
      return nextResearch;
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Pitch generation failed.");
      return null;
    }
  }

  function researchLead(record: LeadRecord, talkingPointsOverride?: string) {
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

    let failedCount = 0;

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
        failedCount += 1;
      }

      setBulkResearchProgress((prev) => (prev ? { ...prev, completed: prev.completed + 1 } : null));
    }

    setBulkResearchProgress((prev) => (prev ? { ...prev, active: false } : null));
    setIsBulkResearching(false);

    if (failedCount > 0) {
      setPageError(
        `${failedCount} of ${unresearched.length} contact${unresearched.length === 1 ? "" : "s"} failed to generate a pitch. You can retry them individually.`
      );
    }
  }

  function queueLeadSequence(record: LeadRecord) {
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
        if (!research) throw new Error("Research is required before queuing the sequence.");

        let followUp1 = research.followUp1;
        let followUp2 = research.followUp2;

        if (!followUp1 || !followUp2) {
          const generated = await generateFollowUps(draftRecord, research.talkingPoints);
          followUp1 = generated?.followUp1;
          followUp2 = generated?.followUp2;
        }

        if (!followUp1 || !followUp2) {
          throw new Error("We couldn't generate the full 3-email sequence yet, so nothing was saved. Try Queue Sequence again.");
        }

        const sequence = [
          {
            locationId: currentLocation.id,
            contactName: draftRecord.lead.name,
            contactEmail: draftRecord.lead.email,
            contactTitle: draftRecord.lead.title,
            companyName: draftRecord.lead.companyName,
            locationType: currentLocation.locationType,
            sequenceStep: 1,
            subject: research.pitch.subject,
            body: research.pitch.body,
            status: "generated" as const
          },
          {
            locationId: currentLocation.id,
            contactName: draftRecord.lead.name,
            contactEmail: draftRecord.lead.email,
            contactTitle: draftRecord.lead.title,
            companyName: draftRecord.lead.companyName,
            locationType: currentLocation.locationType,
            sequenceStep: 2,
            subject: followUp1.subject,
            body: followUp1.body,
            status: "generated" as const
          },
          {
            locationId: currentLocation.id,
            contactName: draftRecord.lead.name,
            contactEmail: draftRecord.lead.email,
            contactTitle: draftRecord.lead.title,
            companyName: draftRecord.lead.companyName,
            locationType: currentLocation.locationType,
            sequenceStep: 3,
            subject: followUp2.subject,
            body: followUp2.body,
            status: "generated" as const
          }
        ];

        const response = await fetch("/api/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: draftRecord.lead.id, emails: sequence })
        });

        const data = (await response.json()) as { emails?: { id: string }[]; error?: string };
        if (!response.ok || !data.emails) throw new Error(data.error || "Failed to save sequence.");

        await onSequenceQueued(currentLocation.id);
        setPageSuccess(`${data.emails.length}-step outreach sequence queued for ${draftRecord.lead.name}.`);
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Failed to queue sequence.");
      }
    });
  }

  function saveLocationNotes() {
    if (isPreviewLocation) {
      setPageError("Preview mode is read-only. Run the database migration first to save notes.");
      return;
    }

    startSaveTransition(async () => {
      try {
        await onSaveNotes(notesDraft);
        setPageSuccess("Notes saved.");
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Failed to save notes.");
      }
    });
  }

  function updateTalkingPoints(leadId: string, value: string) {
    setResearchByLeadId((current) => {
      const research = current[leadId];
      if (!research) return current;
      return { ...current, [leadId]: { ...research, talkingPoints: value } };
    });
  }

  function resetContactFilters() {
    setContactSearch("");
    setDepartmentFilter("all");
  }

  return (
    <>
      <header className="pageHeader">
        <div>
          <button className="backLink" type="button" onClick={onBack}>
            <ArrowLeft size={16} />
            Back to Locations
          </button>
          <h1>{currentLocation.companyName}</h1>
          <p>
            {currentLocation.companyDomain || "No domain"} · {formatCompanyMeta(currentLocation) || "Location unavailable"}
          </p>
        </div>
      </header>

      {pageError ? <p className="error">{pageError}</p> : null}
      {pageSuccess ? <p className="success">{pageSuccess}</p> : null}

      <section className="detailToolbarCard">
        <div className="detailToolbar">
          <div className="detailSelect">
            <label>Pipeline</label>
            <select
              value={currentLocation.pipelineStage}
              disabled={isPreviewLocation}
              onChange={(event) => void onUpdateField("pipelineStage", event.target.value)}
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
              onChange={(event) => void onUpdateField("locationType", event.target.value)}
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
              onChange={(event) => void onUpdateField("pitchType", event.target.value)}
            >
              {(Object.keys(PITCH_TYPE_LABELS) as PitchType[]).map((pitchType) => (
                <option key={pitchType} value={pitchType}>
                  {PITCH_TYPE_LABELS[pitchType]}
                </option>
              ))}
            </select>
          </div>

          <button
            className="primaryButton"
            type="button"
            onClick={() => void researchAllLeads()}
            disabled={pitchPending || currentContacts.length === 0}
          >
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
            <span>search depth {currentContactSearchLimit}</span>
            <span>{currentLocationEmails.length} queued emails</span>
          </div>
          {isPreviewLocation ? (
            <p className="helperText">
              Preview mode is active because pipeline storage is not available yet. You can review contacts and run research, but notes, pipeline fields, and queued emails are disabled until the DB migration is run.
            </p>
          ) : null}
        </article>

        <article className="dashboardPanel">
          <h2>Notes &amp; Insights</h2>
          <textarea
            className="detailNotes"
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
            disabled={isPreviewLocation}
            placeholder="Capture account context, food access notes, stakeholder hints, and operational cues here..."
          />
          <div className="inlineActions">
            <button
              className="secondaryButton"
              type="button"
              onClick={() => setNotesDraft(currentLocation.notes || "")}
              disabled={isPreviewLocation}
            >
              Reset
            </button>
            <button
              className="primaryButton"
              type="button"
              onClick={saveLocationNotes}
              disabled={savePending || isPreviewLocation}
            >
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
              {currentContacts.length > 0 ? ` Search depth: ${currentContactSearchLimit}.` : ""}
            </p>
          </div>
          <div className="sectionControls">
            <input
              className="compactInput"
              value={contactSearch}
              onChange={(event) => setContactSearch(event.target.value)}
              placeholder="Filter by name, email, title, or department..."
            />
            <button
              className="secondaryButton"
              type="button"
              onClick={() => void onLoadContacts()}
              disabled={loadingLocationId === currentLocation.id}
            >
              <RefreshCw size={15} />
              {loadingLocationId === currentLocation.id ? "Loading..." : currentContacts.length > 0 ? "Refresh Contacts" : "Find Contacts"}
            </button>
            {currentContacts.length > 0 ? (
              <button
                className="secondaryButton"
                type="button"
                onClick={() => void onLoadMore()}
                disabled={loadingLocationId === currentLocation.id || nextContactSearchIncrement === 0}
              >
                <Plus size={15} />
                {nextContactSearchIncrement > 0
                  ? `Search ${nextContactSearchIncrement} More`
                  : `Max ${MAX_CONTACT_SEARCH_LIMIT}`}
              </button>
            ) : null}
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
                        onClick={() => researchLead(record, research?.talkingPoints)}
                        disabled={pitchPending}
                        title={research ? "Refresh research" : "Research contact"}
                      >
                        <Sparkles size={16} />
                      </button>
                      <button
                        className={`iconButton${hasQueuedEmails ? " iconButton--done" : ""}`}
                        type="button"
                        onClick={() => queueLeadSequence(record)}
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
                          <div className="emailSequencePreview">
                            <div className="sequenceTabs">
                              {([1, 2, 3] as const).map((step) => {
                                const labels = ["Email 1", "Follow-up 1", "Follow-up 2"];
                                const available =
                                  step === 1 ||
                                  (step === 2 && !!research.followUp1) ||
                                  (step === 3 && !!research.followUp2);
                                const active = (activeEmailTabByLeadId[record.lead.id] ?? 1) === step;
                                return (
                                  <button
                                    key={step}
                                    type="button"
                                    className={`sequenceTab${active ? " active" : ""}`}
                                    disabled={!available}
                                    onClick={() =>
                                      setActiveEmailTabByLeadId((prev) => ({ ...prev, [record.lead.id]: step }))
                                    }
                                  >
                                    <span className="sequenceTabDot" />
                                    {labels[step - 1]}
                                  </button>
                                );
                              })}
                            </div>
                            {(() => {
                              const tab = activeEmailTabByLeadId[record.lead.id] ?? 1;
                              const email =
                                tab === 1 ? research.pitch : tab === 2 ? research.followUp1 : research.followUp2;
                              if (!email) return null;
                              return (
                                <div className="emailPreviewContent">
                                  <div className="emailPreviewSubject">{email.subject}</div>
                                  <pre className="emailPreviewBody">{email.body}</pre>
                                </div>
                              );
                            })()}
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
                              <button
                                className="secondaryButton"
                                type="button"
                                onClick={() => researchLead(record, research.talkingPoints)}
                              >
                                <RefreshCw size={16} />
                                Regenerate
                              </button>
                              <button
                                className="primaryButton"
                                type="button"
                                onClick={() => queueLeadSequence(record)}
                                disabled={isPreviewLocation}
                              >
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
                              <button
                                className="secondaryButton"
                                type="button"
                                onClick={() => researchLead(record)}
                                disabled={pitchPending}
                              >
                                <Sparkles size={16} />
                                {pitchPending ? "Researching..." : "Research Contact"}
                              </button>
                              <button
                                className="primaryButton"
                                type="button"
                                onClick={() => queueLeadSequence(record)}
                                disabled={draftPending || isPreviewLocation}
                              >
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
