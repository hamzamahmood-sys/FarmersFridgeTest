import { describe, expect, it } from "vitest";
import { analyzeEmailQuality, statusAfterQualityCheck } from "@/lib/email-quality";

describe("analyzeEmailQuality", () => {
  it("rewards concise specific copy with a clear CTA", () => {
    const quality = analyzeEmailQuality({
      subject: "Fresh meals for Acme",
      body: "Hi Jane,\n\nI noticed Acme has a large Chicago office, and food access can get tricky outside the lunch rush. Farmer's Fridge gives teams fresh meals 24/7 without cafeteria overhead, especially for people moving between meetings or late shifts. Open to a quick chat next week?",
      companyName: "Acme",
      contactName: "Jane Doe",
      sequenceStep: 1
    });

    expect(quality.score).toBeGreaterThanOrEqual(85);
    expect(quality.issues).toEqual([]);
  });

  it("flags generic copy and moves it to needs edits", () => {
    const quality = analyzeEmailQuality({
      subject: "A revolutionary game changer that will transform everything at your company",
      body: "Hello, I wanted to touch base about synergy.",
      companyName: "Acme",
      contactName: "Jane Doe",
      sequenceStep: 1
    });

    expect(quality.issues.length).toBeGreaterThan(2);
    expect(statusAfterQualityCheck("scheduled", quality)).toBe("needs_edits");
  });
});
