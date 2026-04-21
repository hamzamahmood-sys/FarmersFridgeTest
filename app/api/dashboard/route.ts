export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getDashboardStats, listSavedLocations } from "@/lib/db";

export async function GET() {
  try {
    const [stats, recentLocations] = await Promise.all([
      getDashboardStats(),
      listSavedLocations({ limit: 6 })
    ]);

    return NextResponse.json({ stats, recentLocations });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load dashboard." },
      { status: 500 }
    );
  }
}
