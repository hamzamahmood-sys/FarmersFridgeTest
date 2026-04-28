import OpenAI from "openai";
import { tavily } from "@tavily/core";
import { env } from "@/lib/env";
import type { ContactDepartment, LeadRecord, SavedLocation } from "@/lib/types";
import { resolveContactDepartment } from "@/lib/utils";

export interface AIDiscoveredContact {
  name: string;
  title: string;
  email?: string;
  linkedinUrl?: string;
  department: ContactDepartment;
  source: string;
}

function slugifyId(companyId: string, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `ai-${companyId}-${slug || Math.random().toString(36).slice(2, 8)}`;
}

function buildSearchQueries(location: SavedLocation): string[] {
  const anchor = location.companyName;
  const city = location.hqCity ? ` ${location.hqCity}` : "";
  return [
    `${anchor}${city} facilities director OR workplace experience OR office manager`,
    `${anchor}${city} head of people OR head of HR OR chief people officer`,
    `${anchor}${city} food beverage director OR dining services OR cafeteria manager`,
    `"${anchor}" leadership team site:linkedin.com/in`
  ];
}

async function gatherTavilyEvidence(location: SavedLocation): Promise<string> {
  const client = tavily({ apiKey: env.tavilyApiKey });
  const queries = buildSearchQueries(location);

  const batches = await Promise.all(
    queries.map((query) =>
      client
        .search(query, {
          maxResults: 5,
          searchDepth: "advanced",
          includeAnswer: false
        })
        .catch(() => ({ results: [] as Array<{ title?: string; content?: string; url?: string }> }))
    )
  );

  const seen = new Set<string>();
  const snippets: string[] = [];

  for (const batch of batches) {
    for (const result of batch.results ?? []) {
      const url = typeof result.url === "string" ? result.url.trim() : "";
      const body = (result.content || "").replace(/\s+/g, " ").trim();
      if (!url || !body || seen.has(url)) continue;
      seen.add(url);
      snippets.push(`URL: ${url}\nTITLE: ${result.title || ""}\nCONTENT: ${body.slice(0, 600)}`);
      if (snippets.length >= 12) break;
    }
    if (snippets.length >= 12) break;
  }

  return snippets.join("\n---\n");
}

async function extractContactsWithOpenAI(
  location: SavedLocation,
  evidence: string
): Promise<AIDiscoveredContact[]> {
  if (!evidence.trim()) return [];

  const client = new OpenAI({ apiKey: env.openaiApiKey });

  const prompt = [
    `You are a B2B research assistant. Pull real, named decision-makers at ${location.companyName}${
      location.hqCity ? ` in ${location.hqCity}` : ""
    } from the web evidence below.`,
    "We only want people who would plausibly decide on workplace food / Farmer's Fridge: facilities, workplace experience, office management, people/HR, food & beverage, or C-suite.",
    "Only include contacts the evidence explicitly names. Never invent names, titles, or emails. If no named contacts appear, return an empty array.",
    "",
    "Web evidence:",
    evidence,
    "",
    'Return JSON of the form { "contacts": [{ "name", "title", "email", "linkedinUrl", "department", "source" }] }.',
    'department must be one of: "facilities", "hr_people", "workplace", "fnb", "csuite", "other".',
    "email and linkedinUrl are optional. source is the URL the contact was found at.",
    "Limit to the 6 most relevant contacts."
  ].join("\n");

  const response = await client.chat.completions.create({
    model: "gpt-4.1",
    temperature: 0.2,
    max_tokens: 800,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }]
  });

  const raw = response.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw) as { contacts?: Array<Partial<AIDiscoveredContact>> };

  const allowedDepartments: ContactDepartment[] = [
    "facilities",
    "hr_people",
    "workplace",
    "fnb",
    "csuite",
    "other"
  ];

  const seenKeys = new Set<string>();
  const contacts: AIDiscoveredContact[] = [];

  for (const candidate of parsed.contacts ?? []) {
    const name = (candidate.name || "").trim();
    const title = (candidate.title || "").trim();
    if (!name || !title) continue;

    const key = `${name.toLowerCase()}|${title.toLowerCase()}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const candidateDepartment =
      candidate.department && allowedDepartments.includes(candidate.department as ContactDepartment)
        ? (candidate.department as ContactDepartment)
        : undefined;
    const department = resolveContactDepartment(candidateDepartment, title);

    contacts.push({
      name,
      title,
      email: candidate.email?.trim() || undefined,
      linkedinUrl: candidate.linkedinUrl?.trim() || undefined,
      department,
      source: candidate.source?.trim() || ""
    });

    if (contacts.length >= 6) break;
  }

  return contacts;
}

export async function discoverContactsWithAI(location: SavedLocation): Promise<LeadRecord[]> {
  const evidence = await gatherTavilyEvidence(location);
  const contacts = await extractContactsWithOpenAI(location, evidence);

  const anchorId = location.organizationId || location.id;

  return contacts.map<LeadRecord>((contact) => {
    const contactId = slugifyId(anchorId, contact.name);

    return {
      lead: {
        id: contactId,
        externalId: contactId,
        name: contact.name,
        email: contact.email || "",
        title: contact.title,
        linkedinUrl: contact.linkedinUrl,
        companyName: location.companyName,
        companyDomain: location.companyDomain,
        organizationId: location.organizationId,
        department: contact.department,
        locationId: location.id,
        source: "ai",
        emailSource: contact.email ? "ai" : undefined
      },
      company: {
        industry: location.industry,
        employeeCount: location.employeeCount,
        hqCity: location.hqCity,
        hqState: location.hqState,
        hqCountry: location.hqCountry,
        keywords: [],
        techStack: [],
        about: location.about,
        deliveryZone: location.deliveryZone
      },
      priorityScore: 0
    };
  });
}
