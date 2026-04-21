export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { enrichLeadContactFromApollo } from "@/lib/apollo";
import { updateLeadContact } from "@/lib/db";
import { resolveCompanyDomain } from "@/lib/tavily";
import { findEmailTomba, isTombaConfigured } from "@/lib/tomba";

const companySchema = z.object({
  industry: z.string().optional(),
  employeeCount: z.number().optional(),
  hqCity: z.string().optional(),
  hqState: z.string().optional(),
  hqCountry: z.string().optional(),
  keywords: z.array(z.string()),
  techStack: z.array(z.string()),
  about: z.string().optional(),
  deliveryZone: z.enum(["Chicago", "NYC", "NJ", "Other"])
});

const leadSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  title: z.string(),
  linkedinUrl: z.string().optional(),
  companyName: z.string(),
  companyDomain: z.string().optional(),
  organizationId: z.string().optional()
});

const payloadSchema = z.object({
  leadRecord: z.object({
    lead: leadSchema,
    company: companySchema,
    priorityScore: z.number()
  })
});

function splitFullName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };

  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" ")
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = payloadSchema.parse(body);

    const apolloResult = await enrichLeadContactFromApollo(payload.leadRecord);
    let leadRecord = apolloResult.leadRecord;
    let source = apolloResult.source;
    const providersTried = ["apollo"];
    const providerNotes: string[] = [];
    const tombaConfigured = isTombaConfigured();

    console.log("[enrich-email]", {
      leadId: payload.leadRecord.lead.id,
      name: payload.leadRecord.lead.name,
      apolloSource: apolloResult.source,
      apolloEmail: leadRecord.lead.email || "(none)",
      emailStatus: apolloResult.emailStatus,
      companyDomain: leadRecord.lead.companyDomain,
      tombaConfigured
    });

    if (!leadRecord.lead.email && !leadRecord.lead.companyDomain) {
      const resolvedDomain = await resolveCompanyDomain(leadRecord);
      if (resolvedDomain) {
        providersTried.push("domain_lookup");
        leadRecord = {
          ...leadRecord,
          lead: {
            ...leadRecord.lead,
            companyDomain: resolvedDomain
          }
        };
      }
    }

    if (!leadRecord.lead.email && leadRecord.lead.companyDomain) {
      const { firstName, lastName } = splitFullName(leadRecord.lead.name);

      if (!tombaConfigured) {
        providerNotes.push("Apollo returned no email for this contact.");
      } else if (firstName) {
        providersTried.push("tomba");
        const tombaEmail = await findEmailTomba(firstName, lastName, leadRecord.lead.companyDomain);
        if (tombaEmail) {
          leadRecord = {
            ...leadRecord,
            lead: {
              ...leadRecord.lead,
              email: tombaEmail
            }
          };
          source = "tomba";
        } else {
          providerNotes.push("Apollo returned no email and Tomba did not find one for the company domain.");
        }
      } else {
        providerNotes.push("Apollo returned no email and the contact name was incomplete, so Tomba was skipped.");
      }
    } else if (!leadRecord.lead.email) {
      providerNotes.push("Apollo returned no email and we couldn't resolve a company domain, so Tomba was skipped.");
    }

    await updateLeadContact(leadRecord.lead.id, {
      email: leadRecord.lead.email || undefined,
      linkedinUrl: leadRecord.lead.linkedinUrl,
      companyDomain: leadRecord.lead.companyDomain,
      organizationId: leadRecord.lead.organizationId
    });

    return NextResponse.json({
      leadRecord,
      source,
      emailFound: Boolean(leadRecord.lead.email),
      emailStatus: apolloResult.emailStatus,
      providersTried,
      providerNotes
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Email enrichment failed." },
      { status: 500 }
    );
  }
}
