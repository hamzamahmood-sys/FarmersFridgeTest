"use client";

import { useEffect, useRef, useState } from "react";
import { CONTACT_SEARCH_INCREMENT, MAX_CONTACT_SEARCH_LIMIT } from "@/lib/constants";
import type {
  DashboardStats,
  GmailStatus,
  LocationDetail,
  LocationType,
  NavPage,
  PipelineStage,
  PitchType,
  ProspectCompany,
  SavedLocation,
  SavedLocationSummary,
  SearchFilters,
  StoredEmail,
  ToneSettings
} from "./dashboard/types";
import {
  companyToPreviewLocation,
  isPipelineStorageError,
  isPreviewLocationId,
  locationToProspectCompany,
  navItems
} from "./dashboard/utils";
import { DashboardPage } from "./dashboard/DashboardPage";
import { SearchPanel } from "./dashboard/SearchPanel";
import { LocationDetail as LocationDetailPanel } from "./dashboard/LocationDetail";
import { EmailsPage } from "./dashboard/EmailsPage";
import { TonePage } from "./dashboard/TonePage";

type LocationListResponse = { locations: SavedLocationSummary[] };
type DashboardResponse = { stats: DashboardStats; recentLocations: SavedLocationSummary[] };
type EmailsResponse = { emails: StoredEmail[] };
type ToneResponse = { tone: ToneSettings };

export function OutreachDashboard() {
  const [activePage, setActivePage] = useState<NavPage>("dashboard");
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageSuccess, setPageSuccess] = useState<string | null>(null);

  // Shared data
  const [locations, setLocations] = useState<SavedLocationSummary[]>([]);
  const [emails, setEmails] = useState<StoredEmail[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>({
    locationsCount: 0,
    draftsCount: 0,
    wonCount: 0,
    dueTodayCount: 0,
    repliedCount: 0,
    highFitCount: 0,
    averageFitScore: 0,
    pipelineByStage: { prospect: 0, meeting: 0, won: 0, lost: 0 },
    byLocationType: { hospital: 0, corporate: 0, university: 0, gym: 0, airport: 0, other: 0 }
  });
  const [recentLocations, setRecentLocations] = useState<SavedLocationSummary[]>([]);
  const [initialToneSettings, setInitialToneSettings] = useState<ToneSettings>({
    voiceDescription: "",
    doExamples: "",
    dontExamples: "",
    sampleEmail: ""
  });

  // Location selection
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [locationDetail, setLocationDetail] = useState<LocationDetail | null>(null);
  const [loadingLocationId, setLoadingLocationId] = useState<string | null>(null);
  const [contactLimitByLocationId, setContactLimitByLocationId] = useState<Record<string, number>>({});

  // Gmail
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);

  // Prevents double-firing loadContactsForLocation on rapid "Load More" clicks
  const contactLoadInFlightRef = useRef(false);

  const currentLocation = locationDetail?.location ?? null;
  const isPreviewLocation = isPreviewLocationId(currentLocation?.id);

  function clampContactSearchLimit(limit: number): number {
    return Math.max(1, Math.min(MAX_CONTACT_SEARCH_LIMIT, Math.floor(limit)));
  }

  function getContactSearchLimit(location: SavedLocation | null | undefined): number {
    if (!location) return clampContactSearchLimit(10);
    const requestedLimit = contactLimitByLocationId[location.id];
    if (typeof requestedLimit === "number" && Number.isFinite(requestedLimit)) {
      return clampContactSearchLimit(requestedLimit);
    }
    const currentContacts = locationDetail?.contacts ?? [];
    if (currentLocation?.id === location.id && currentContacts.length > 0) {
      return clampContactSearchLimit(currentContacts.length);
    }
    return clampContactSearchLimit(10);
  }

  const currentContactSearchLimit = getContactSearchLimit(currentLocation);
  const nextContactSearchIncrement = Math.min(
    CONTACT_SEARCH_INCREMENT,
    Math.max(0, MAX_CONTACT_SEARCH_LIMIT - currentContactSearchLimit)
  );

  useEffect(() => {
    void refreshInitialData();
  }, []);

  async function refreshInitialData() {
    await Promise.all([refreshGmailStatus(), loadDashboard(), loadLocations(), loadEmails(), loadTone()]);
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
    if (!response.ok) throw new Error(data.error || "Failed to load dashboard.");
    setDashboardStats(data.stats);
    setRecentLocations(data.recentLocations);
  }

  async function loadLocations() {
    const response = await fetch("/api/locations");
    const data = (await response.json()) as LocationListResponse & { error?: string };
    if (!response.ok) throw new Error(data.error || "Failed to load locations.");
    setLocations(data.locations);
  }

  async function loadEmails() {
    const response = await fetch("/api/emails");
    const data = (await response.json()) as EmailsResponse & { error?: string };
    if (!response.ok) throw new Error(data.error || "Failed to load emails.");
    setEmails(data.emails);
  }

  async function loadTone() {
    const response = await fetch("/api/tone");
    const data = (await response.json()) as ToneResponse & { error?: string };
    if (!response.ok) throw new Error(data.error || "Failed to load tone settings.");
    setInitialToneSettings(data.tone);
  }

  async function openLocation(locationId: string) {
    setLoadingLocationId(locationId);
    setPageError(null);
    setPageSuccess(null);

    try {
      const response = await fetch(`/api/locations/${locationId}`);
      const data = (await response.json()) as LocationDetail & { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to load location.");

      setSelectedLocationId(locationId);
      setLocationDetail(data);
      setContactLimitByLocationId((current) => {
        if (data.contacts.length === 0) return current;
        const nextLimit = Math.max(current[locationId] ?? 0, data.contacts.length);
        if (nextLimit === current[locationId]) return current;
        return { ...current, [locationId]: nextLimit };
      });
      setActivePage("contacts");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to load location.");
    } finally {
      setLoadingLocationId(null);
    }
  }

  async function saveCompanyToPipeline(company: ProspectCompany): Promise<SavedLocation> {
    const response = await fetch("/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company })
    });
    const data = (await response.json()) as { location: SavedLocation; error?: string };
    if (!response.ok || !data.location) throw new Error(data.error || "Failed to save location.");
    await Promise.all([loadLocations(), loadDashboard()]);
    setPageSuccess(`${company.name} saved to the pipeline.`);
    return data.location;
  }

  async function handleSaveCompany(company: ProspectCompany) {
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
        setLocationDetail({ location: previewLocation, contacts: [], emails: [], researchEvidence: [] });
        setActivePage("contacts");
        setPageError(null);
        setPageSuccess("Opened in preview mode. Pipeline saving is unavailable until the database migration is run.");
        await loadContactsForLocation(previewLocation);
        return;
      }

      setPageError(message);
    }
  }

  async function loadContactsForLocation(
    locationArg?: SavedLocation,
    options?: {
      limit?: number;
      personas?: SearchFilters["personas"];
      customPersona?: string;
    }
  ) {
    const location = locationArg || currentLocation;
    if (!location) return;
    if (contactLoadInFlightRef.current) return;

    const requestedLimit = clampContactSearchLimit(options?.limit ?? getContactSearchLimit(location));
    const preservedEmails = currentLocation?.id === location.id ? (locationDetail?.emails ?? []) : [];

    const defaultPersonas: SearchFilters["personas"] = [
      "office_manager",
      "facilities_director",
      "workplace_experience",
      "hr",
      "csuite"
    ];
    const personas = options?.personas && options.personas.length > 0 ? options.personas : defaultPersonas;

    contactLoadInFlightRef.current = true;
    setLoadingLocationId(location.id);
    setPageError(null);

    try {
      const response = await fetch("/api/leads/by-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: locationToProspectCompany(location),
          filters: {
            personas,
            customPersona: options?.customPersona,
            industryQuery: location.companyName,
            states: [],
            employeeMin: 50,
            limit: requestedLimit
          },
          searchQuery: location.companyName,
          locationId: isPreviewLocationId(location.id) ? undefined : location.id
        })
      });

      const data = (await response.json()) as { leads?: import("@/lib/types").LeadRecord[]; error?: string };
      if (!response.ok || !data.leads) throw new Error(data.error || "Failed to load contacts.");

      setContactLimitByLocationId((current) =>
        current[location.id] === requestedLimit ? current : { ...current, [location.id]: requestedLimit }
      );
      setLocationDetail((current) =>
        current && current.location.id === location.id
          ? { ...current, contacts: data.leads ?? [] }
          : { location, contacts: data.leads ?? [], emails: preservedEmails, researchEvidence: [] }
      );

      await Promise.all([loadLocations(), loadDashboard()]);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to load contacts.");
    } finally {
      contactLoadInFlightRef.current = false;
      setLoadingLocationId(null);
    }
  }

  async function discoverContactsWithAI() {
    if (!currentLocation || isPreviewLocation) {
      setPageError("AI contact discovery is unavailable in preview mode.");
      return;
    }

    setLoadingLocationId(currentLocation.id);
    setPageError(null);
    setPageSuccess(null);

    try {
      const response = await fetch("/api/leads/ai-discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: currentLocation.id })
      });

      const data = (await response.json()) as {
        leads?: import("@/lib/types").LeadRecord[];
        foundCount?: number;
        error?: string;
      };

      if (!response.ok) throw new Error(data.error || "AI contact discovery failed.");

      // Merge AI-discovered contacts with the existing list (dedupe by lead id).
      setLocationDetail((current) => {
        if (!current || current.location.id !== currentLocation.id) return current;
        const existingIds = new Set(current.contacts.map((record) => record.lead.id));
        const additions = (data.leads ?? []).filter((record) => !existingIds.has(record.lead.id));
        return { ...current, contacts: [...current.contacts, ...additions] };
      });

      await Promise.all([loadLocations(), loadDashboard()]);

      const count = data.foundCount ?? 0;
      setPageSuccess(
        count > 0
          ? `AI found ${count} named contact${count === 1 ? "" : "s"} from public sources.`
          : "AI search didn't find any named contacts in public sources for this company."
      );
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "AI contact discovery failed.");
    } finally {
      setLoadingLocationId(null);
    }
  }

  async function deleteLocation(locationId: string) {
    if (isPreviewLocationId(locationId)) {
      setSelectedLocationId(null);
      setLocationDetail(null);
      setPageSuccess("Closed preview.");
      return;
    }

    try {
      const response = await fetch(`/api/locations/${locationId}`, { method: "DELETE" });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Failed to delete location.");

      if (selectedLocationId === locationId) {
        setSelectedLocationId(null);
        setLocationDetail(null);
      }

      await Promise.all([loadLocations(), loadDashboard(), loadEmails()]);
      setPageSuccess("Location removed from the pipeline.");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to delete location.");
    }
  }

  async function updateCurrentLocationField(
    field: "pipelineStage" | "locationType" | "pitchType",
    value: string
  ) {
    if (!currentLocation || isPreviewLocation) {
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
      if (!response.ok || !data.location) throw new Error(data.error || "Failed to update location.");
      await Promise.all([openLocation(currentLocation.id), loadLocations(), loadDashboard()]);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to update location.");
    }
  }

  async function saveLocationNotes(notes: string) {
    if (!currentLocation || isPreviewLocation) return;
    const response = await fetch(`/api/locations/${currentLocation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes })
    });
    const data = (await response.json()) as { location?: SavedLocation; error?: string };
    if (!response.ok || !data.location) throw new Error(data.error || "Failed to save notes.");
    await Promise.all([openLocation(currentLocation.id), loadLocations(), loadDashboard()]);
  }

  async function handleSequenceQueued(locationId: string) {
    await Promise.all([loadEmails(), loadDashboard(), openLocation(locationId)]);
    setActivePage("emails");
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
              item.id === "contacts" ? locations.length : item.id === "emails" ? emails.length : null;

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
        {activePage === "dashboard" ? (
          <DashboardPage
            stats={dashboardStats}
            recentLocations={recentLocations}
            pageError={pageError}
            pageSuccess={pageSuccess}
            onNavigate={setActivePage}
            onOpenLocation={(id) => void openLocation(id)}
          />
        ) : null}

        {activePage === "contacts" ? (
          selectedLocationId && locationDetail ? (
            <LocationDetailPanel
              key={selectedLocationId}
              locationDetail={locationDetail}
              currentContactSearchLimit={currentContactSearchLimit}
              nextContactSearchIncrement={nextContactSearchIncrement}
              loadingLocationId={loadingLocationId}
              pageError={pageError}
              pageSuccess={pageSuccess}
              setPageError={setPageError}
              setPageSuccess={setPageSuccess}
              onBack={() => {
                setSelectedLocationId(null);
                setLocationDetail(null);
              }}
              onLoadContacts={(options) => loadContactsForLocation(undefined, options)}
              onDiscoverWithAI={discoverContactsWithAI}
              onUpdateField={updateCurrentLocationField}
              onSaveNotes={saveLocationNotes}
              onSequenceQueued={handleSequenceQueued}
            />
          ) : (
            <SearchPanel
              locations={locations}
              loadingLocationId={loadingLocationId}
              pageError={pageError}
              pageSuccess={pageSuccess}
              setPageError={setPageError}
              setPageSuccess={setPageSuccess}
              onOpenLocation={(id) => void openLocation(id)}
              onDeleteLocation={(id) => void deleteLocation(id)}
              onOpenCompany={(company) => void handleOpenCompany(company)}
              onSaveCompany={(company) => void handleSaveCompany(company)}
            />
          )
        ) : null}

        {activePage === "emails" ? (
          <EmailsPage
            emails={emails}
            gmailStatus={gmailStatus}
            pageError={pageError}
            pageSuccess={pageSuccess}
            setPageError={setPageError}
            setPageSuccess={setPageSuccess}
            onEmailsChanged={loadEmails}
            onGmailStatusChanged={refreshGmailStatus}
          />
        ) : null}

        {activePage === "tone" ? (
          <TonePage
            key={initialToneSettings.updatedAt ?? "init"}
            initialToneSettings={initialToneSettings}
            pageError={pageError}
            pageSuccess={pageSuccess}
            setPageError={setPageError}
            setPageSuccess={setPageSuccess}
          />
        ) : null}
      </section>
    </main>
  );
}
