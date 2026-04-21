/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * We use it to validate required environment variables at boot so the process
 * fails loudly (with a clear message) instead of crashing mid-request.
 */
export async function register() {
  // Only run on the Node.js runtime, not in the Edge Runtime where env
  // validation is not needed (middleware uses only AUTH_SECRET / AUTH_URL).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("@/lib/env");
    validateEnv();
  }
}
