"use client";

import { signIn, getProviders } from "next-auth/react";
import { useState, useEffect } from "react";
import Image from "next/image";
import { Scan, Lock, LogIn, FlaskConical } from "lucide-react";

const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const demoAdminEmail = "admin@example.com";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasGoogle, setHasGoogle] = useState(false);
  const [hasMicrosoft, setHasMicrosoft] = useState(false);
  const [hasLocalAccount, setHasLocalAccount] = useState(false);
  const [hasDevLogin, setHasDevLogin] = useState(false);

  useEffect(() => {
    getProviders().then((providers) => {
      if (providers) {
        setHasGoogle(!!providers.google);
        setHasMicrosoft(!!providers["azure-ad"]);
        setHasLocalAccount(!!providers["local-account"]);
        setHasDevLogin(!!providers["dev-login"]);
      }
    });
  }, []);

  async function handleLocalAccount(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await signIn("local-account", { email, password, callbackUrl: "/dashboard" });
    setLoading(false);
  }

  async function handleDevLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await signIn("dev-login", { email, callbackUrl: "/dashboard" });
    setLoading(false);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center mesh-gradient overflow-hidden">
      {/* Decorative grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(var(--accent) 1px, transparent 1px),
            linear-gradient(90deg, var(--accent) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Floating decorative elements */}
      <div className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full bg-[var(--accent)]/5 blur-[100px] animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-[var(--info)]/5 blur-[120px] animate-pulse" style={{ animationDelay: "1s" }} />

      {/* Login Card */}
      <div className="relative z-10 w-full max-w-md px-4 animate-fade-in-up">
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]/80 backdrop-blur-xl p-8 shadow-2xl shadow-black/40">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="relative mb-5">
              <div className="absolute inset-0 rounded-full bg-amber-500/10 blur-2xl scale-[2]" />
              <Image
                src="/urnammu_logo_light.png"
                alt="UrNammu"
                width={120}
                height={120}
                className="relative"
                priority
              />
            </div>
            <Image
              src="/urnammu_wordmark_light.png"
              alt="UrNammu"
              width={260}
              height={62}
              className="relative"
            />
            <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">
              AI Governance Platform
            </p>
            <p className="mt-4 text-sm text-[var(--text-muted)] text-center max-w-xs">
              Enterprise AI risk, compliance, and oversight
            </p>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[var(--border-default)] to-transparent" />
            <Lock className="h-3 w-3 text-[var(--text-faint)]" />
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[var(--border-default)] to-transparent" />
          </div>

          <div className="space-y-4">
            {/* Google OAuth */}
            {hasGoogle && (
              <button
                onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
                className="group relative w-full flex items-center justify-center gap-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-default)] px-4 py-3 text-sm font-medium text-[var(--text-primary)] transition-all hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] hover:shadow-lg hover:shadow-black/20"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </button>
            )}

            {hasMicrosoft && (
              <button
                onClick={() => signIn("azure-ad", { callbackUrl: "/dashboard" })}
                className="group relative w-full flex items-center justify-center gap-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-default)] px-4 py-3 text-sm font-medium text-[var(--text-primary)] transition-all hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] hover:shadow-lg hover:shadow-black/20"
              >
                <svg className="h-5 w-5" viewBox="0 0 21 21" fill="none">
                  <path d="M1 1h9v9H1z" fill="#f25022" />
                  <path d="M11 1h9v9h-9z" fill="#7fba00" />
                  <path d="M1 11h9v9H1z" fill="#00a4ef" />
                  <path d="M11 11h9v9h-9z" fill="#ffb900" />
                </svg>
                Continue with Microsoft 365
              </button>
            )}

            {/* Divider between providers */}
            {(hasGoogle || hasMicrosoft) && (hasLocalAccount || hasDevLogin) && (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[var(--border-subtle)]" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-faint)]">or</span>
                <div className="flex-1 h-px bg-[var(--border-subtle)]" />
              </div>
            )}

            {/* Local password login */}
            {hasLocalAccount && (
              <form onSubmit={handleLocalAccount} className="space-y-3">
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="flex h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--accent-border)] transition-all"
                    placeholder="name@example.com"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="flex h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--accent-border)] transition-all"
                    placeholder="Enter your password"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="group relative w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--bg-deep)] transition-all hover:brightness-110 shadow-md shadow-[var(--accent-glow)] disabled:opacity-50"
                >
                  <LogIn className="h-4 w-4" />
                  {loading ? "Signing in..." : "Sign In with Local Account"}
                </button>
              </form>
            )}

            {hasDevLogin && (
              <form onSubmit={handleDevLogin} className="space-y-3">
                {isDemoMode && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-left">
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-amber-100">
                      <FlaskConical className="h-4 w-4" />
                      Demo Workspace
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-amber-50/80">
                      Use the seeded demo admin to explore the sample governance workspace without connecting Google or provider admin APIs.
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-amber-100/90">
                      Email: {demoAdminEmail} · Password: demo-password
                    </p>
                    <button
                      type="button"
                      onClick={() => setEmail(demoAdminEmail)}
                      className="mt-2 text-[11px] font-medium text-amber-200 underline-offset-4 hover:underline"
                    >
                      Fill demo admin email
                    </button>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="flex h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--accent-border)] transition-all"
                    placeholder="name@example.com"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="group relative w-full flex items-center justify-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition-all hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  <LogIn className="h-4 w-4" />
                  {loading ? "Signing in..." : "Use Dev Login"}
                </button>
                <p className="text-center text-[11px] text-[var(--text-faint)]">
                  {isDemoMode
                    ? `Sign in with ${demoAdminEmail} and the seeded demo password when demo mode is enabled.`
                    : "Use a password-backed local account when local auth is enabled."}
                </p>
              </form>
            )}
          </div>

          {/* Status footer */}
          <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-[var(--text-faint)]">
            <Scan className="h-3 w-3" />
            <span>Secure enterprise authentication</span>
          </div>
        </div>
      </div>
    </div>
  );
}
