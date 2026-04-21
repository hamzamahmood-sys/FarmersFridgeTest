export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getDashboardStats, listSavedLocations } from "@/lib/db";
import { AuthRequired, resolveCurrentUserId } from "@/lib/auth-user";

export async function GET() {
  try {
    const userId = await resolveCurrentUserId();
    const [stats, recentLocations] = await Promise.all([
      getDashboardStats(userId),
      listSavedLocations({ userId, limit: 6 })
    ]);

    return NextResponse.json({ stats, recentLocations });
  } catch (error) {
    if (error instanceof AuthRequired) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load dashboard." },
      { status: 500 }
    );
  }
}
