import { describe, expect, it } from "vitest";
import { calculatePlacementFit } from "@/lib/fit-score";

describe("calculatePlacementFit", () => {
  it("scores in-zone corporate employers with employee experience signals highly", () => {
    const fit = calculatePlacementFit({
      companyName: "Acme HQ",
      locationType: "corporate",
      deliveryZone: "Chicago",
      employeeCount: 1200,
      about: "Corporate campus focused on workplace experience and employee wellness."
    });

    expect(fit.score).toBeGreaterThanOrEqual(80);
    expect(fit.reasons).toContain("Chicago delivery zone");
  });

  it("keeps weak out-of-zone accounts below high-fit range", () => {
    const fit = calculatePlacementFit({
      companyName: "Tiny Remote Co",
      deliveryZone: "Other",
      employeeCount: 40,
      about: "Small distributed software team."
    });

    expect(fit.score).toBeLessThan(60);
  });
});
