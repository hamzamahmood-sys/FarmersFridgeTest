"use client";

import { ArrowRight, Building2, Search } from "lucide-react";
import type { DashboardStats, NavPage, SavedLocationSummary } from "./types";
import { LOCATION_TYPE_LABELS, PIPELINE_STAGE_LABELS, formatCompanyMeta } from "./utils";

type Props = {
  stats: DashboardStats;
  recentLocations: SavedLocationSummary[];
  pageError: string | null;
  pageSuccess: string | null;
  onNavigate: (page: NavPage) => void;
  onOpenLocation: (locationId: string) => void;
};

export function DashboardPage({ stats, recentLocations, pageError, pageSuccess, onNavigate, onOpenLocation }: Props) {
  const stageRows = (Object.keys(PIPELINE_STAGE_LABELS) as Array<keyof typeof PIPELINE_STAGE_LABELS>).map((stage) => ({
    label: PIPELINE_STAGE_LABELS[stage],
    value: stats.pipelineByStage[stage]
  }));

  const locationTypeRows = (Object.keys(LOCATION_TYPE_LABELS) as Array<keyof typeof LOCATION_TYPE_LABELS>).map((type) => ({
    label: LOCATION_TYPE_LABELS[type],
    value: stats.byLocationType[type]
  }));

  return (
    <>
      <header className="pageHeader">
        <div>
          <h1>Dashboard</h1>
          <p>Farmers Fridge placement pipeline overview, from saved locations to drafted outreach.</p>
        </div>
        <div className="inlineActions">
          <button className="primaryButton" type="button" onClick={() => onNavigate("contacts")}>
            <Search size={16} />
            Find Contacts
          </button>
        </div>
      </header>

      {pageError ? <p className="error">{pageError}</p> : null}
      {pageSuccess ? <p className="success">{pageSuccess}</p> : null}

      <section className="dashboardGrid">
        <article className="statCard">
          <span>Locations</span>
          <strong>{stats.locationsCount}</strong>
        </article>
        <article className="statCard">
          <span>Due Today</span>
          <strong>{stats.dueTodayCount}</strong>
        </article>
        <article className="statCard">
          <span>Replies</span>
          <strong>{stats.repliedCount}</strong>
        </article>
        <article className="statCard">
          <span>Avg Fit</span>
          <strong>{stats.averageFitScore}</strong>
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
                    <span>{location.fitScore} fit</span>
                  </div>
                  {location.fitReasons.length > 0 ? (
                    <p className="fitReasonLine">{location.fitReasons.slice(0, 2).join(" · ")}</p>
                  ) : null}
                </div>
                <button className="iconButton" type="button" onClick={() => onOpenLocation(location.id)}>
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
