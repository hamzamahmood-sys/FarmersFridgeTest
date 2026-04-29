import { randomUUID } from "crypto";
import { Pool, type PoolClient } from "pg";
import { env } from "@/lib/env";
import type {
  DashboardStats,
  EmailStatus,
  GeneratedPitch,
  LeadRecord,
  LocationDetail,
  LocationType,
  PipelineStage,
  PitchType,
  ProspectCompany,
  ResearchEvidence,
  SavedLocation,
  SavedLocationSummary,
  StoredEmail,
  ToneSettings
} from "@/lib/types";
import { analyzeEmailQuality, statusAfterQualityCheck } from "@/lib/email-quality";
import { calculatePlacementFit } from "@/lib/fit-score";
import { inferLocationType, resolveContactDepartment } from "@/lib/utils";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

type SavedLocationFilters = {
  userId: number;
  query?: string;
  locationType?: LocationType | "all";
  pipelineStage?: PipelineStage | "all";
  limit?: number;
};

type EmailFilters = {
  userId: number;
  query?: string;
  status?: EmailStatus | "all";
  locationId?: string;
  limit?: number;
};

type SavedLocationInput = Omit<SavedLocation, "createdAt" | "updatedAt" | "fitScore" | "fitReasons">;

type StoredEmailInput = Omit<
  StoredEmail,
  "id" | "createdAt" | "updatedAt" | "status" | "qualityScore" | "qualityIssues"
> & {
  status?: EmailStatus;
  qualityScore?: number;
  qualityIssues?: string[];
};

type ResearchEvidenceInput = Omit<ResearchEvidence, "id" | "userId" | "createdAt">;

export function getPool(): Pool {
  if (!global.__pgPool) {
    global.__pgPool = new Pool({
      connectionString: env.databaseUrl,
      ssl: env.databaseSsl ? { rejectUnauthorized: false } : undefined,
      max: 10
    });
  }

  return global.__pgPool;
}

function toIso(value: unknown): string {
  if (!value) return new Date().toISOString();
  return new Date(value as string | number | Date).toISOString();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function rowToLeadRecord(row: Record<string, unknown>): LeadRecord {
  const title = (row.title as string) ?? "Unknown Title";

  return {
    lead: {
      id: row.id as string,
      externalId: (row.external_id as string) ?? undefined,
      name: row.name as string,
      email: (row.email as string) ?? "",
      title,
      linkedinUrl: (row.linkedin_url as string) ?? undefined,
      companyName: row.company_name as string,
      companyDomain: (row.company_domain as string) ?? undefined,
      organizationId: (row.organization_id as string) ?? undefined,
      department: resolveContactDepartment(
        (row.department as LeadRecord["lead"]["department"]) ?? undefined,
        title
      ),
      locationId: (row.location_id as string) ?? undefined,
      source: (row.source as LeadRecord["lead"]["source"]) ?? undefined,
      emailSource: (row.email_source as LeadRecord["lead"]["emailSource"]) ?? undefined
    },
    company: {
      industry: (row.industry as string) ?? undefined,
      employeeCount: (row.employee_count as number) ?? undefined,
      hqCity: (row.hq_city as string) ?? undefined,
      hqState: (row.hq_state as string) ?? undefined,
      hqCountry: (row.hq_country as string) ?? undefined,
      keywords: asStringArray(row.keywords),
      techStack: asStringArray(row.tech_stack),
      about: (row.about as string) ?? undefined,
      deliveryZone: (row.delivery_zone as LeadRecord["company"]["deliveryZone"]) ?? "Other"
    },
    priorityScore: Number(row.priority_score ?? 0)
  };
}

function rowToSavedLocation(row: Record<string, unknown>): SavedLocation {
  return {
    id: row.id as string,
    organizationId: (row.organization_id as string) ?? undefined,
    companyName: row.company_name as string,
    companyDomain: (row.company_domain as string) ?? undefined,
    industry: (row.industry as string) ?? undefined,
    employeeCount: (row.employee_count as number) ?? undefined,
    hqCity: (row.hq_city as string) ?? undefined,
    hqState: (row.hq_state as string) ?? undefined,
    hqCountry: (row.hq_country as string) ?? undefined,
    about: (row.about as string) ?? undefined,
    category: (row.category as string) ?? undefined,
    locationType: (row.location_type as SavedLocation["locationType"]) ?? "other",
    pipelineStage: (row.pipeline_stage as SavedLocation["pipelineStage"]) ?? "prospect",
    pitchType: (row.pitch_type as SavedLocation["pitchType"]) ?? "farmers_fridge",
    notes: (row.notes as string) ?? undefined,
    deliveryZone: (row.delivery_zone as SavedLocation["deliveryZone"]) ?? "Other",
    fitScore: Number(row.fit_score ?? 0),
    fitReasons: asStringArray(row.fit_reasons),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function rowToSavedLocationSummary(row: Record<string, unknown>): SavedLocationSummary {
  return {
    ...rowToSavedLocation(row),
    contactsCount: Number(row.contacts_count ?? 0),
    emailsCount: Number(row.emails_count ?? 0)
  };
}

function rowToStoredEmail(row: Record<string, unknown>): StoredEmail {
  return {
    id: row.id as string,
    locationId: (row.location_id as string) ?? undefined,
    leadId: (row.lead_id as string) ?? undefined,
    contactName: (row.contact_name as string) ?? undefined,
    contactEmail: (row.contact_email as string) ?? undefined,
    contactTitle: (row.contact_title as string) ?? undefined,
    companyName: (row.company_name as string) ?? undefined,
    locationType: (row.location_type as StoredEmail["locationType"]) ?? undefined,
    sequenceStep: Number(row.sequence_step ?? 0),
    subject: (row.subject as string) ?? "",
    body: (row.body as string) ?? "",
    status: (row.status as EmailStatus) ?? "generated",
    gmailDraftUrl: (row.gmail_draft_url as string) ?? undefined,
    gmailDraftId: (row.gmail_draft_id as string) ?? undefined,
    gmailMessageId: (row.gmail_message_id as string) ?? undefined,
    gmailThreadId: (row.gmail_thread_id as string) ?? undefined,
    scheduledFor: row.scheduled_for ? toIso(row.scheduled_for) : undefined,
    sentAt: row.sent_at ? toIso(row.sent_at) : undefined,
    replyDetectedAt: row.reply_detected_at ? toIso(row.reply_detected_at) : undefined,
    qualityScore: Number(row.quality_score ?? 0),
    qualityIssues: asStringArray(row.quality_issues),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function rowToResearchEvidence(row: Record<string, unknown>): ResearchEvidence {
  return {
    id: row.id as string,
    userId: Number(row.user_id ?? 0),
    locationId: (row.location_id as string) ?? undefined,
    leadId: (row.lead_id as string) ?? undefined,
    sourceTitle: (row.source_title as string) ?? undefined,
    sourceUrl: (row.source_url as string) ?? undefined,
    snippet: (row.snippet as string) ?? "",
    confidence: row.confidence === null || row.confidence === undefined ? undefined : Number(row.confidence),
    createdAt: toIso(row.created_at)
  };
}

async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ─── Leads ────────────────────────────────────────────────────────────────────

export async function cacheLeads(
  userId: number,
  records: LeadRecord[],
  searchQuery: string,
  options?: { locationId?: string }
): Promise<LeadRecord[]> {
  if (records.length === 0) return [];

  try {
    return await withTransaction(async (client) => {
      const cached: LeadRecord[] = [];

      for (const record of records) {
        const locationId = options?.locationId ?? record.lead.locationId ?? null;
        const department = resolveContactDepartment(record.lead.department, record.lead.title);
        const externalId = record.lead.externalId || record.lead.id || randomUUID();
        const id = randomUUID();

        const { rows } = await client.query(
          `INSERT INTO leads (
            id, user_id, external_id, name, email, title, linkedin_url, company_name, company_domain, organization_id,
            industry, employee_count, hq_city, hq_state, hq_country, keywords, tech_stack, about,
            delivery_zone, priority_score, search_query, fetched_at, location_id, department,
            source, email_source
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW(),$22,$23,$24,$25
          )
          ON CONFLICT (user_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
            name = EXCLUDED.name,
            email = EXCLUDED.email,
            title = EXCLUDED.title,
            linkedin_url = EXCLUDED.linkedin_url,
            company_name = EXCLUDED.company_name,
            company_domain = EXCLUDED.company_domain,
            organization_id = EXCLUDED.organization_id,
            industry = EXCLUDED.industry,
            employee_count = EXCLUDED.employee_count,
            hq_city = EXCLUDED.hq_city,
            hq_state = EXCLUDED.hq_state,
            hq_country = EXCLUDED.hq_country,
            keywords = EXCLUDED.keywords,
            tech_stack = EXCLUDED.tech_stack,
            about = EXCLUDED.about,
            delivery_zone = EXCLUDED.delivery_zone,
            priority_score = EXCLUDED.priority_score,
            search_query = EXCLUDED.search_query,
            fetched_at = NOW(),
            location_id = COALESCE(EXCLUDED.location_id, leads.location_id),
            department = COALESCE(EXCLUDED.department, leads.department),
            source = COALESCE(EXCLUDED.source, leads.source),
            email_source = COALESCE(EXCLUDED.email_source, leads.email_source)
          RETURNING *`,
          [
            id,
            userId,
            externalId,
            record.lead.name,
            record.lead.email || null,
            record.lead.title || null,
            record.lead.linkedinUrl || null,
            record.lead.companyName,
            record.lead.companyDomain || null,
            record.lead.organizationId || null,
            record.company.industry || null,
            record.company.employeeCount ?? null,
            record.company.hqCity || null,
            record.company.hqState || null,
            record.company.hqCountry || null,
            record.company.keywords,
            record.company.techStack,
            record.company.about || null,
            record.company.deliveryZone,
            record.priorityScore,
            searchQuery,
            locationId,
            department,
            record.lead.source ?? null,
            record.lead.emailSource ?? null
          ]
        );

        cached.push(rowToLeadRecord(rows[0] as Record<string, unknown>));
      }

      return cached;
    });
  } catch (error) {
    console.error("[db] cacheLeads error:", error instanceof Error ? error.message : error);
    return records;
  }
}

export async function getCachedLeads(
  userId: number,
  searchQuery: string,
  maxAgeHours?: number
): Promise<LeadRecord[] | null> {
  const pool = getPool();
  const params: unknown[] = [userId, searchQuery];
  let sql = "SELECT * FROM leads WHERE user_id = $1 AND search_query = $2";

  if (typeof maxAgeHours === "number" && Number.isFinite(maxAgeHours)) {
    params.push(new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString());
    sql += ` AND fetched_at >= $${params.length}`;
  }

  sql += " ORDER BY priority_score DESC";

  try {
    const { rows } = await pool.query(sql, params);
    if (rows.length === 0) return null;
    return rows.map((row) => rowToLeadRecord(row as Record<string, unknown>));
  } catch (error) {
    console.error("[db] getCachedLeads error:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function getRecentSearches(
  userId: number,
  limit = 5
): Promise<Array<{ query: string; count: number; fetchedAt: string }>> {
  try {
    const { rows } = await getPool().query<{
      search_query: string;
      count: string;
      fetched_at: Date;
    }>(
      `SELECT search_query, COUNT(*)::text AS count, MAX(fetched_at) AS fetched_at
       FROM leads
       WHERE user_id = $1 AND search_query IS NOT NULL
       GROUP BY search_query
       ORDER BY MAX(fetched_at) DESC
       LIMIT $2`,
      [userId, limit]
    );

    return rows.map((row) => ({
      query: row.search_query,
      count: Number(row.count),
      fetchedAt: new Date(row.fetched_at).toISOString()
    }));
  } catch (error) {
    console.error("[db] getRecentSearches error:", error instanceof Error ? error.message : error);
    return [];
  }
}

export async function getLocationContacts(userId: number, locationId: string): Promise<LeadRecord[]> {
  try {
    const { rows } = await getPool().query(
      "SELECT * FROM leads WHERE user_id = $1 AND location_id = $2 ORDER BY priority_score DESC, name ASC",
      [userId, locationId]
    );
    return rows.map((row) => rowToLeadRecord(row as Record<string, unknown>));
  } catch (error) {
    console.error("[db] getLocationContacts error:", error instanceof Error ? error.message : error);
    return [];
  }
}

export async function getLeadById(userId: number, leadId: string): Promise<LeadRecord | null> {
  try {
    const { rows } = await getPool().query(
      "SELECT * FROM leads WHERE id = $1 AND user_id = $2 LIMIT 1",
      [leadId, userId]
    );
    if (rows.length === 0) return null;
    return rowToLeadRecord(rows[0] as Record<string, unknown>);
  } catch (error) {
    console.error("[db] getLeadById error:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function updateLeadContact(
  userId: number,
  leadId: string,
  updates: {
    email?: string;
    linkedinUrl?: string;
    companyDomain?: string;
    organizationId?: string;
    locationId?: string;
    emailSource?: "apollo" | "tomba" | "ai" | "existing" | null;
  }
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.email !== undefined) {
    params.push(updates.email || null);
    sets.push(`email = $${params.length}`);
  }
  if (updates.linkedinUrl !== undefined) {
    params.push(updates.linkedinUrl || null);
    sets.push(`linkedin_url = $${params.length}`);
  }
  if (updates.companyDomain !== undefined) {
    params.push(updates.companyDomain || null);
    sets.push(`company_domain = $${params.length}`);
  }
  if (updates.organizationId !== undefined) {
    params.push(updates.organizationId || null);
    sets.push(`organization_id = $${params.length}`);
  }
  if (updates.locationId !== undefined) {
    params.push(updates.locationId || null);
    sets.push(`location_id = $${params.length}`);
  }
  if (updates.emailSource !== undefined) {
    params.push(updates.emailSource || null);
    sets.push(`email_source = $${params.length}`);
  }

  if (sets.length === 0) return true;

  sets.push("fetched_at = NOW()");
  params.push(leadId);

  try {
    params.push(userId);
    const result = await getPool().query(
      `UPDATE leads SET ${sets.join(", ")} WHERE id = $${params.length - 1} AND user_id = $${params.length}`,
      params
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error("[db] updateLeadContact error:", error instanceof Error ? error.message : error);
    throw error;
  }
}

// ─── Pitches ──────────────────────────────────────────────────────────────────

export async function cachePitch(userId: number, leadId: string, pitch: GeneratedPitch): Promise<void> {
  try {
    await withTransaction(async (client) => {
      await client.query("DELETE FROM pitches WHERE user_id = $1 AND lead_id = $2", [userId, leadId]);
      await client.query(
        `INSERT INTO pitches (
          user_id, lead_id, subject, body, talking_points, bridge_insight, summary, pain_points, variable_evidence
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          userId,
          leadId,
          pitch.subject,
          pitch.body,
          pitch.talkingPoints,
          pitch.bridgeInsight,
          pitch.summary,
          pitch.painPoints,
          pitch.variableEvidence
        ]
      );

      if (pitch.researchEvidence && pitch.researchEvidence.length > 0) {
        await client.query("DELETE FROM research_evidence WHERE user_id = $1 AND lead_id = $2", [userId, leadId]);
        for (const evidence of pitch.researchEvidence.slice(0, 8)) {
          if (!evidence.snippet.trim()) continue;
          await client.query(
            `INSERT INTO research_evidence (
              user_id, location_id, lead_id, source_title, source_url, snippet, confidence
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              userId,
              evidence.locationId || null,
              leadId,
              evidence.sourceTitle || null,
              evidence.sourceUrl || null,
              evidence.snippet,
              evidence.confidence ?? null
            ]
          );
        }
      }
    });
  } catch (error) {
    console.error("[db] cachePitch error:", error instanceof Error ? error.message : error);
  }
}

export async function getCachedPitch(
  userId: number,
  leadId: string,
  maxAgeHours?: number
): Promise<GeneratedPitch | null> {
  const params: unknown[] = [userId, leadId];
  let sql = "SELECT * FROM pitches WHERE user_id = $1 AND lead_id = $2";

  if (typeof maxAgeHours === "number" && Number.isFinite(maxAgeHours)) {
    params.push(new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString());
    sql += ` AND created_at >= $${params.length}`;
  }

  sql += " ORDER BY created_at DESC LIMIT 1";

  try {
    const { rows } = await getPool().query(sql, params);
    if (rows.length === 0) return null;
    const row = rows[0] as Record<string, unknown>;

    const researchEvidence = await listResearchEvidenceForLead(userId, leadId);

    return {
      subject: (row.subject as string) ?? "",
      body: (row.body as string) ?? "",
      talkingPoints: (row.talking_points as string) ?? "",
      bridgeInsight: (row.bridge_insight as string) ?? "",
      summary: (row.summary as string) ?? "",
      painPoints: asStringArray(row.pain_points),
      variableEvidence: asStringArray(row.variable_evidence),
      researchEvidence
    };
  } catch (error) {
    console.error("[db] getCachedPitch error:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function replaceResearchEvidence(
  userId: number,
  leadId: string,
  evidence: ResearchEvidenceInput[]
): Promise<ResearchEvidence[]> {
  try {
    return await withTransaction(async (client) => {
      await client.query("DELETE FROM research_evidence WHERE user_id = $1 AND lead_id = $2", [userId, leadId]);
      const created: ResearchEvidence[] = [];

      for (const item of evidence.slice(0, 8)) {
        if (!item.snippet.trim()) continue;
        const { rows } = await client.query(
          `INSERT INTO research_evidence (
            user_id, location_id, lead_id, source_title, source_url, snippet, confidence
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)
          RETURNING *`,
          [
            userId,
            item.locationId || null,
            leadId,
            item.sourceTitle || null,
            item.sourceUrl || null,
            item.snippet,
            item.confidence ?? null
          ]
        );
        created.push(rowToResearchEvidence(rows[0] as Record<string, unknown>));
      }

      return created;
    });
  } catch (error) {
    console.error("[db] replaceResearchEvidence error:", error instanceof Error ? error.message : error);
    return [];
  }
}

export async function listResearchEvidenceForLead(userId: number, leadId: string): Promise<ResearchEvidence[]> {
  try {
    const { rows } = await getPool().query(
      `SELECT *
       FROM research_evidence
       WHERE user_id = $1 AND lead_id = $2
       ORDER BY created_at DESC`,
      [userId, leadId]
    );
    return rows.map((row) => rowToResearchEvidence(row as Record<string, unknown>));
  } catch (error) {
    console.error("[db] listResearchEvidenceForLead error:", error instanceof Error ? error.message : error);
    return [];
  }
}

export async function listResearchEvidenceForLocation(
  userId: number,
  locationId: string
): Promise<ResearchEvidence[]> {
  try {
    const { rows } = await getPool().query(
      `SELECT *
       FROM research_evidence
       WHERE user_id = $1 AND location_id = $2
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId, locationId]
    );
    return rows.map((row) => rowToResearchEvidence(row as Record<string, unknown>));
  } catch (error) {
    console.error("[db] listResearchEvidenceForLocation error:", error instanceof Error ? error.message : error);
    return [];
  }
}

// ─── Saved locations ──────────────────────────────────────────────────────────

export async function upsertSavedLocation(
  userId: number,
  input: SavedLocationInput
): Promise<SavedLocation> {
  const fit = calculatePlacementFit({
    companyName: input.companyName,
    industry: input.industry,
    employeeCount: input.employeeCount,
    hqCity: input.hqCity,
    hqState: input.hqState,
    about: input.about,
    category: input.category,
    locationType: input.locationType,
    deliveryZone: input.deliveryZone
  });
  const params = [
    input.id,
    userId,
    input.organizationId || null,
    input.companyName,
    input.companyDomain || null,
    input.industry || null,
    input.employeeCount ?? null,
    input.hqCity || null,
    input.hqState || null,
    input.hqCountry || null,
    input.about || null,
    input.category || null,
    input.locationType,
    input.pipelineStage,
    input.pitchType,
    input.notes || null,
    input.deliveryZone,
    fit.score,
    fit.reasons
  ];
  const conflictTarget = input.organizationId
    ? "(user_id, organization_id) WHERE organization_id IS NOT NULL"
    : "(id)";

  const { rows } = await getPool().query(
    `INSERT INTO saved_locations (
      id, user_id, organization_id, company_name, company_domain, industry, employee_count,
      hq_city, hq_state, hq_country, about, category, location_type, pipeline_stage,
      pitch_type, notes, delivery_zone, fit_score, fit_reasons
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
    )
    ON CONFLICT ${conflictTarget} DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      company_name = EXCLUDED.company_name,
      company_domain = EXCLUDED.company_domain,
      industry = EXCLUDED.industry,
      employee_count = EXCLUDED.employee_count,
      hq_city = EXCLUDED.hq_city,
      hq_state = EXCLUDED.hq_state,
      hq_country = EXCLUDED.hq_country,
      about = EXCLUDED.about,
      category = EXCLUDED.category,
      location_type = EXCLUDED.location_type,
      pipeline_stage = COALESCE(saved_locations.pipeline_stage, EXCLUDED.pipeline_stage),
      pitch_type = COALESCE(saved_locations.pitch_type, EXCLUDED.pitch_type),
      notes = COALESCE(saved_locations.notes, EXCLUDED.notes),
      delivery_zone = EXCLUDED.delivery_zone,
      fit_score = EXCLUDED.fit_score,
      fit_reasons = EXCLUDED.fit_reasons,
      updated_at = NOW()
    WHERE saved_locations.user_id = EXCLUDED.user_id
    RETURNING *`,
    params
  );

  if (rows.length === 0) {
    throw new Error("Location is owned by another user.");
  }

  return rowToSavedLocation(rows[0] as Record<string, unknown>);
}

export async function saveProspectCompanyAsLocation(
  userId: number,
  company: ProspectCompany
): Promise<SavedLocation> {
  return upsertSavedLocation(userId, {
    id: randomUUID(),
    organizationId: company.id,
    companyName: company.name,
    companyDomain: company.domain,
    industry: company.company.industry,
    employeeCount: company.company.employeeCount,
    hqCity: company.company.hqCity,
    hqState: company.company.hqState,
    hqCountry: company.company.hqCountry,
    about: company.company.about,
    category: company.company.industry || company.company.keywords[0] || undefined,
    locationType: inferLocationType({
      name: company.name,
      industry: company.company.industry,
      about: company.company.about,
      keywords: company.company.keywords
    }),
    pipelineStage: "prospect",
    pitchType: "farmers_fridge",
    notes: "",
    deliveryZone: company.company.deliveryZone
  });
}

export async function listSavedLocations(filters: SavedLocationFilters): Promise<SavedLocationSummary[]> {
  const params: unknown[] = [filters.userId];
  const conditions: string[] = [`sl.user_id = $${params.length}`];

  if (filters.query?.trim()) {
    params.push(`%${filters.query.trim()}%`);
    conditions.push(
      `(sl.company_name ILIKE $${params.length} OR sl.company_domain ILIKE $${params.length} OR COALESCE(sl.category, '') ILIKE $${params.length})`
    );
  }

  if (filters.locationType && filters.locationType !== "all") {
    params.push(filters.locationType);
    conditions.push(`sl.location_type = $${params.length}`);
  }

  if (filters.pipelineStage && filters.pipelineStage !== "all") {
    params.push(filters.pipelineStage);
    conditions.push(`sl.pipeline_stage = $${params.length}`);
  }

  params.push(filters.limit ?? 100);

  const sql = `
    SELECT
      sl.*,
      COALESCE(lc.contacts_count, 0) AS contacts_count,
      COALESCE(ec.emails_count, 0) AS emails_count
    FROM saved_locations sl
    LEFT JOIN (
      SELECT user_id, location_id, COUNT(*)::int AS contacts_count
      FROM leads
      WHERE location_id IS NOT NULL
      GROUP BY user_id, location_id
    ) lc ON lc.location_id = sl.id AND lc.user_id = sl.user_id
    LEFT JOIN (
      SELECT user_id, location_id, COUNT(*)::int AS emails_count
      FROM emails
      WHERE location_id IS NOT NULL
      GROUP BY user_id, location_id
    ) ec ON ec.location_id = sl.id AND ec.user_id = sl.user_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY sl.updated_at DESC
    LIMIT $${params.length}
  `;

  try {
    const { rows } = await getPool().query(sql, params);
    return rows.map((row) => rowToSavedLocationSummary(row as Record<string, unknown>));
  } catch (error) {
    console.error("[db] listSavedLocations error:", error instanceof Error ? error.message : error);
    return [];
  }
}

export async function getSavedLocationById(userId: number, id: string): Promise<SavedLocation | null> {
  try {
    const { rows } = await getPool().query(
      "SELECT * FROM saved_locations WHERE id = $1 AND user_id = $2 LIMIT 1",
      [id, userId]
    );
    if (rows.length === 0) return null;
    return rowToSavedLocation(rows[0] as Record<string, unknown>);
  } catch (error) {
    console.error("[db] getSavedLocationById error:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function getLocationDetail(userId: number, id: string): Promise<LocationDetail | null> {
  const location = await getSavedLocationById(userId, id);
  if (!location) return null;

  const [contacts, emails, researchEvidence] = await Promise.all([
    getLocationContacts(userId, id),
    getLocationEmails(userId, id),
    listResearchEvidenceForLocation(userId, id)
  ]);
  return { location, contacts, emails, researchEvidence };
}

export async function updateSavedLocation(
  userId: number,
  id: string,
  updates: Partial<
    Pick<SavedLocation, "about" | "category" | "notes" | "locationType" | "pipelineStage" | "pitchType">
  >
): Promise<SavedLocation | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.about !== undefined) {
    params.push(updates.about || null);
    sets.push(`about = $${params.length}`);
  }
  if (updates.category !== undefined) {
    params.push(updates.category || null);
    sets.push(`category = $${params.length}`);
  }
  if (updates.notes !== undefined) {
    params.push(updates.notes || null);
    sets.push(`notes = $${params.length}`);
  }
  if (updates.locationType !== undefined) {
    params.push(updates.locationType);
    sets.push(`location_type = $${params.length}`);
  }
  if (updates.pipelineStage !== undefined) {
    params.push(updates.pipelineStage);
    sets.push(`pipeline_stage = $${params.length}`);
  }
  if (updates.pitchType !== undefined) {
    params.push(updates.pitchType);
    sets.push(`pitch_type = $${params.length}`);
  }

  if (sets.length === 0) {
    return getSavedLocationById(userId, id);
  }

  const currentLocation = await getSavedLocationById(userId, id);
  if (!currentLocation) return null;
  const nextLocation = { ...currentLocation, ...updates };
  const fit = calculatePlacementFit({
    companyName: nextLocation.companyName,
    industry: nextLocation.industry,
    employeeCount: nextLocation.employeeCount,
    hqCity: nextLocation.hqCity,
    hqState: nextLocation.hqState,
    about: nextLocation.about,
    category: nextLocation.category,
    locationType: nextLocation.locationType,
    deliveryZone: nextLocation.deliveryZone
  });
  params.push(fit.score);
  sets.push(`fit_score = $${params.length}`);
  params.push(fit.reasons);
  sets.push(`fit_reasons = $${params.length}`);

  sets.push("updated_at = NOW()");
  params.push(id);
  const idParamIdx = params.length;
  params.push(userId);
  const userParamIdx = params.length;

  try {
    const { rows } = await getPool().query(
      `UPDATE saved_locations SET ${sets.join(", ")} WHERE id = $${idParamIdx} AND user_id = $${userParamIdx} RETURNING *`,
      params
    );
    if (rows.length === 0) return null;
    return rowToSavedLocation(rows[0] as Record<string, unknown>);
  } catch (error) {
    console.error("[db] updateSavedLocation error:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function deleteSavedLocation(userId: number, id: string): Promise<void> {
  try {
    await getPool().query(
      "DELETE FROM saved_locations WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
  } catch (error) {
    console.error("[db] deleteSavedLocation error:", error instanceof Error ? error.message : error);
  }
}

export async function getDashboardStats(userId: number): Promise<DashboardStats> {
  const stats: DashboardStats = {
    locationsCount: 0,
    draftsCount: 0,
    wonCount: 0,
    dueTodayCount: 0,
    repliedCount: 0,
    highFitCount: 0,
    averageFitScore: 0,
    pipelineByStage: {
      prospect: 0,
      meeting: 0,
      won: 0,
      lost: 0
    },
    byLocationType: {
      hospital: 0,
      corporate: 0,
      university: 0,
      gym: 0,
      airport: 0,
      other: 0
    }
  };

  try {
    const [summaryResult, stageResult, typeResult] = await Promise.all([
      getPool().query<{
        locations_count: string;
        drafts_count: string;
        won_count: string;
        due_today_count: string;
        replied_count: string;
        high_fit_count: string;
        average_fit_score: string;
      }>(
        `SELECT
          COUNT(*)::text AS locations_count,
          (SELECT COUNT(*)::text FROM emails WHERE user_id = $1) AS drafts_count,
          (SELECT COUNT(*)::text FROM emails
            WHERE user_id = $1
              AND scheduled_for IS NOT NULL
              AND scheduled_for <= NOW()
              AND status NOT IN ('sent', 'replied')) AS due_today_count,
          (SELECT COUNT(*)::text FROM emails
            WHERE user_id = $1
              AND (status = 'replied' OR reply_detected_at IS NOT NULL)) AS replied_count,
          COUNT(*) FILTER (WHERE fit_score >= 75)::text AS high_fit_count,
          COALESCE(ROUND(AVG(NULLIF(fit_score, 0)))::text, '0') AS average_fit_score,
          COUNT(*) FILTER (WHERE pipeline_stage = 'won')::text AS won_count
         FROM saved_locations
         WHERE user_id = $1`,
        [userId]
      ),
      getPool().query<{ pipeline_stage: PipelineStage; count: string }>(
        `SELECT pipeline_stage, COUNT(*)::text AS count
         FROM saved_locations
         WHERE user_id = $1
         GROUP BY pipeline_stage`,
        [userId]
      ),
      getPool().query<{ location_type: LocationType; count: string }>(
        `SELECT location_type, COUNT(*)::text AS count
         FROM saved_locations
         WHERE user_id = $1
         GROUP BY location_type`,
        [userId]
      )
    ]);

    const summary = summaryResult.rows[0];
    if (summary) {
      stats.locationsCount = Number(summary.locations_count ?? 0);
      stats.draftsCount = Number(summary.drafts_count ?? 0);
      stats.wonCount = Number(summary.won_count ?? 0);
      stats.dueTodayCount = Number(summary.due_today_count ?? 0);
      stats.repliedCount = Number(summary.replied_count ?? 0);
      stats.highFitCount = Number(summary.high_fit_count ?? 0);
      stats.averageFitScore = Number(summary.average_fit_score ?? 0);
    }

    for (const row of stageResult.rows) {
      stats.pipelineByStage[row.pipeline_stage] = Number(row.count);
    }

    for (const row of typeResult.rows) {
      stats.byLocationType[row.location_type] = Number(row.count);
    }

    return stats;
  } catch (error) {
    console.error("[db] getDashboardStats error:", error instanceof Error ? error.message : error);
    return stats;
  }
}

// ─── Emails ───────────────────────────────────────────────────────────────────

export async function getLocationEmails(userId: number, locationId: string): Promise<StoredEmail[]> {
  try {
    const { rows } = await getPool().query(
      "SELECT * FROM emails WHERE location_id = $1 AND user_id = $2 ORDER BY updated_at DESC, sequence_step ASC",
      [locationId, userId]
    );
    return rows.map((row) => rowToStoredEmail(row as Record<string, unknown>));
  } catch (error) {
    console.error("[db] getLocationEmails error:", error instanceof Error ? error.message : error);
    return [];
  }
}

export async function listEmails(filters: EmailFilters): Promise<StoredEmail[]> {
  const params: unknown[] = [filters.userId];
  const conditions: string[] = [`user_id = $${params.length}`];

  if (filters.query?.trim()) {
    params.push(`%${filters.query.trim()}%`);
    conditions.push(
      `(COALESCE(subject, '') ILIKE $${params.length}
        OR COALESCE(company_name, '') ILIKE $${params.length}
        OR COALESCE(contact_name, '') ILIKE $${params.length}
        OR COALESCE(contact_email, '') ILIKE $${params.length})`
    );
  }

  if (filters.status && filters.status !== "all") {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }

  if (filters.locationId) {
    params.push(filters.locationId);
    conditions.push(`location_id = $${params.length}`);
  }

  params.push(filters.limit ?? 200);

  const sql = `
    SELECT *
    FROM emails
    WHERE ${conditions.join(" AND ")}
    ORDER BY updated_at DESC, sequence_step ASC
    LIMIT $${params.length}
  `;

  try {
    const { rows } = await getPool().query(sql, params);
    return rows.map((row) => rowToStoredEmail(row as Record<string, unknown>));
  } catch (error) {
    console.error("[db] listEmails error:", error instanceof Error ? error.message : error);
    return [];
  }
}

export async function replaceEmailsForLead(
  userId: number,
  leadId: string,
  emails: StoredEmailInput[]
): Promise<StoredEmail[]> {
  try {
    return await withTransaction(async (client) => {
      const leadResult = await client.query("SELECT id FROM leads WHERE id = $1 AND user_id = $2 LIMIT 1", [
        leadId,
        userId
      ]);
      if (leadResult.rows.length === 0) {
        throw new Error("Lead not found for this user.");
      }

      const locationIds = [
        ...new Set(emails.map((email) => email.locationId).filter((value): value is string => Boolean(value)))
      ];
      if (locationIds.length > 0) {
        const locationResult = await client.query<{ id: string }>(
          "SELECT id FROM saved_locations WHERE user_id = $1 AND id = ANY($2::text[])",
          [userId, locationIds]
        );
        const ownedLocationIds = new Set(locationResult.rows.map((row) => row.id));
        const unownedLocationId = locationIds.find((id) => !ownedLocationIds.has(id));
        if (unownedLocationId) {
          throw new Error("Location not found for this user.");
        }
      }

      await client.query("DELETE FROM emails WHERE lead_id = $1 AND user_id = $2", [leadId, userId]);

      const created: StoredEmail[] = [];
      for (const email of emails) {
        const quality = analyzeEmailQuality(email);
        const status = statusAfterQualityCheck(email.status, quality);
        const { rows } = await client.query(
          `INSERT INTO emails (
            user_id, location_id, lead_id, contact_name, contact_email, contact_title, company_name,
            location_type, sequence_step, subject, body, status, gmail_draft_url, gmail_draft_id,
            gmail_message_id, gmail_thread_id, scheduled_for, sent_at, reply_detected_at,
            quality_score, quality_issues
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
          )
          RETURNING *`,
          [
            userId,
            email.locationId || null,
            leadId,
            email.contactName || null,
            email.contactEmail || null,
            email.contactTitle || null,
            email.companyName || null,
            email.locationType || null,
            email.sequenceStep,
            email.subject,
            email.body,
            status,
            email.gmailDraftUrl || null,
            email.gmailDraftId || null,
            email.gmailMessageId || null,
            email.gmailThreadId || null,
            email.scheduledFor || null,
            email.sentAt || null,
            email.replyDetectedAt || null,
            email.qualityScore ?? quality.score,
            email.qualityIssues ?? quality.issues
          ]
        );

        created.push(rowToStoredEmail(rows[0] as Record<string, unknown>));
      }

      return created;
    });
  } catch (error) {
    console.error("[db] replaceEmailsForLead error:", error instanceof Error ? error.message : error);
    throw error;
  }
}

export async function getEmailById(userId: number, id: string): Promise<StoredEmail | null> {
  try {
    const { rows } = await getPool().query(
      "SELECT * FROM emails WHERE id = $1 AND user_id = $2 LIMIT 1",
      [id, userId]
    );
    if (rows.length === 0) return null;
    return rowToStoredEmail(rows[0] as Record<string, unknown>);
  } catch (error) {
    console.error("[db] getEmailById error:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function updateEmail(
  userId: number,
  id: string,
  updates: Partial<
    Pick<
      StoredEmail,
      | "subject"
      | "body"
      | "status"
      | "gmailDraftUrl"
      | "gmailDraftId"
      | "gmailMessageId"
      | "gmailThreadId"
      | "scheduledFor"
      | "sentAt"
      | "replyDetectedAt"
      | "qualityScore"
      | "qualityIssues"
    >
  >
): Promise<StoredEmail | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.subject !== undefined) {
    params.push(updates.subject);
    sets.push(`subject = $${params.length}`);
  }
  if (updates.body !== undefined) {
    params.push(updates.body);
    sets.push(`body = $${params.length}`);
  }
  if (updates.status !== undefined) {
    params.push(updates.status);
    sets.push(`status = $${params.length}`);
  }
  if (updates.gmailDraftUrl !== undefined) {
    params.push(updates.gmailDraftUrl || null);
    sets.push(`gmail_draft_url = $${params.length}`);
  }
  if (updates.gmailDraftId !== undefined) {
    params.push(updates.gmailDraftId || null);
    sets.push(`gmail_draft_id = $${params.length}`);
  }
  if (updates.gmailMessageId !== undefined) {
    params.push(updates.gmailMessageId || null);
    sets.push(`gmail_message_id = $${params.length}`);
  }
  if (updates.gmailThreadId !== undefined) {
    params.push(updates.gmailThreadId || null);
    sets.push(`gmail_thread_id = $${params.length}`);
  }
  if (updates.scheduledFor !== undefined) {
    params.push(updates.scheduledFor || null);
    sets.push(`scheduled_for = $${params.length}`);
  }
  if (updates.sentAt !== undefined) {
    params.push(updates.sentAt || null);
    sets.push(`sent_at = $${params.length}`);
  }
  if (updates.replyDetectedAt !== undefined) {
    params.push(updates.replyDetectedAt || null);
    sets.push(`reply_detected_at = $${params.length}`);
  }
  if (updates.qualityScore !== undefined) {
    params.push(updates.qualityScore);
    sets.push(`quality_score = $${params.length}`);
  }
  if (updates.qualityIssues !== undefined) {
    params.push(updates.qualityIssues);
    sets.push(`quality_issues = $${params.length}`);
  }

  if ((updates.subject !== undefined || updates.body !== undefined) && updates.qualityScore === undefined) {
    const current = await getEmailById(userId, id);
    if (current) {
      const quality = analyzeEmailQuality({
        ...current,
        subject: updates.subject ?? current.subject,
        body: updates.body ?? current.body
      });
      params.push(quality.score);
      sets.push(`quality_score = $${params.length}`);
      params.push(quality.issues);
      sets.push(`quality_issues = $${params.length}`);
      if (updates.status === undefined && current.status !== "sent" && current.status !== "replied") {
        params.push(statusAfterQualityCheck(current.status, quality));
        sets.push(`status = $${params.length}`);
      }
    }
  }

  if (sets.length === 0) {
    return null;
  }

  sets.push("updated_at = NOW()");
  params.push(id);
  const idParamIdx = params.length;
  params.push(userId);
  const userParamIdx = params.length;

  try {
    const { rows } = await getPool().query(
      `UPDATE emails SET ${sets.join(", ")} WHERE id = $${idParamIdx} AND user_id = $${userParamIdx} RETURNING *`,
      params
    );
    if (rows.length === 0) return null;
    return rowToStoredEmail(rows[0] as Record<string, unknown>);
  } catch (error) {
    console.error("[db] updateEmail error:", error instanceof Error ? error.message : error);
    return null;
  }
}

// ─── Tone settings ────────────────────────────────────────────────────────────

export async function getToneSettings(userId: number): Promise<ToneSettings> {
  try {
    const { rows } = await getPool().query(
      "SELECT * FROM tone_settings WHERE user_id = $1 LIMIT 1",
      [userId]
    );

    if (rows.length === 0) {
      return {
        voiceDescription: "",
        doExamples: "",
        dontExamples: "",
        sampleEmail: ""
      };
    }

    const row = rows[0] as Record<string, unknown>;
    return {
      voiceDescription: (row.voice_description as string) ?? "",
      doExamples: (row.do_examples as string) ?? "",
      dontExamples: (row.dont_examples as string) ?? "",
      sampleEmail: (row.sample_email as string) ?? "",
      updatedAt: toIso(row.updated_at)
    };
  } catch (error) {
    console.error("[db] getToneSettings error:", error instanceof Error ? error.message : error);
    return {
      voiceDescription: "",
      doExamples: "",
      dontExamples: "",
      sampleEmail: ""
    };
  }
}

export async function upsertToneSettings(userId: number, tone: ToneSettings): Promise<ToneSettings> {
  const { rows } = await getPool().query(
    `INSERT INTO tone_settings (
      user_id, voice_description, do_examples, dont_examples, sample_email
    ) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (user_id) DO UPDATE SET
      voice_description = EXCLUDED.voice_description,
      do_examples = EXCLUDED.do_examples,
      dont_examples = EXCLUDED.dont_examples,
      sample_email = EXCLUDED.sample_email,
      updated_at = NOW()
    RETURNING *`,
    [userId, tone.voiceDescription, tone.doExamples, tone.dontExamples, tone.sampleEmail]
  );

  const row = rows[0] as Record<string, unknown>;
  return {
    voiceDescription: (row.voice_description as string) ?? "",
    doExamples: (row.do_examples as string) ?? "",
    dontExamples: (row.dont_examples as string) ?? "",
    sampleEmail: (row.sample_email as string) ?? "",
    updatedAt: toIso(row.updated_at)
  };
}
