import OpenAI from "openai";
import { env } from "@/lib/env";
import type { GeneratedPitch, LeadRecord, ToneSettings } from "@/lib/types";
import { ensurePitchSpecificity, formatLocation } from "@/lib/utils";
import { researchCompany } from "@/lib/tavily";
import { OPENAI_MODEL, OPENAI_TIMEOUT_MS } from "@/lib/constants";

function getOpenAIClient() {
  return new OpenAI({
    apiKey: env.openaiApiKey
  });
}

function stripEmDashes(text: string): string {
  return text.replace(/\u2014/g, ", ").replace(/\u2013/g, "-");
}

function normalizeGeneratedCopy(text: string): string {
  return stripEmDashes(text)
    .replace(/\[your name\]/gi, "Farmer's Fridge")
    .replace(/,([A-Za-z\[])/g, ", $1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());
}

function flattenInlineValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => flattenInlineValue(item))
      .filter(Boolean)
      .join(", ");
  }

  if (value && typeof value === "object") {
    const lines = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => {
        const rendered = flattenInlineValue(entry);
        return rendered ? `${humanizeKey(key)}: ${rendered}` : "";
      })
      .filter(Boolean);

    return lines.join(", ");
  }

  return "";
}

export function coerceGeneratedTextValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return normalizeGeneratedCopy(value || fallback);
  }

  if (Array.isArray(value)) {
    const lines = value
      .map((item) => flattenInlineValue(item))
      .filter(Boolean);

    if (lines.length > 0) {
      return normalizeGeneratedCopy(lines.join("\n"));
    }
  }

  if (value && typeof value === "object") {
    const lines = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => {
        const rendered = flattenInlineValue(entry);
        return rendered ? `${humanizeKey(key)}: ${rendered}` : "";
      })
      .filter(Boolean);

    if (lines.length > 0) {
      return normalizeGeneratedCopy(lines.join("\n"));
    }
  }

  return normalizeGeneratedCopy(fallback);
}

function coerceGeneratedListValue(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const entries = value
      .map((item) => flattenInlineValue(item))
      .filter(Boolean);

    if (entries.length > 0) {
      return entries.slice(0, 3);
    }
  }

  const coerced = coerceGeneratedTextValue(value);
  if (coerced) {
    return coerced
      .split(/\n+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  return fallback;
}

function getOpenAIError(error: unknown): Error {
  const status =
    typeof error === "object" && error && "status" in error && typeof error.status === "number"
      ? error.status
      : undefined;
  const code =
    typeof error === "object" && error && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  const message =
    error instanceof Error ? error.message : "OpenAI pitch generation failed.";

  if (status === 401 || status === 403 || code === "missing_scope") {
    return new Error(
      `OpenAI pitch generation is not authorized. ${message} Check the configured OPENAI_API_KEY or project scopes.`
    );
  }

  return new Error(message);
}

function buildBridgeInsight(record: LeadRecord): string {
  const keyword = record.company.keywords[0];
  if (keyword) {
    return `${record.lead.companyName} appears to emphasize ${keyword.toLowerCase()}, which lines up with Farmer's Fridge as a wellness-forward amenity.`;
  }

  if (record.company.employeeCount && record.company.employeeCount >= 500) {
    return `${record.lead.companyName} has the scale where a 24/7 fridge can create cafeteria-like coverage without cafeteria overhead.`;
  }

  return `${record.lead.companyName}'s ${formatLocation(record.company)} footprint makes convenience and consistent access a strong perk angle.`;
}

function buildToneInstructions(toneSettings?: ToneSettings | null): string {
  if (!toneSettings) return "";

  const sections = [
    toneSettings.voiceDescription?.trim()
      ? `Preferred voice:\n${toneSettings.voiceDescription.trim()}`
      : "",
    toneSettings.doExamples?.trim()
      ? `Do emulate:\n${toneSettings.doExamples.trim()}`
      : "",
    toneSettings.dontExamples?.trim()
      ? `Avoid:\n${toneSettings.dontExamples.trim()}`
      : "",
    toneSettings.sampleEmail?.trim()
      ? `Reference sample:\n${toneSettings.sampleEmail.trim()}`
      : ""
  ].filter(Boolean);

  if (sections.length === 0) return "";

  return ["Team tone-of-voice guidance:", ...sections].join("\n\n");
}

function buildFallbackPitch(record: LeadRecord, talkingPointsOverride?: string): GeneratedPitch {
  const keyword = record.company.keywords[0] || "employee wellness";
  const city = record.company.hqCity || "your team";
  const employeeCount = record.company.employeeCount ? `${record.company.employeeCount}` : "your";
  const bridgeInsight = buildBridgeInsight(record);
  const talkingPoints =
    talkingPointsOverride ||
    [
      `Company: ${record.lead.companyName}`,
      `City: ${city}`,
      `Employee count: ${employeeCount}`,
      `Keyword to anchor: ${keyword}`,
      `Bridge insight: ${bridgeInsight}`,
      "Value prop: 24/7 fresh, chef-made meals without the cost of a full cafeteria"
    ].join("\n");

  const subject = `Quick question for ${record.lead.companyName}`;
  const body = [
    `Hi ${record.lead.name.split(" ")[0] || record.lead.name},`,
    "",
    `I came across ${record.lead.companyName} and had to reach out — with ${employeeCount} people in ${city}, keeping everyone fed well (especially outside core lunch hours) is no small thing.`,
    "",
    `Farmer’s Fridge installs smart fridges stocked daily with fresh, chef-crafted meals. No cafeteria buildout, no staff overhead — just real food available 24/7 wherever your team needs it.`,
    "",
    `${bridgeInsight}`,
    "",
    `Companies like yours typically see an immediate uptick in employee satisfaction scores just from having the option. Worth a 15-minute call to see if it’s a fit?`,
    "",
    "Best,",
    "Farmer’s Fridge"
  ].join("\n");

  const enforced = ensurePitchSpecificity(
    normalizeGeneratedCopy(body),
    normalizeGeneratedCopy(subject),
    record
  );

  return {
    subject: enforced.subject,
    body: enforced.body,
    talkingPoints,
    bridgeInsight,
    summary: `${record.lead.name} appears relevant because they oversee workplace operations at ${record.lead.companyName}, where food access and employee experience likely matter at scale.`,
    painPoints: [
      "Employees need healthier grab-and-go food beyond standard lunch hours.",
      "Facilities teams want an amenity that improves experience without adding cafeteria overhead.",
      "Large teams benefit from convenient food access that supports wellness and retention."
    ],
    variableEvidence: enforced.variableEvidence,
    researchEvidence: []
  };
}

function buildFallbackFollowUpPitch(
  record: LeadRecord,
  bridge: string,
  seedTalkingPoints: string,
  step: 2 | 3
): GeneratedPitch {
  const firstName = record.lead.name.split(" ")[0] || record.lead.name;

  if (step === 2) {
    return {
      subject: normalizeGeneratedCopy(`A simple perk for ${record.lead.companyName}`),
      body: normalizeGeneratedCopy(
        [
          `Hi ${firstName},`,
          "",
          "I sent a note last week and wanted to share a different angle.",
          `Teams like ${record.lead.companyName} often use Farmer's Fridge to give employees a 24/7 fresh food option without the cost or complexity of a cafeteria.`,
          "If it's helpful, I can send a quick overview of how other workplaces are making it work.",
          "",
          "Best,",
          "Farmer's Fridge"
        ].join("\n")
      ),
      talkingPoints: seedTalkingPoints,
      bridgeInsight: bridge,
      summary: "",
      painPoints: [],
      variableEvidence: [],
      researchEvidence: []
    };
  }

  return {
    subject: normalizeGeneratedCopy(`Close the loop on ${record.lead.companyName}`),
    body: normalizeGeneratedCopy(
      [
        `Hi ${firstName},`,
        "",
        `Just one last bump in case improving food access is on the radar at ${record.lead.companyName}.`,
        "Farmer's Fridge can be a simple way to support morale and convenience without adding cafeteria overhead.",
        "Happy to close the loop if timing is off.",
        "",
        "Best,",
        "Farmer's Fridge"
      ].join("\n")
    ),
    talkingPoints: seedTalkingPoints,
    bridgeInsight: bridge,
    summary: "",
    painPoints: [],
    variableEvidence: [],
    researchEvidence: []
  };
}

async function generateFollowUpPitch(
  record: LeadRecord,
  talkingPointsOverride?: string,
  step: 2 | 3 = 2,
  toneSettings?: ToneSettings | null
): Promise<GeneratedPitch> {
  const bridge = buildBridgeInsight(record);
  const firstName = record.lead.name.split(" ")[0] || record.lead.name;
  const seedTalkingPoints =
    talkingPointsOverride ||
    [
      `Company: ${record.lead.companyName}`,
      `Contact: ${record.lead.name}, ${record.lead.title}`,
      `City: ${record.company.hqCity || "Unknown"}`,
      `Employees: ${record.company.employeeCount || "Unknown"}`,
      `Bridge: ${bridge}`
    ].join("\n");

  const stepInstructions =
    step === 2
      ? [
          "You are writing follow-up email #1 for Farmer's Fridge — sent 4-5 days after the first cold email was ignored.",
          "The contact never replied. Use a completely different angle from the initial email.",
          "Suggested angle: ROI/productivity gains, or how similar companies are adopting this.",
          "- Briefly acknowledge you sent something last week (one sentence, not guilt-trippy).",
          "- 75-100 words.",
          "- Different, compelling subject line.",
          "- Close with a low-friction CTA.",
          "- No em dashes, no corporate speak."
        ]
      : [
          "You are writing follow-up email #2 (final bump) for Farmer's Fridge — sent ~10 days after the first email.",
          "This is the last touch. Short, respectful, easy to respond to.",
          "Suggested angle: employee morale, team retention, or a simple 'just in case' framing.",
          "- 50-75 words max.",
          "- Give them a graceful out: 'Happy to close the loop if timing's off.'",
          "- No em dashes."
        ];

  const prompt = [
    ...stepInstructions,
    "",
    buildToneInstructions(toneSettings),
    "",
    "Prospect data:",
    `Company: ${record.lead.companyName}`,
    `Contact: ${record.lead.name}, ${record.lead.title}`,
    `Industry: ${record.company.industry || "Unknown"}`,
    `Employees: ${record.company.employeeCount || "Unknown"}`,
    `HQ: ${record.company.hqCity || "Unknown"}`,
    "",
    "Seed talking points:",
    seedTalkingPoints,
    "",
    "Return valid JSON only. Keys: subject, body, talkingPoints, bridgeInsight, summary, painPoints.",
    "For painPoints return an empty array []. For summary return an empty string."
  ].join("\n");

  try {
    const response = await getOpenAIClient().chat.completions.create(
      {
        model: OPENAI_MODEL,
        temperature: 0.6,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }]
      },
      { timeout: OPENAI_TIMEOUT_MS }
    );

    const rawText = response.choices[0]?.message?.content || "{}";

    let parsed: Partial<GeneratedPitch>;
    try {
      parsed = JSON.parse(rawText) as Partial<GeneratedPitch>;
    } catch {
      return buildFallbackFollowUpPitch(record, bridge, seedTalkingPoints, step);
    }

    return {
      subject: coerceGeneratedTextValue(parsed.subject, `Follow-up: ${record.lead.companyName}`),
      body: coerceGeneratedTextValue(parsed.body, ""),
      talkingPoints: seedTalkingPoints,
      bridgeInsight: bridge,
      summary: "",
      painPoints: [],
      variableEvidence: [],
      researchEvidence: []
    };
  } catch (error) {
    console.warn(
      `[OpenAI] follow-up step ${step} fallback for ${record.lead.companyName}:`,
      error instanceof Error ? error.message : error
    );
    return buildFallbackFollowUpPitch(record, bridge, seedTalkingPoints, step);
  }
}

export async function generatePitch(
  record: LeadRecord,
  talkingPointsOverride?: string,
  step: 1 | 2 | 3 = 1,
  toneSettings?: ToneSettings | null
): Promise<GeneratedPitch> {
  if (step === 2 || step === 3) {
    return generateFollowUpPitch(record, talkingPointsOverride, step, toneSettings);
  }
  const keyword = record.company.keywords[0] || "employee wellness";
  const bridge = buildBridgeInsight(record);

  const [webResearch] = await Promise.all([researchCompany(record)]);

  const seedTalkingPoints =
    talkingPointsOverride ||
    [
      `Company: ${record.lead.companyName}`,
      `City: ${record.company.hqCity || "Unknown"}`,
      `Employee count: ${record.company.employeeCount || "Unknown"}`,
      `Keyword to anchor: ${keyword}`,
      `Bridge insight: ${bridge}`,
      "Value prop: 24/7 fresh, chef-made meals without the cost of a full cafeteria"
    ].join("\n");

  const prompt = [
    "You are a top-performing sales rep for Farmer's Fridge — you write cold emails that actually get replies.",
    "Farmer's Fridge installs smart fridges stocked daily with chef-crafted, fresh meals in workplaces.",
    "It's a no-overhead alternative to a cafeteria: no staff, no kitchen buildout, just fresh food available 24/7.",
    "",
    "Prospect data from Apollo:",
    `Company: ${record.lead.companyName}`,
    `Contact: ${record.lead.name}, ${record.lead.title}`,
    `Industry: ${record.company.industry || "Unknown"}`,
    `Employees: ${record.company.employeeCount || "Unknown"}`,
    `HQ: ${record.company.hqCity || "Unknown"}`,
    `Keywords: ${record.company.keywords.join(", ") || "none"}`,
    `About: ${record.company.about || "n/a"}`,
    "",
    webResearch.rawSnippets
      ? `Live web research about this company:\n${webResearch.rawSnippets}`
      : "No additional web research available.",
    "",
    buildToneInstructions(toneSettings),
    "",
    "Write a cold outreach email that feels like it came from a real person, not a marketing department.",
    "Rules:",
    "- If web research is available, open with a timely, specific hook based on it (recent news, expansion, hiring, etc.).",
    "- If no web research, open with a specific observation from the Apollo data instead.",
    "- Make the value crystal clear in one sentence: fresh, chef-made food available 24/7, zero cafeteria overhead.",
    "- Use conversational language. Short sentences. No corporate speak. No em dashes.",
    "- Create mild urgency or curiosity — give them a reason to reply today, not someday.",
    "- Close with a low-friction CTA like 'Worth a 15-minute call?' or 'Open to a quick chat?'",
    "- Reference at least one specific detail (city, headcount, keyword, or industry) to prove it's not a blast.",
    "- Body must be 100-150 words. Plain text only. No bullet points in the email body.",
    "- Subject line should be short (under 8 words), conversational, and make them want to open it.",
    "",
    "Also return:",
    "- talkingPoints: the key facts you used to personalize this email (editable by the user before sending)",
    "- bridgeInsight: one sentence connecting their Apollo data to why a Farmer's Fridge is a natural fit",
    "- summary: one sentence on why this specific contact is worth reaching out to",
    "- painPoints: 3 concrete problems this person likely faces that a Farmer's Fridge solves",
    "",
    "Return valid JSON only. Keys: subject, body, talkingPoints, bridgeInsight, summary, painPoints.",
    "",
    "Seed talking points (user can revise these before sending):",
    seedTalkingPoints
  ].join("\n");

  try {
    const response = await getOpenAIClient().chat.completions.create(
      {
        model: OPENAI_MODEL,
        temperature: 0.5,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }]
      },
      { timeout: OPENAI_TIMEOUT_MS }
    );

    const rawText = response.choices[0]?.message?.content || "{}";

    let parsed: Omit<GeneratedPitch, "variableEvidence">;
    try {
      parsed = JSON.parse(rawText) as Omit<GeneratedPitch, "variableEvidence">;
    } catch {
      // OpenAI returned malformed JSON — use the structured fallback pitch.
      return buildFallbackPitch(record, seedTalkingPoints);
    }

    parsed.subject = coerceGeneratedTextValue(parsed.subject, "");
    parsed.body = coerceGeneratedTextValue(parsed.body, "");
    const enforced = ensurePitchSpecificity(parsed.body, parsed.subject, record);
    const fallbackPainPoints = [
      "Employees need healthier meal access without expanding cafeteria operations.",
      "Teams working long or irregular hours need food availability beyond lunch service.",
      "Workplace leaders want amenities that support wellness goals and retention."
    ];

    return {
      subject: enforced.subject,
      body: enforced.body,
      talkingPoints: coerceGeneratedTextValue(parsed.talkingPoints, seedTalkingPoints),
      bridgeInsight: coerceGeneratedTextValue(parsed.bridgeInsight, bridge),
      summary: coerceGeneratedTextValue(
        parsed.summary,
        `${record.lead.name} appears to be a strong Farmer's Fridge contact at ${record.lead.companyName} based on their ${record.lead.title} role and the workplace amenity signals in Apollo.`
      ),
      painPoints: coerceGeneratedListValue(parsed.painPoints, fallbackPainPoints),
      variableEvidence: enforced.variableEvidence,
      researchEvidence: webResearch.evidence
    };
  } catch (error) {
    throw getOpenAIError(error);
  }
}
