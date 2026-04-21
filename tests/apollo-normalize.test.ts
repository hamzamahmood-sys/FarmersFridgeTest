import { describe, it, expect } from "vitest";
import { getPersonName, isRealApolloEmail, normalizeDomain } from "@/lib/apollo/normalize";

describe("getPersonName", () => {
  it("uses split first and last names when both are present", () => {
    expect(getPersonName({ first_name: "Jordan", last_name: "Lee", name: "Jordan L." })).toBe("Jordan Lee");
  });

  it("prefers the fuller name string when split fields are incomplete", () => {
    expect(getPersonName({ first_name: "Jordan", last_name: "", name: "Jordan Lee" })).toBe("Jordan Lee");
  });

  it("falls back to the name field when split fields are missing", () => {
    expect(getPersonName({ name: "Jordan Lee" })).toBe("Jordan Lee");
  });
});

describe("isRealApolloEmail", () => {
  it("accepts real addresses", () => {
    expect(isRealApolloEmail("jane@acme.com")).toBe(true);
  });

  it("rejects Apollo placeholders", () => {
    expect(isRealApolloEmail("email_not_unlocked@domain.com")).toBe(false);
    expect(isRealApolloEmail("email_not_unlocked")).toBe(false);
    expect(isRealApolloEmail("something_not_unlocked_else")).toBe(false);
  });

  it("rejects non-strings and empty", () => {
    expect(isRealApolloEmail(null)).toBe(false);
    expect(isRealApolloEmail(undefined)).toBe(false);
    expect(isRealApolloEmail("")).toBe(false);
    expect(isRealApolloEmail("   ")).toBe(false);
  });
});

describe("normalizeDomain", () => {
  it("strips protocol and www", () => {
    expect(normalizeDomain("https://www.acme.com")).toBe("acme.com");
    expect(normalizeDomain("http://acme.com/path")).toBe("acme.com");
  });

  it("handles bare hostnames", () => {
    expect(normalizeDomain("acme.com")).toBe("acme.com");
    expect(normalizeDomain("www.acme.com")).toBe("acme.com");
  });

  it("returns undefined for empty input", () => {
    expect(normalizeDomain(undefined)).toBeUndefined();
    expect(normalizeDomain("")).toBeUndefined();
  });
});
