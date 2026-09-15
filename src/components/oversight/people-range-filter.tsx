"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PEOPLE_USAGE_RANGES, type PeopleUsageRange } from "@/lib/people-usage-types";

// Time-window picker for Usage by Person. Navigates to ?range=<7d|30d|90d>,
// which the server page reads. Mirrors the per-surface user filters.
export function PeopleRangeFilter({ initialRange }: { initialRange: PeopleUsageRange }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onChange = (v: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", v);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
        Window
      </span>
      <Select value={initialRange} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-[160px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PEOPLE_USAGE_RANGES.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
