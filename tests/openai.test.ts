import { describe, expect, it } from "vitest";
import { coerceGeneratedTextValue } from "@/lib/openai";

describe("coerceGeneratedTextValue", () => {
  it("turns object-shaped talking points into editable multiline text", () => {
    const value = coerceGeneratedTextValue({
      recent_initiative: "wellness push",
      valueProp: "24/7 fresh food",
      locations: ["Chicago", "New York"]
    });

    expect(value).toBe(
      "Recent initiative: wellness push\nValue Prop: 24/7 fresh food\nLocations: Chicago, New York"
    );
  });

  it("falls back when the model returns an empty structure", () => {
    expect(coerceGeneratedTextValue({}, "Company: Canteen")).toBe("Company: Canteen");
  });
});
