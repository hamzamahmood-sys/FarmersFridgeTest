import { beforeEach, describe, expect, it, vi } from "vitest";
import { enrichLeadContactFromApollo } from "@/lib/apollo/enrich";
import { apolloFetch } from "@/lib/apollo/client";
import type { LeadRecord } from "@/lib/types";

vi.mock("@/lib/apollo/client", () => ({
  apolloFetch: vi.fn()
}));

const mockApolloFetch = vi.mocked(apolloFetch);

const baseRecord: LeadRecord = {
  lead: {
    id: "lead-demo-1",
    name: "Jordan Lee",
    email: "",
    title: "Director of Workplace Experience",
    companyName: "Acme Health",
    companyDomain: "acmehealth.com"
  },
  company: {
    keywords: [],
    techStack: [],
    deliveryZone: "Other"
  },
  priorityScore: 1
};

describe("enrichLeadContactFromApollo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops Apollo placeholder emails so downstream fallbacks can still run", async () => {
    mockApolloFetch.mockResolvedValue({ person: undefined });

    const result = await enrichLeadContactFromApollo({
      ...baseRecord,
      lead: {
        ...baseRecord.lead,
        email: "email_not_unlocked@acmehealth.com"
      }
    });

    expect(result.source).toBe("none");
    expect(result.leadRecord.lead.email).toBe("");
    expect(mockApolloFetch).toHaveBeenCalledWith(
      "/v1/people/match",
      expect.objectContaining({
        name: "Jordan Lee",
        domain: "acmehealth.com"
      })
    );
  });

  it("keeps existing real emails without calling Apollo", async () => {
    const result = await enrichLeadContactFromApollo({
      ...baseRecord,
      lead: {
        ...baseRecord.lead,
        email: "jordan@acmehealth.com"
      }
    });

    expect(result.source).toBe("existing");
    expect(result.leadRecord.lead.email).toBe("jordan@acmehealth.com");
    expect(mockApolloFetch).not.toHaveBeenCalled();
  });

  it("falls back from id matching to name and company matching", async () => {
    mockApolloFetch
      .mockResolvedValueOnce({ person: { id: "person-1", email: null } })
      .mockResolvedValueOnce({
        person: {
          id: "person-1",
          first_name: "Jordan",
          last_name: "Lee",
          email: "jordan.lee@acmehealth.com",
          email_status: "verified",
          organization: {
            website_url: "https://www.acmehealth.com"
          }
        }
      });

    const result = await enrichLeadContactFromApollo({
      ...baseRecord,
      lead: {
        ...baseRecord.lead,
        id: "person-1",
        externalId: "person-1"
      }
    });

    expect(result.source).toBe("apollo");
    expect(result.emailStatus).toBe("verified");
    expect(result.leadRecord.lead.email).toBe("jordan.lee@acmehealth.com");
    expect(mockApolloFetch).toHaveBeenCalledTimes(2);
    expect(mockApolloFetch).toHaveBeenLastCalledWith(
      "/v1/people/match",
      expect.objectContaining({
        name: "Jordan Lee",
        organization_name: "Acme Health",
        domain: "acmehealth.com"
      })
    );
  });
});
