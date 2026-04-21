import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Edge-safe config — no adapter, no database imports.
// Used by middleware (runs in Edge Runtime) for route gating.
// auth.ts extends this with the pg adapter for server-side session lookups.
const hasGoogleCreds = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const authConfig: NextAuthConfig = {
  providers: hasGoogleCreds
    ? [
        Google({
          authorization: {
            params: {
              scope: "openid email profile https://www.googleapis.com/auth/gmail.compose",
              access_type: "offline",
              prompt: "consent"
            }
          }
        })
      ]
    : [],
  pages: {
    signIn: "/signin"
  },
  callbacks: {
    authorized({ request, auth }) {
      const { nextUrl } = request;
      const isSignedIn = Boolean(auth?.user);
      const isSignInPage = nextUrl.pathname === "/signin";

      if (isSignedIn && isSignInPage) {
        return Response.redirect(new URL("/", nextUrl));
      }
      if (!isSignedIn && !isSignInPage) {
        return false;
      }
      return true;
    },
    session({ session, user }) {
      if (session.user && user?.id) {
        session.user.id = user.id;
      }
      return session;
    }
  }
};
