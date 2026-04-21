import NextAuth from "next-auth";
import PostgresAdapter from "@auth/pg-adapter";
import { authConfig } from "@/auth.config";
import { getPool } from "@/lib/db";
import { env } from "@/lib/env";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PostgresAdapter(getPool()),
  secret: env.authSecret,
  session: { strategy: "database" }
});
