import { signIn } from "@/auth";

export default function SignInPage({
  searchParams
}: {
  searchParams: { callbackUrl?: string };
}) {
  return (
    <main
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "2rem"
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: "100%",
          padding: "2.5rem",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          background: "#fff"
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Sign in</h1>
        <p style={{ color: "#6b7280", marginTop: "0.5rem" }}>
          Farmer&apos;s Fridge Smart Outreach. Sign in with Google — we&apos;ll use the same
          session to create Gmail drafts on your behalf.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("google", {
              redirectTo: searchParams.callbackUrl ?? "/"
            });
          }}
          style={{ marginTop: "1.5rem" }}
        >
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "0.75rem 1rem",
              borderRadius: 8,
              border: "1px solid #111827",
              background: "#111827",
              color: "#fff",
              fontSize: "0.95rem",
              cursor: "pointer"
            }}
          >
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
