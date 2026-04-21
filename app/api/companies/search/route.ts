export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { searchCompanies } from "@/lib/apollo";
import { estimateApolloCredits } from "@/lib/utils";

const searchSchema = z.object({
  personas: z
    .array(z.enum(["office_manager", "facilities_director", "workplace_experience", "hr", "csuite", "custom"]))
    .min(1),
  customPersona: z.string().optional(),
  industryQuery: z.string().min(2),
  states: z.array(z.string()).default([]),
  employeeMin: z.number().min(1),
  limit: z.number().min(1).max(50)
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const filters = searchSchema.parse(body);
    const creditEstimate = estimateApolloCredits(filters.limit);
    const companies = await searchCompanies(filters);

    return NextResponse.json({ filters, creditEstimate, companies, fromCache: false });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to search Apollo companies." },
      { status: 500 }
    );
  }
}
