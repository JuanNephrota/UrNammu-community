"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "__all__";

// User picker for the Cursor Oversight dashboard. Navigates to ?user=<email>
// (read server-side by the page). Mirrors ClaudeCodeUserFilter.
export function CursorUserFilter({
  users,
  initialUser,
}: {
  users: string[];
  initialUser: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onChange = (v: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (v === ALL) params.delete("user");
    else params.set("user", v);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
        User
      </span>
      <Select value={initialUser || ALL} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-[240px] text-xs">
          <SelectValue placeholder="All users" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All users</SelectItem>
          {users.map((u) => (
            <SelectItem key={u} value={u}>
              {u}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
