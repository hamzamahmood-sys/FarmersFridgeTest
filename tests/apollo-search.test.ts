import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchLeads } from "@/lib/apollo/search";
import { apolloFetch } from "@/lib/apollo/client";
import type { SearchFilters } from "@/lib/types";

vi.mock("@/lib/apollo/client", () => ({
  apolloFetch: vi.fn()
}));

const mockApolloFetch = vi.mocked(apolloFetch);

const baseFilters: SearchFilters = {
  personas: ["office_manager"],
  industryQuery: "Rush Hospital",
  states: [],
  employeeMin: 200,
  limit: 5
};

const marketFilters: SearchFilters = {
  personas: ["office_manager"],
  industryQuery: "law firm NYC",
  states: [],
  employeeMin: 200,
  limit: 5
};

const rushPerson = {
  id: "person-1",
  first_name: "Jordan",
  last_name: "Lee",
  title: "Administrative Director",
  has_email: true,
  organization_id: "org-1",
  organization: {
    name: "Rush University Medical Center",
    industry: "Hospital & Health Care",
    estimated_num_employees: 10000,
    city: "Chicago",
    state: "Illinois",
    country: "United States",
    primary_domain: "rush.edu"
  }
};

const lawFirmPerson = {
  id: "person-2",
  first_name: "Casey",
  last_name: "Morgan",
  title: "Managing Partner",
  has_email: true,
  organization_id: "org-2",
  organization: {
    name: "Hudson Legal Group",
    industry: "Law Practice",
    estimated_num_employees: 450,
    city: "New York",
    state: "New York",
    country: "United States",
    primary_domain: "hudsonlegal.com"
  }
};

describe("searchLeads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to company keywords without title filters for exact-company searches", async () => {
    mockApolloFetch.mockImplementation(async (_path, body) => {
      const params = body as Record<string, unknown>;

      if (params.q_keywords === "rush" && !("person_titles" in params)) {
        return { people: [rushPerson] };
      }

      return { people: [] };
    });

    const leads = await searchLeads(baseFilters);

    expect(leads).toHaveLength(1);
    expect(leads[0]?.lead.companyName).toBe("Rush University Medical Center");
    expect(leads[0]?.lead.department).toBe("workplace");
    expect(
      mockApolloFetch.mock.calls.some(([, body]) => {
        const params = body as Record<string, unknown>;
        return params.q_keywords === "rush" && !("person_titles" in params);
      })
    ).toBe(true);
    expect(
      mockApolloFetch.mock.calls.some(([, body]) => {
        const params = body as Record<string, unknown>;
        return (
          params.q_keywords === "rush" &&
          Array.isArray(params.organization_industries) &&
          params.organization_industries.includes("Hospital & Health Care")
        );
      })
    ).toBe(true);
  });

  it("surfaces Apollo request failures instead of returning an empty result set", async () => {
    mockApolloFetch.mockRejectedValue(
      new Error("Apollo request failed (401): Invalid access credentials.")
    );

    await expect(searchLeads(baseFilters)).rejects.toThrow("Invalid access credentials");
  });

  it("widens broad market searches when the title filter is too narrow", async () => {
    mockApolloFetch.mockImplementation(async (_path, body) => {
      const params = body as Record<string, unknown>;

      if (
        Array.isArray(params.organization_locations) &&
        params.organization_locations.includes("New York") &&
        Array.isArray(params.organization_industries) &&
        params.organization_industries.includes("Law Practice") &&
        !("person_titles" in params)
      ) {
        return { people: [lawFirmPerson] };
      }

      return { people: [] };
    });

    const leads = await searchLeads(marketFilters);

    expect(leads).toHaveLength(1);
    expect(leads[0]?.lead.companyName).toBe("Hudson Legal Group");
    expect(leads[0]?.lead.department).toBe("csuite");
    expect(
      mockApolloFetch.mock.calls.some(([, body]) => {
        const params = body as Record<string, unknown>;
        return (
          Array.isArray(params.organization_locations) &&
          params.organization_locations.includes("New York") &&
          Array.isArray(params.organization_industries) &&
          params.organization_industries.includes("Law Practice") &&
          !("person_titles" in params)
        );
      })
    ).toBe(true);
  });
});
