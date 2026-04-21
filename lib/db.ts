import { Pool } from "pg";
import { env } from "@/lib/env";
import type { GeneratedPitch, LeadRecord } from "@/lib/types";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

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

// ─── Leads ────────────────────────────────────────────────────────────────────

function rowToLeadRecord(row: Record<string, unknown>): LeadRecord {
  return {
    lead: {
      id: row.id as string,
      name: row.name as string,
      email: (row.email as string) ?? "",
      title: (row.title as string) ?? "Unknown Title",
      linkedinUrl: (row.linkedin_url as string) ?? undefined,
      companyName: row.company_name as string,
      companyDomain: (row.company_domain as string) ?? undefined,
      organizationId: (row.organization_id as string) ?? undefined
    },
    company: {
      industry: (row.industry as string) ?? undefined,
      employeeCount: (row.employee_count as number) ?? undefined,
      hqCity: (row.hq_city as string) ?? undefined,
      hqState: (row.hq_state as string) ?? undefined,
      hqCountry: (row.hq_country as string) ?? undefined,
      keywords: (row.keywords as string[]) ?? [],
      techStack: (row.tech_stack as string[]) ?? [],
      about: (row.about as string) ?? undefined,
      deliveryZone: (row.delivery_zone as LeadRecord["company"]["deliveryZone"]) ?? "Other"
    },
    priorityScore: (row.priority_score as number) ?? 0
  };
}

/** Upsert a batch of leads — replaces on id conflict. */
export async function cacheLeads(records: LeadRecord[], searchQuery: string): Promise<void> {
  if (records.length === 0) return;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of records) {
      await client.query(
        `INSERT INTO leads (
          id, name, email, title, linkedin_url, company_name, company_domain, organization_id,
          industry, employee_count, hq_city, hq_state, hq_country, keywords, tech_stack, about,
          delivery_zone, priority_score, search_query, fetched_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
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
          fetched_at = NOW()`,
        [
          r.lead.id,
          r.lead.name,
          r.lead.email || null,
          r.lead.title || null,
          r.lead.linkedinUrl || null,
          r.lead.companyName,
          r.lead.companyDomain || null,
          r.lead.organizationId || null,
          r.company.industry || null,
          r.company.employeeCount ?? null,
          r.company.hqCity || null,
          r.company.hqState || null,
          r.company.hqCountry || null,
          r.company.keywords,
          r.company.techStack,
          r.company.about || null,
          r.company.deliveryZone,
          r.priorityScore,
          searchQuery
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[db] cacheLeads error:", error instanceof Error ? error.message : error);
  } finally {
    client.release();
  }
}

export async function getCachedLeads(
  searchQuery: string,
  maxAgeHours?: number
): Promise<LeadRecord[] | null> {
  const pool = getPool();
  const params: unknown[] = [searchQuery];
  let sql = "SELECT * FROM leads WHERE search_query = $1";

  if (typeof maxAgeHours === "number" && Number.isFinite(maxAgeHours)) {
    params.push(new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString());
    sql += ` AND fetched_at >= $${params.length}`;
  }
  sql += " ORDER BY priority_score DESC";

  try {
    const { rows } = await pool.query(sql, params);
    if (rows.length === 0) return null;
    return rows.map(rowToLeadRecord);
  } catch (error) {
    console.error("[db] getCachedLeads error:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function getRecentSearches(
  limit = 5
): Promise<Array<{ query: string; count: number; fetchedAt: string }>> {
  const pool = getPool();
  try {
    const { rows } = await pool.query<{ search_query: string; count: string; fetched_at: Date }>(
      `SELECT search_query, COUNT(*)::text AS count, MAX(fetched_at) AS fetched_at
       FROM leads
       WHERE search_query IS NOT NULL
       GROUP BY search_query
       ORDER BY MAX(fetched_at) DESC
       LIMIT $1`,
      [limit]
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

export async function updateLeadContact(
  leadId: string,
  updates: {
    email?: string;
    linkedinUrl?: string;
    companyDomain?: string;
    organizationId?: string;
  }
): Promise<void> {
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

  if (sets.length === 0) return;

  sets.push(`fetched_at = NOW()`);
  params.push(leadId);

  try {
    await getPool().query(
      `UPDATE leads SET ${sets.join(", ")} WHERE id = $${params.length}`,
      params
    );
  } catch (error) {
    console.error("[db] updateLeadContact error:", error instanceof Error ? error.message : error);
  }
}

// ─── Pitches ──────────────────────────────────────────────────────────────────

export async function cachePitch(leadId: string, pitch: GeneratedPitch): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM pitches WHERE lead_id = $1", [leadId]);
    await client.query(
      `INSERT INTO pitches (
        lead_id, subject, body, talking_points, bridge_insight, summary, pain_points, variable_evidence
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
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
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[db] cachePitch error:", error instanceof Error ? error.message : error);
  } finally {
    client.release();
  }
}

export async function getCachedPitch(
  leadId: string,
  maxAgeHours?: number
): Promise<GeneratedPitch | null> {
  const pool = getPool();
  const params: unknown[] = [leadId];
  let sql = "SELECT * FROM pitches WHERE lead_id = $1";

  if (typeof maxAgeHours === "number" && Number.isFinite(maxAgeHours)) {
    params.push(new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString());
    sql += ` AND created_at >= $${params.length}`;
  }
  sql += " ORDER BY created_at DESC LIMIT 1";

  try {
    const { rows } = await pool.query(sql, params);
    if (rows.length === 0) return null;
    const row = rows[0]!;
    return {
      subject: row.subject ?? "",
      body: row.body ?? "",
      talkingPoints: row.talking_points ?? "",
      bridgeInsight: row.bridge_insight ?? "",
      summary: row.summary ?? "",
      painPoints: row.pain_points ?? [],
      variableEvidence: row.variable_evidence ?? []
    };
  } catch (error) {
    console.error("[db] getCachedPitch error:", error instanceof Error ? error.message : error);
    return null;
  }
}
