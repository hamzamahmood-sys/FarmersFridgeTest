function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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
