import { auth } from "@/auth";

export class AuthRequired extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "AuthRequired";
  }
}

export async function resolveCurrentUserId(): Promise<number> {
  // Dev bypass: no real session exists when AUTH_DEV_BYPASS=true
  if (process.env.AUTH_DEV_BYPASS === "true") {
    return 1;
  }

  const session = await auth();
  const rawId = session?.user?.id;
  const parsed = typeof rawId === "string" ? Number(rawId) : Number(rawId ?? NaN);

  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  throw new AuthRequired();
}
