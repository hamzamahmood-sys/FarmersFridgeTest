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
    const result = await enrichLeadContactFromApollo({
      ...baseRecord,
      lead: {
        ...baseRecord.lead,
        email: "email_not_unlocked@acmehealth.com"
      }
    });

    expect(result.source).toBe("none");
    expect(result.leadRecord.lead.email).toBe("");
    expect(mockApolloFetch).not.toHaveBeenCalled();
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
});
