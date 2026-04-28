import type { LeadRecord } from "@/lib/types";
import { apolloFetch } from "./client";
import { getPersonName, isRealApolloEmail, normalizeDomain } from "./normalize";

type ApolloPersonMatchResponse = {
  person?: Record<string, unknown>;
};

export type LeadEmailEnrichmentResult = {
  leadRecord: LeadRecord;
  source: "existing" | "apollo" | "tomba" | "none";
  emailStatus?: string;
};

export async function enrichLeadContactFromApollo(record: LeadRecord): Promise<LeadEmailEnrichmentResult> {
  const existingEmail = isRealApolloEmail(record.lead.email) ? record.lead.email : "";

  if (existingEmail) {
    return { leadRecord: record, source: "existing" };
  }

  let person: Record<string, unknown> | undefined;
  const apolloPersonId = record.lead.externalId || record.lead.id;

  try {
    if (record.lead.source !== "ai" && apolloPersonId && !apolloPersonId.startsWith("lead-")) {
      const response = await apolloFetch<ApolloPersonMatchResponse>("/v1/people/match", {
        id: apolloPersonId,
        reveal_personal_emails: true
      });
      person = response.person;
    }
  } catch (error) {
    console.warn(
      "[Apollo enrich] people/match by id failed:",
      error instanceof Error ? error.message : error
    );
  }

  const organization = person?.organization as Record<string, unknown> | undefined;
  const apolloEmail = isRealApolloEmail(person?.email) ? (person!.email as string) : "";
  const linkedinUrl =
    typeof person?.linkedin_url === "string"
      ? person.linkedin_url
      : record.lead.linkedinUrl;
  const companyDomain =
    normalizeDomain(
      typeof organization?.website_url === "string"
        ? organization.website_url
        : record.lead.companyDomain
    ) || record.lead.companyDomain;
  const organizationId =
    typeof person?.organization_id === "string"
      ? person.organization_id
      : record.lead.organizationId;
  const emailStatus =
    typeof person?.email_status === "string"
      ? person.email_status
      : undefined;

  const baseLeadRecord: LeadRecord = {
    ...record,
    lead: {
      ...record.lead,
      externalId:
        typeof person?.id === "string" || typeof person?.id === "number"
          ? String(person.id)
          : record.lead.externalId,
      name: getPersonName(person || {}) || record.lead.name,
      email: apolloEmail || existingEmail,
      linkedinUrl,
      companyDomain,
      organizationId
    }
  };

  if (apolloEmail) {
    return {
      leadRecord: baseLeadRecord,
      source: "apollo",
      emailStatus
    };
  }

  return {
    leadRecord: baseLeadRecord,
    source: "none",
    emailStatus
  };
}
