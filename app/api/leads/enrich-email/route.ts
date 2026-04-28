export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { enrichLeadContactFromApollo } from "@/lib/apollo";
import { isRealApolloEmail } from "@/lib/apollo/normalize";
import { getLeadById, updateLeadContact } from "@/lib/db";
import { resolveCompanyDomain } from "@/lib/tavily";
import { findEmailTomba, isTombaConfigured } from "@/lib/tomba";
import { AuthRequired, resolveCurrentUserId } from "@/lib/auth-user";

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
  externalId: z.string().optional(),
  name: z.string(),
  email: z.string(),
  title: z.string(),
  linkedinUrl: z.string().optional(),
  companyName: z.string(),
  companyDomain: z.string().optional(),
  organizationId: z.string().optional(),
  department: z.enum(["facilities", "hr_people", "workplace", "fnb", "csuite", "other"]).optional(),
  locationId: z.string().optional(),
  source: z.enum(["apollo", "ai"]).optional(),
  emailSource: z.enum(["apollo", "tomba", "ai", "existing"]).optional()
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
    const userId = await resolveCurrentUserId();
    const payload = payloadSchema.parse(body);
    const storedLeadRecord = await getLeadById(userId, payload.leadRecord.lead.id);
    if (!storedLeadRecord) {
      return NextResponse.json({ error: "Lead not found." }, { status: 404 });
    }

    let leadRecord = storedLeadRecord;
    let source: "existing" | "apollo" | "tomba" | "none" = isRealApolloEmail(leadRecord.lead.email)
      ? "existing"
      : "none";
    let hasResolvedEmail = isRealApolloEmail(leadRecord.lead.email);
    const providersTried: string[] = [];
    const providerNotes: string[] = [];
    const tombaConfigured = isTombaConfigured();
    let apolloEmailStatus: string | undefined;

    if (!hasResolvedEmail && !leadRecord.lead.companyDomain) {
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

    const tryTombaLookup = async (): Promise<boolean> => {
      if (hasResolvedEmail || !leadRecord.lead.companyDomain) return false;

      const { firstName, lastName } = splitFullName(leadRecord.lead.name);
      if (!tombaConfigured) return false;
      if (!firstName || !lastName) return false;

      providersTried.push("tomba");
      const tombaEmail = await findEmailTomba(firstName, lastName, leadRecord.lead.companyDomain, {
        companyName: leadRecord.lead.companyName,
        fullName: leadRecord.lead.name
      });

      if (!tombaEmail) {
        return false;
      }

      leadRecord = {
        ...leadRecord,
        lead: {
          ...leadRecord.lead,
          email: tombaEmail
        }
      };
      source = "tomba";
      hasResolvedEmail = true;
      return true;
    };

    if (!hasResolvedEmail) {
      await tryTombaLookup();
    }

    if (!hasResolvedEmail) {
      providersTried.push("apollo");
      const apolloResult = await enrichLeadContactFromApollo(leadRecord);
      leadRecord = apolloResult.leadRecord;
      source = apolloResult.source;
      apolloEmailStatus = apolloResult.emailStatus;
      hasResolvedEmail = isRealApolloEmail(leadRecord.lead.email);
    }

    console.log("[enrich-email]", {
      leadId: payload.leadRecord.lead.id,
      name: payload.leadRecord.lead.name,
      lookupSource: source,
      resolvedEmail: leadRecord.lead.email || "(none)",
      emailStatus: apolloEmailStatus,
      companyDomain: leadRecord.lead.companyDomain,
      tombaConfigured
    });

    if (!hasResolvedEmail && leadRecord.lead.email) {
      leadRecord = {
        ...leadRecord,
        lead: {
          ...leadRecord.lead,
          email: ""
        }
      };
    }

    if (!hasResolvedEmail && !providersTried.includes("tomba")) {
      const tombaFound = await tryTombaLookup();
      if (!tombaFound) {
        const { firstName, lastName } = splitFullName(leadRecord.lead.name);
        if (!tombaConfigured) {
          providerNotes.push("Tomba fallback is not configured on the server.");
        } else if (!leadRecord.lead.companyDomain) {
          providerNotes.push("We couldn't resolve a company domain, so Tomba was skipped.");
        } else if (!firstName || !lastName) {
          providerNotes.push("The contact name was incomplete, so Tomba was skipped.");
        } else {
          providerNotes.push("Tomba did not find an email for the company domain.");
        }
      }
    } else if (!hasResolvedEmail) {
      providerNotes.push("No email was found from the configured providers.");
    }

    const resolvedEmailSource: "apollo" | "tomba" | "existing" | undefined = hasResolvedEmail
      ? source === "tomba"
        ? "tomba"
        : source === "existing"
          ? "existing"
          : "apollo"
      : undefined;

    if (resolvedEmailSource) {
      leadRecord = {
        ...leadRecord,
        lead: { ...leadRecord.lead, emailSource: resolvedEmailSource }
      };
    }

    const updated = await updateLeadContact(userId, leadRecord.lead.id, {
      email: hasResolvedEmail ? leadRecord.lead.email : undefined,
      linkedinUrl: leadRecord.lead.linkedinUrl,
      companyDomain: leadRecord.lead.companyDomain,
      organizationId: leadRecord.lead.organizationId,
      emailSource: resolvedEmailSource
    });
    if (!updated) {
      return NextResponse.json({ error: "Lead not found." }, { status: 404 });
    }

    return NextResponse.json({
      leadRecord,
      source,
      emailFound: hasResolvedEmail,
      emailStatus: apolloEmailStatus,
      providersTried,
      providerNotes
    });
  } catch (error) {
    if (error instanceof AuthRequired) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Email enrichment failed." },
      { status: 500 }
    );
  }
}
