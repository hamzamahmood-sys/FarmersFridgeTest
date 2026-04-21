import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const devBypass = process.env.AUTH_DEV_BYPASS === "true";

const { auth: authMiddleware } = NextAuth(authConfig);

export default devBypass ? () => NextResponse.next() : authMiddleware;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
