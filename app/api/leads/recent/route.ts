export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRecentSearches } from "@/lib/db";
import { AuthRequired, resolveCurrentUserId } from "@/lib/auth-user";

export async function GET() {
  try {
    const userId = await resolveCurrentUserId();
    const searches = await getRecentSearches(userId, 5);
    return NextResponse.json({ searches });
  } catch (error) {
    if (error instanceof AuthRequired) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ searches: [] });
  }
}
