"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import Image from "next/image";
import { Scan, Lock, LogIn } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("admin@example.com");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await signIn("credentials", { email, callbackUrl: "/dashboard" });
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
                src="/nammu_logo_light.png"
                alt="Nammu"
                width={80}
                height={80}
                className="relative"
                priority
              />
            </div>
            <Image
              src="/nammu_wordmark_light.png"
              alt="Nammu"
              width={200}
              height={48}
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

          {/* Dev Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="flex h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--accent-border)] transition-all"
                placeholder="admin@example.com"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--bg-deep)] transition-all hover:brightness-110 shadow-md shadow-[var(--accent-glow)] disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" />
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          {/* Quick access hint */}
          <p className="mt-4 text-center text-[11px] text-[var(--text-faint)]">
            Use <span className="text-[var(--accent)] font-mono">admin@example.com</span> for full access
          </p>

          {/* Status footer */}
          <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-[var(--text-faint)]">
            <Scan className="h-3 w-3" />
            <span>Dev mode &mdash; credentials auth enabled</span>
          </div>
        </div>
      </div>
    </div>
  );
}
