"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AISkillFormProps {
  skill: {
    id: string;
    forgeId: string;
    name: string;
    content: string | null;
    status: string;
    tags: string[];
    categoryName: string | null;
    departmentName: string | null;
    authorName: string | null;
    appUrl: string | null;
    linkedAgentId: string | null;
    linkedSystemId: string | null;
    localOverrides: string[];
  };
  agents: { id: string; name: string }[];
  systems: { id: string; name: string }[];
}

// Field names Forge-synced (tracked in localOverrides). Kept in lockstep
// with src/lib/validations/ai-skill.ts#AI_SKILL_OVERRIDE_FIELDS.
type OverrideField =
  | "name"
  | "content"
  | "status"
  | "tags"
  | "categoryName"
  | "departmentName"
  | "authorName"
  | "appUrl";

export function AISkillForm({ skill, agents, systems }: AISkillFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(skill.name);
  const [content, setContent] = useState(skill.content ?? "");
  const [status, setStatus] = useState(skill.status);
  const [tagsInput, setTagsInput] = useState(skill.tags.join(", "));
  const [categoryName, setCategoryName] = useState(skill.categoryName ?? "");
  const [departmentName, setDepartmentName] = useState(skill.departmentName ?? "");
  const [authorName, setAuthorName] = useState(skill.authorName ?? "");
  const [appUrl, setAppUrl] = useState(skill.appUrl ?? "");
  const [linkedAgentId, setLinkedAgentId] = useState(skill.linkedAgentId ?? "");
  const [linkedSystemId, setLinkedSystemId] = useState(skill.linkedSystemId ?? "");

  const overrides = new Set(skill.localOverrides);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      const res = await fetch(`/api/registry/skills/${skill.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          content,
          status,
          tags,
          categoryName,
          departmentName,
          authorName,
          appUrl,
          linkedAgentId,
          linkedSystemId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.push(`/registry/skills/${skill.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  function OverrideBadge({ field }: { field: OverrideField }) {
    const locked = overrides.has(field);
    return (
      <Badge
        variant="outline"
        className="text-[10px] uppercase tracking-wide font-medium ml-2"
        title={
          locked
            ? "Locked locally — Forge sync will not overwrite this field. Blank the value to re-sync."
            : "Syncs from Forge on each run."
        }
      >
        {locked ? (
          <Lock className="h-3 w-3 mr-1" />
        ) : (
          <Unlock className="h-3 w-3 mr-1" />
        )}
        {locked ? "Local" : "Synced"}
      </Badge>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Skill details</CardTitle>
          <p className="text-xs text-[var(--text-muted)]">
            Fields tagged <strong>Local</strong> won&apos;t be overwritten by the
            next Forge sync. Clear a field to hand it back to Forge.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="name" className="flex items-center">
              Name
              <OverrideBadge field="name" />
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="status" className="flex items-center">
                Status
                <OverrideBadge field="status" />
              </Label>
              <Input
                id="status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                placeholder="published"
              />
            </div>
            <div>
              <Label htmlFor="authorName" className="flex items-center">
                Author
                <OverrideBadge field="authorName" />
              </Label>
              <Input
                id="authorName"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="categoryName" className="flex items-center">
                Category
                <OverrideBadge field="categoryName" />
              </Label>
              <Input
                id="categoryName"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="departmentName" className="flex items-center">
                Department
                <OverrideBadge field="departmentName" />
              </Label>
              <Input
                id="departmentName"
                value={departmentName}
                onChange={(e) => setDepartmentName(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="tags" className="flex items-center">
              Tags
              <OverrideBadge field="tags" />
              <span className="ml-2 text-xs text-[var(--text-muted)]">
                Comma-separated
              </span>
            </Label>
            <Input
              id="tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="appUrl" className="flex items-center">
              App URL
              <OverrideBadge field="appUrl" />
            </Label>
            <Input
              id="appUrl"
              value={appUrl}
              onChange={(e) => setAppUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            Content
            <OverrideBadge field="content" />
          </CardTitle>
          <p className="text-xs text-[var(--text-muted)]">
            The skill body stored in UrNammu. Editing locks it; clearing hands
            it back to Forge on the next sync.
          </p>
        </CardHeader>
        <CardContent>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            className="font-mono text-xs"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Governed linkage</CardTitle>
          <p className="text-xs text-[var(--text-muted)]">
            Local-only — never touched by Forge sync.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="linkedAgentId">Linked AI Agent</Label>
            <select
              id="linkedAgentId"
              value={linkedAgentId}
              onChange={(e) => setLinkedAgentId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-sm"
            >
              <option value="">— none —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="linkedSystemId">Linked AI System</Label>
            <select
              id="linkedSystemId"
              value={linkedSystemId}
              onChange={(e) => setLinkedSystemId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-sm"
            >
              <option value="">— none —</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <p className="text-sm text-[var(--critical)]">{error}</p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={loading}>
          {loading ? "Saving…" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(`/registry/skills/${skill.id}`)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
