import { auth } from "@/auth";

export async function resolveCurrentUserId(): Promise<number> {
  const session = await auth();
  const rawId = session?.user?.id;
  const parsed = typeof rawId === "string" ? Number(rawId) : Number(rawId ?? 1);

  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return 1;
}
