import { describe, it, expect } from "vitest";
import {
  resolveDeliveryZone,
  priorityLead,
  sortLeadRecords,
  personaToApolloTitles,
  ensurePitchSpecificity,
  inferContactDepartment,
  resolveContactDepartment
} from "@/lib/utils";
import type { LeadRecord } from "@/lib/types";

function makeLead(overrides: Partial<LeadRecord> = {}): LeadRecord {
  return {
    lead: {
      id: "1",
      name: "Jane Doe",
      email: "jane@example.com",
      title: "Office Manager",
      companyName: "Acme",
      ...(overrides.lead ?? {})
    },
    company: {
      keywords: [],
      techStack: [],
      deliveryZone: "Other",
      ...(overrides.company ?? {})
    },
    priorityScore: 0,
    ...overrides
  };
}

describe("resolveDeliveryZone", () => {
  it("matches Chicago from city", () => {
    expect(resolveDeliveryZone({ hqCity: "Chicago", hqState: "IL" })).toBe("Chicago");
  });

  it("matches NYC variants", () => {
    expect(resolveDeliveryZone({ hqCity: "Brooklyn", hqState: "NY" })).toBe("NYC");
    expect(resolveDeliveryZone({ hqCity: "Manhattan", hqState: "NY" })).toBe("NYC");
  });

  it("matches NJ", () => {
    expect(resolveDeliveryZone({ hqCity: "Jersey City", hqState: "NJ" })).toBe("NJ");
  });

  it("returns Other for unknown", () => {
    expect(resolveDeliveryZone({ hqCity: "Austin", hqState: "TX" })).toBe("Other");
    expect(resolveDeliveryZone({ hqCity: undefined, hqState: undefined })).toBe("Other");
  });
});

describe("priorityLead", () => {
  it("boosts in-zone companies by 100", () => {
    const lead = makeLead({
      company: { keywords: [], techStack: [], deliveryZone: "Chicago" }
    });
    expect(priorityLead(lead)).toBe(100);
  });

  it("tiers by employee count", () => {
    const base = makeLead({ company: { keywords: [], techStack: [], deliveryZone: "Other" } });
    expect(priorityLead({ ...base, company: { ...base.company, employeeCount: 1000 } })).toBe(30);
    expect(priorityLead({ ...base, company: { ...base.company, employeeCount: 500 } })).toBe(20);
    expect(priorityLead({ ...base, company: { ...base.company, employeeCount: 200 } })).toBe(10);
    expect(priorityLead({ ...base, company: { ...base.company, employeeCount: 50 } })).toBe(0);
  });

  it("adds keyword bonus for wellness/sustainability/benefits", () => {
    const lead = makeLead({
      company: { keywords: ["Wellness"], techStack: [], deliveryZone: "Other" }
    });
    expect(priorityLead(lead)).toBe(20);
  });

  it("stacks zone + size + keyword bonuses", () => {
    const lead = makeLead({
      company: {
        keywords: ["employee benefits"],
        techStack: [],
        deliveryZone: "NYC",
        employeeCount: 1500
      }
    });
    expect(priorityLead(lead)).toBe(150);
  });
});

describe("sortLeadRecords", () => {
  it("orders by priorityScore desc, then email > linkedin > none, then company name", () => {
    const a = makeLead({ lead: { id: "a", name: "A", email: "", title: "", companyName: "Zeta" }, priorityScore: 100 });
    const b = makeLead({ lead: { id: "b", name: "B", email: "b@x.co", title: "", companyName: "Beta" }, priorityScore: 100 });
    const c = makeLead({ lead: { id: "c", name: "C", email: "", title: "", linkedinUrl: "u", companyName: "Alpha" }, priorityScore: 100 });
    const d = makeLead({ priorityScore: 200, lead: { id: "d", name: "D", email: "", title: "", companyName: "Dd" } });

    const sorted = sortLeadRecords([a, b, c, d]);
    expect(sorted.map((r) => r.lead.id)).toEqual(["d", "b", "c", "a"]);
  });
});

describe("personaToApolloTitles", () => {
  it("falls back to Office Manager when personas list is empty", () => {
    expect(
      personaToApolloTitles({
        personas: [],
        industryQuery: "",
        states: [],
        employeeMin: 0,
        limit: 10
      })
    ).toEqual(["Office Manager"]);
  });

  it("uses customPersona when persona is custom", () => {
    const result = personaToApolloTitles({
      personas: ["custom"],
      customPersona: "Vibes Architect",
      industryQuery: "",
      states: [],
      employeeMin: 0,
      limit: 10
    });
    expect(result).toEqual(["Vibes Architect"]);
  });

  it("merges multiple personas without duplicates", () => {
    const result = personaToApolloTitles({
      personas: ["office_manager", "facilities_director"],
      industryQuery: "",
      states: [],
      employeeMin: 0,
      limit: 10
    });
    expect(result).toContain("Office Manager");
    expect(result).toContain("Facilities Director");
    expect(new Set(result).size).toBe(result.length);
  });
});

describe("inferContactDepartment", () => {
  it("maps common Apollo operations and admin titles away from other", () => {
    expect(inferContactDepartment("Practice Manager")).toBe("workplace");
    expect(inferContactDepartment("Administrative Director")).toBe("workplace");
    expect(inferContactDepartment("Director of Environmental Services")).toBe("facilities");
    expect(inferContactDepartment("Managing Partner")).toBe("csuite");
    expect(inferContactDepartment("Director of Food Services")).toBe("fnb");
    expect(inferContactDepartment("Chief People Officer")).toBe("hr_people");
  });
});

describe("resolveContactDepartment", () => {
  it("upgrades missing or other departments using the title", () => {
    expect(resolveContactDepartment(undefined, "Practice Manager")).toBe("workplace");
    expect(resolveContactDepartment("other", "Managing Partner")).toBe("csuite");
  });

  it("preserves an already-specific department", () => {
    expect(resolveContactDepartment("facilities", "Managing Partner")).toBe("facilities");
  });
});

describe("ensurePitchSpecificity", () => {
  const record = makeLead({
    company: {
      keywords: ["wellness"],
      techStack: [],
      deliveryZone: "Chicago",
      hqCity: "Chicago",
      employeeCount: 800
    }
  });

  it("keeps body and reports matched evidence when city appears", () => {
    const result = ensurePitchSpecificity("Hello from Chicago — let's chat.", "Quick note", record);
    expect(result.variableEvidence).toContain("Chicago");
  });

  it("strips legacy P.S. footprint postscript", () => {
    const body = "Main body here.\n\nP.S. I thought this could be especially relevant for your Chicago footprint.";
    const result = ensurePitchSpecificity(body, "subj", record);
    expect(result.body).toBe("Main body here.");
  });

  it("returns empty evidence when nothing matches", () => {
    const result = ensurePitchSpecificity("Totally generic copy.", "Hi there", record);
    expect(result.variableEvidence).toEqual([]);
  });
});
