"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { FilterX } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  contentTypes: string[];
  categories: string[];
  departments: string[];
  initial: {
    q: string;
    contentType: string;
    category: string;
    department: string;
    status: string;
  };
}

export function FilterBar({ contentTypes, categories, departments, initial }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [q, setQ] = useState(initial.q);
  const [contentType, setContentType] = useState(initial.contentType);
  const [category, setCategory] = useState(initial.category);
  const [department, setDepartment] = useState(initial.department);
  const [status, setStatus] = useState(initial.status);

  function apply() {
    const params = new URLSearchParams(search.toString());
    const set = (key: string, value: string) => {
      if (value) params.set(key, value);
      else params.delete(key);
    };
    set("q", q.trim());
    set("contentType", contentType === "all" ? "" : contentType);
    set("category", category === "all" ? "" : category);
    set("department", department === "all" ? "" : department);
    set("status", status === "all" ? "" : status);
    params.delete("page");
    startTransition(() => {
      router.push(`/registry/skills?${params.toString()}`);
    });
  }

  function reset() {
    setQ("");
    setContentType("all");
    setCategory("all");
    setDepartment("all");
    setStatus("all");
    startTransition(() => {
      router.push("/registry/skills");
    });
  }

  return (
    <div className="grid gap-3 lg:grid-cols-6 items-end">
      <div className="space-y-1 lg:col-span-2">
        <Label>Search</Label>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
          }}
          placeholder="Name, author, tag…"
        />
      </div>
      <div className="space-y-1">
        <Label>Type</Label>
        <select
          value={contentType}
          onChange={(e) => setContentType(e.target.value)}
          className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
        >
          <option value="all">All types</option>
          {contentTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label>Category</Label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label>Department</Label>
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
        >
          <option value="all">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label>Status</Label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
        >
          <option value="all">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="retired">Retired</option>
        </select>
      </div>
      <div className="flex gap-2 lg:col-span-6">
        <Button
          type="button"
          onClick={apply}
          disabled={pending}
          className="bg-[var(--accent)] text-[var(--bg-deep)] hover:brightness-110"
        >
          {pending ? "Applying…" : "Apply"}
        </Button>
        <Button type="button" variant="outline" onClick={reset} disabled={pending}>
          <FilterX className="mr-1 h-3.5 w-3.5" />
          Reset
        </Button>
      </div>
    </div>
  );
}
