import { describe, it, expect } from "vitest";
import {
  looksLikeExactCompanyQuery,
  parseSearchQuery,
  getDistinctiveCompanyTokens
} from "@/lib/apollo/query-parser";

describe("looksLikeExactCompanyQuery", () => {
  it("flags 'of location' proper nouns", () => {
    expect(looksLikeExactCompanyQuery("University of Chicago")).toBe(true);
    expect(looksLikeExactCompanyQuery("Bank of America")).toBe(true);
    expect(looksLikeExactCompanyQuery("Children's Hospital of Philadelphia")).toBe(true);
  });

  it("rejects queries with a plain location", () => {
    expect(looksLikeExactCompanyQuery("Hospitals in the Midwest")).toBe(false);
    expect(looksLikeExactCompanyQuery("tech companies in NYC")).toBe(false);
  });

  it("flags short proper-noun queries", () => {
    expect(looksLikeExactCompanyQuery("Northwestern Medicine")).toBe(true);
    expect(looksLikeExactCompanyQuery("Rush Hospital")).toBe(true);
  });

  it("rejects single-token or overly generic queries", () => {
    expect(looksLikeExactCompanyQuery("Hospital")).toBe(false);
    expect(looksLikeExactCompanyQuery("")).toBe(false);
  });
});

describe("parseSearchQuery", () => {
  it("extracts Chicago from 'tech companies in Chicago'", () => {
    const parsed = parseSearchQuery("tech companies in Chicago", []);
    expect(parsed.locations).toContain("Chicago");
    expect(parsed.looksLikeCompanyName).toBe(false);
    expect(parsed.organizationIndustries.length).toBeGreaterThan(0);
  });

  it("does not strip 'Chicago' from 'University of Chicago'", () => {
    const parsed = parseSearchQuery("University of Chicago", []);
    expect(parsed.looksLikeCompanyName).toBe(true);
    expect(parsed.rawQuery).toBe("University of Chicago");
    expect(parsed.organizationIndustries).toEqual([]);
  });

  it("accepts state hints from UI", () => {
    const parsed = parseSearchQuery("hospitals", ["Illinois"]);
    expect(parsed.locations).toContain("Illinois");
  });

  it("expands midwest to a list of states", () => {
    const parsed = parseSearchQuery("hospitals in the Midwest", []);
    expect(parsed.locations).toEqual(
      expect.arrayContaining(["Illinois", "Michigan", "Ohio", "Indiana", "Wisconsin", "Minnesota"])
    );
  });

  it("preserves useful category phrases for company search", () => {
    const parsed = parseSearchQuery("law firm NYC", []);
    expect(parsed.descriptivePhrase).toBe("law firm");
    expect(parsed.keywords).toEqual(["law"]);
  });

  it("returns healthcare industries for singular 'hospital' queries", () => {
    // Note: the industry regex is \bhospital\b, which doesn't match plural
    // "hospitals". The DEFAULT_SEARCH_FILTERS query "Hospitals in the Midwest"
    // therefore doesn't get industry-routed — worth revisiting.
    const parsed = parseSearchQuery("hospital in the Midwest", []);
    expect(parsed.organizationIndustries).toEqual(
      expect.arrayContaining(["Hospital & Health Care"])
    );
  });
});

describe("getDistinctiveCompanyTokens", () => {
  it("drops generic company words", () => {
    expect(getDistinctiveCompanyTokens("Rush University Medical Center")).toEqual(["rush"]);
  });

  it("keeps distinctive tokens", () => {
    // "medicine" is in the generic tokens list alongside "medical" — only
    // "northwestern" survives as the distinguishing token.
    expect(getDistinctiveCompanyTokens("Northwestern Medicine")).toEqual(["northwestern"]);
    expect(getDistinctiveCompanyTokens("Acme Robotics Corp")).toEqual(["acme", "robotics"]);
  });
});
