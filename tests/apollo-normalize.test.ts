import { describe, it, expect } from "vitest";
import { isRealApolloEmail, normalizeDomain } from "@/lib/apollo/normalize";

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
