"use client";

import { useSession, signOut } from "next-auth/react";
import { Bell, LogOut, User, Activity } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

export function TopBar() {
  const { data: session } = useSession();

  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/80 backdrop-blur-md px-6">
      {/* Left: live status indicator */}
      <div className="flex items-center gap-2 text-[11px] text-[var(--text-faint)]">
        <Activity className="h-3.5 w-3.5 text-[var(--accent)]" style={{ animation: "pulseGlow 2s ease-in-out infinite" }} />
        <span className="hidden sm:inline">Governance Monitoring Active</span>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-3">
        <button className="relative rounded-lg p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute right-1.5 top-1.5 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--critical)] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--critical)]" />
          </span>
        </button>

        <div className="h-5 w-px bg-[var(--border-subtle)]" />

        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--bg-hover)] transition-colors outline-none">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-dim)] ring-1 ring-[var(--accent-border)]">
              {session?.user?.image ? (
                <img
                  src={session.user.image}
                  alt=""
                  className="h-7 w-7 rounded-full"
                />
              ) : (
                <User className="h-3.5 w-3.5 text-[var(--accent)]" />
              )}
            </div>
            <div className="hidden text-left sm:block">
              <p className="text-[13px] font-medium text-[var(--text-primary)] leading-tight">
                {session?.user?.name ?? "User"}
              </p>
              <p className="text-[10px] text-[var(--accent)] font-semibold uppercase tracking-wider">
                {session?.user?.role?.replace("_", " ") ?? "VIEWER"}
              </p>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <p className="text-sm text-[var(--text-primary)]">{session?.user?.name}</p>
              <p className="text-xs text-[var(--text-muted)]">{session?.user?.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
