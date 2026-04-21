function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Call this once at process startup (e.g. from instrumentation.ts) to surface
 * missing env vars immediately rather than on the first affected request.
 *
 * Google OAuth keys are only checked when AUTH_DEV_BYPASS is not set, matching
 * the same conditional that the provider registration uses at runtime.
 */
export function validateEnv(): void {
  const always = [
    "AUTH_SECRET",
    "DATABASE_URL",
    "APOLLO_API_KEY",
    "OPENAI_API_KEY",
    "TAVILY_API_KEY"
  ];

  const needsGoogle = process.env.AUTH_DEV_BYPASS !== "true";
  const googleKeys = needsGoogle ? ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] : [];

  const missing = [...always, ...googleKeys].filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Server startup failed — missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`
    );
  }
}

export const env = {
  get apolloApiKey() {
    return required("APOLLO_API_KEY");
  },
  get openaiApiKey() {
    return required("OPENAI_API_KEY");
  },
  get googleClientId() {
    return required("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return required("GOOGLE_CLIENT_SECRET");
  },
  get tavilyApiKey() {
    return required("TAVILY_API_KEY");
  },
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get databaseSsl() {
    // Railway and most managed Postgres providers require SSL. Default to true
    // in production, allow opt-out via DATABASE_SSL=false for local dev.
    const flag = process.env.DATABASE_SSL;
    if (flag === "false") return false;
    return true;
  },
  get authSecret() {
    return required("AUTH_SECRET");
  },
  get authDevBypass() {
    return process.env.AUTH_DEV_BYPASS === "true";
  },
  get tombaApiKey() {
    return process.env.TOMBA_API_KEY || "";
  },
  get tombaApiSecret() {
    return process.env.TOMBA_API_SECRET || "";
  },
  get appUrl() {
    return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  }
};
