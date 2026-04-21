import { describe, expect, it } from "vitest";
import {
  buildCompanyAboutFallback,
  extractBestCompanyWebsiteSnippet,
  hasUsableCompanyAbout
} from "@/lib/company-profile";

describe("hasUsableCompanyAbout", () => {
  it("accepts longer company summaries", () => {
    expect(
      hasUsableCompanyAbout(
        "Acme Health operates a regional network of outpatient clinics and employer wellness programs across the Midwest."
      )
    ).toBe(true);
  });

  it("rejects blank and low-signal text", () => {
    expect(hasUsableCompanyAbout("")).toBe(false);
    expect(hasUsableCompanyAbout("Unknown")).toBe(false);
    expect(hasUsableCompanyAbout("Healthcare company")).toBe(false);
  });
});

describe("extractBestCompanyWebsiteSnippet", () => {
  it("prefers a meta description when present", () => {
    const html = `
      <html>
        <head>
          <meta name="description" content="Rush University Medical Center is an academic medical center serving adults and children across Chicago." />
        </head>
        <body>
          <p>Ignored because the meta description should win.</p>
        </body>
      </html>
    `;

    expect(extractBestCompanyWebsiteSnippet(html)).toBe(
      "Rush University Medical Center is an academic medical center serving adults and children across Chicago."
    );
  });

  it("falls back to paragraph content when no metadata exists", () => {
    const html = `
      <html>
        <body>
          <p>Short.</p>
          <p>
            Acme Logistics helps enterprise teams manage warehouse operations, regional distribution,
            and last-mile delivery coordination throughout the United States.
          </p>
        </body>
      </html>
    `;

    expect(extractBestCompanyWebsiteSnippet(html)).toContain(
      "Acme Logistics helps enterprise teams manage warehouse operations"
    );
  });
});

describe("buildCompanyAboutFallback", () => {
  it("combines scraped context with structured facts", () => {
    const about = buildCompanyAboutFallback(
      {
        companyName: "Acme Health",
        industry: "Hospital & Health Care",
        employeeCount: 4200,
        hqCity: "Chicago",
        hqState: "Illinois",
        hqCountry: "United States"
      },
      "Acme Health provides community-based care, specialty clinics, and virtual support programs."
    );

    expect(about).toContain("Acme Health provides community-based care");
    expect(about).toContain("headquartered in Chicago, Illinois, United States");
    expect(about).toContain("approximately 4,200 employees");
  });

  it("builds a fact-only summary when no website snippet is available", () => {
    const about = buildCompanyAboutFallback({
      companyName: "Hudson Legal Group",
      industry: "Law Practice",
      employeeCount: 450,
      hqCity: "New York",
      hqState: "New York"
    });

    expect(about).toBe(
      "Hudson Legal Group operates in Law Practice, is headquartered in New York, New York, and has approximately 450 employees."
    );
  });
});
