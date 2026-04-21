"use client";

import { useState, useMemo, useTransition } from "react";
import { ArrowRight, Building2, Search, Trash2, Upload } from "lucide-react";
import { CONTACT_SEARCH_INCREMENT, DEFAULT_SEARCH_FILTERS, PERSONA_LABELS } from "@/lib/constants";
import type {
  ApolloCreditEstimate,
  LocationType,
  PipelineStage,
  ProspectCompany,
  SavedLocationSummary,
  SearchFilters
} from "./types";
import {
  LOCATION_TYPE_LABELS,
  PIPELINE_STAGE_LABELS,
  US_STATES,
  formatCompanyMeta,
  isPipelineStorageError
} from "./utils";

type Props = {
  locations: SavedLocationSummary[];
  loadingLocationId: string | null;
  pageError: string | null;
  pageSuccess: string | null;
  setPageError: (msg: string | null) => void;
  setPageSuccess: (msg: string | null) => void;
  onOpenLocation: (locationId: string) => void;
  onDeleteLocation: (locationId: string) => void;
  onOpenCompany: (company: ProspectCompany) => void;
  onSaveCompany: (company: ProspectCompany) => void;
};

export function SearchPanel({
  locations,
  loadingLocationId,
  pageError,
  pageSuccess,
  setPageError,
  setPageSuccess,
  onOpenLocation,
  onDeleteLocation,
  onOpenCompany,
  onSaveCompany
}: Props) {
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
  const [companies, setCompanies] = useState<ProspectCompany[]>([]);
  const [creditEstimate, setCreditEstimate] = useState<ApolloCreditEstimate | null>(null);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationTypeFilter, setLocationTypeFilter] = useState<LocationType | "all">("all");
  const [pipelineStageFilter, setPipelineStageFilter] = useState<PipelineStage | "all">("all");
  const [searchPending, startSearchTransition] = useTransition();

  const visibleLocations = useMemo(() => {
    return locations.filter((location) => {
      const matchesQuery = locationQuery.trim()
        ? [location.companyName, location.companyDomain, location.industry, location.category, location.hqCity, location.hqState]
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

  async function runSearchWithQuery(nextQuery: string, nextLimit?: number) {
    setPageError(null);
    setPageSuccess(null);

    const payload = { ...filters, industryQuery: nextQuery, limit: nextLimit ?? filters.limit };

    startSearchTransition(async () => {
      try {
        const response = await fetch("/api/companies/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const data = (await response.json()) as {
          companies?: ProspectCompany[];
          creditEstimate?: ApolloCreditEstimate;
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || "Search failed.");

        setHasSearched(true);
        setQuery(nextQuery);
        setCompanies(data.companies ?? []);
        setCreditEstimate(data.creditEstimate ?? null);
        setFilters((current) => ({ ...current, limit: payload.limit }));
        setLimitInput(String(payload.limit));
      } catch (error) {
        setPageError(error instanceof Error ? error.message : "Search failed.");
      }
    });
  }

  async function runSearch() {
    await runSearchWithQuery(query);
  }

  async function runBulkImport() {
    const lines = bulkInput.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      setPageError("Paste at least one company, domain, or market query for bulk import.");
      return;
    }
    setQuery(lines[0] || query);
    await runSearchWithQuery(lines[0] || query, Math.min(Math.max(lines.length, 10), 20));
  }

  async function handleOpenCompany(company: ProspectCompany) {
    try {
      onOpenCompany(company);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open company.";
      setPageError(isPipelineStorageError(message)
        ? "Pipeline saving is unavailable because the database migration has not been run yet."
        : message);
    }
  }

  async function handleSaveCompany(company: ProspectCompany) {
    try {
      onSaveCompany(company);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save location.";
      setPageError(isPipelineStorageError(message)
        ? "Pipeline saving is unavailable because the database migration has not been run yet."
        : message);
    }
  }

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

      {pageError ? <p className="error">{pageError}</p> : null}
      {pageSuccess ? <p className="success">{pageSuccess}</p> : null}

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
                const nextLimit = Number.isFinite(parsed) ? Math.max(1, Math.min(50, parsed)) : filters.limit;
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
                    <button className="secondaryButton" type="button" onClick={() => void handleSaveCompany(company)}>
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
            <p>No companies came back for &ldquo;{query}&rdquo;. Try a broader market, location, or company name.</p>
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
                    <button className="iconButton" type="button" onClick={() => void onDeleteLocation(location.id)}>
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
                    <button
                      className="iconButton"
                      type="button"
                      onClick={() => void onOpenLocation(location.id)}
                      disabled={loadingLocationId === location.id}
                    >
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
