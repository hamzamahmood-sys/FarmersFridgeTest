import type { PlacementFit } from "@/lib/types";

type FitInput = {
  companyName?: string;
  industry?: string;
  employeeCount?: number;
  hqCity?: string;
  hqState?: string;
  about?: string;
  category?: string;
  locationType?: string;
  deliveryZone?: string;
  keywords?: string[];
};

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

export function calculatePlacementFit(input: FitInput): PlacementFit {
  const reasons: string[] = [];
  let score = 20;
  const text = [
    input.companyName,
    input.industry,
    input.about,
    input.category,
    ...(input.keywords ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (input.deliveryZone && input.deliveryZone !== "Other") {
    score += 26;
    addReason(reasons, `${input.deliveryZone} delivery zone`);
  } else if (input.hqState && ["IL", "NY", "NJ"].includes(input.hqState.toUpperCase())) {
    score += 16;
    addReason(reasons, "near an active delivery market");
  }

  switch (input.locationType) {
    case "hospital":
      score += 18;
      addReason(reasons, "hospital teams need reliable off-hours food access");
      break;
    case "corporate":
      score += 16;
      addReason(reasons, "corporate workplace amenity fit");
      break;
    case "university":
      score += 14;
      addReason(reasons, "campus environment with distributed foot traffic");
      break;
    case "airport":
      score += 12;
      addReason(reasons, "airport schedule creates 24/7 meal demand");
      break;
    case "gym":
      score += 8;
      addReason(reasons, "wellness-oriented audience");
      break;
  }

  const employeeCount = input.employeeCount ?? 0;
  if (employeeCount >= 1000) {
    score += 18;
    addReason(reasons, "large employee base");
  } else if (employeeCount >= 500) {
    score += 14;
    addReason(reasons, "mid-market employee scale");
  } else if (employeeCount >= 200) {
    score += 9;
    addReason(reasons, "enough onsite population to test placement");
  }

  if (includesAny(text, ["wellness", "employee experience", "benefits", "people", "workplace"])) {
    score += 12;
    addReason(reasons, "employee experience language");
  }
  if (includesAny(text, ["cafeteria", "dining", "food service", "nutrition", "fresh food"])) {
    score += 10;
    addReason(reasons, "food access signal");
  }
  if (includesAny(text, ["campus", "facility", "facilities", "operations", "office"])) {
    score += 8;
    addReason(reasons, "operations footprint");
  }
  if (input.hqCity || input.hqState) {
    score += 4;
    addReason(reasons, "known location");
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons: reasons.slice(0, 4)
  };
}
