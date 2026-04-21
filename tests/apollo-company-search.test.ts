import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchCompanies, searchLeadsForCompany } from "@/lib/apollo/company-search";
import { apolloFetch } from "@/lib/apollo/client";
import type { ProspectCompany, SearchFilters } from "@/lib/types";

vi.mock("@/lib/apollo/client", () => ({
  apolloFetch: vi.fn()
}));

const mockApolloFetch = vi.mocked(apolloFetch);

const marketFilters: SearchFilters = {
  personas: ["office_manager"],
  industryQuery: "law firm NYC",
  states: [],
  employeeMin: 200,
  limit: 5
};

const selectedCompany: ProspectCompany = {
  id: "org-1",
  name: "Hudson Legal Group",
  domain: "hudsonlegal.com",
  priorityScore: 120,
  company: {
    industry: "Law Practice",
    employeeCount: 450,
    hqCity: "New York",
    hqState: "New York",
    hqCountry: "United States",
    keywords: ["law"],
    techStack: [],
    about: "Large NYC law firm.",
    deliveryZone: "NYC"
  }
};

describe("company-first Apollo search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds matching companies for market queries before loading people", async () => {
    mockApolloFetch.mockImplementation(async (_path, body) => {
      const params = body as Record<string, unknown>;

      if (
        Array.isArray(params.organization_locations) &&
        params.organization_locations.includes("New York") &&
        Array.isArray(params.q_organization_keyword_tags) &&
        params.q_organization_keyword_tags.includes("law")
      ) {
        return {
          organizations: [
            {
              id: "org-noise",
              name: "United Nations",
              primary_domain: "un.org",
              industry: "International Affairs",
              estimated_num_employees: 10000,
              city: "New York",
              state: "New York",
              country: "United States",
              keywords: ["diplomacy"]
            },
            {
              id: "org-1",
              name: "Hudson Legal Group",
              primary_domain: "hudsonlegal.com",
              industry: "Law Practice",
              estimated_num_employees: 450,
              city: "New York",
              state: "New York",
              country: "United States",
              keywords: ["law"]
            }
          ]
        };
      }

      return { organizations: [] };
    });

    const companies = await searchCompanies(marketFilters);

    expect(companies).toHaveLength(1);
    expect(companies[0]?.name).toBe("Hudson Legal Group");
    expect(companies[0]?.company.deliveryZone).toBe("NYC");
  });

  it("loads contacts for a selected company using organization_ids", async () => {
    mockApolloFetch.mockImplementation(async (_path, body) => {
      const params = body as Record<string, unknown>;

      if (
        Array.isArray(params.organization_ids) &&
        params.organization_ids.includes("org-1") &&
        !("person_titles" in params)
      ) {
        return {
          people: [
            {
              id: "person-1",
              first_name: "Casey",
              last_name: "Morgan",
              title: "Practice Manager",
              has_email: true,
              email: "casey@hudsonlegal.com",
              organization_id: "org-1",
              organization_name: "Hudson Legal Group",
              organization: {
                name: "Hudson Legal Group",
                primary_domain: "hudsonlegal.com",
                industry: "Law Practice",
                estimated_num_employees: 450,
                city: "New York",
                state: "New York",
                country: "United States",
                keywords: ["law"]
              }
            }
          ]
        };
      }

      return { people: [] };
    });

    const leads = await searchLeadsForCompany(marketFilters, selectedCompany);

    expect(leads).toHaveLength(1);
    expect(leads[0]?.lead.companyName).toBe("Hudson Legal Group");
    expect(leads[0]?.lead.organizationId).toBe("org-1");
    expect(
      mockApolloFetch.mock.calls.some(([, body]) => {
        const params = body as Record<string, unknown>;
        return (
          Array.isArray(params.organization_ids) &&
          params.organization_ids.includes("org-1") &&
          !("person_titles" in params)
        );
      })
    ).toBe(true);
  });
});
