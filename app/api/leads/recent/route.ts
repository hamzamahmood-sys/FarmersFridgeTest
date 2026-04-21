export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRecentSearches } from "@/lib/db";

export async function GET() {
  try {
    const searches = await getRecentSearches(5);
    return NextResponse.json({ searches });
  } catch {
    return NextResponse.json({ searches: [] });
  }
}
