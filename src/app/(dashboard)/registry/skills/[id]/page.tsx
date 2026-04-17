import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { ContentFetchButton } from "./content-fetch-button";

export default async function AISkillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const skill = await prisma.aISkill.findUnique({
    where: { id },
    include: {
      linkedSystem: { select: { id: true, name: true } },
    },
  });
  if (!skill) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title={skill.name} description={`Forge ID: ${skill.forgeId}`}>
        <Link href="/registry/skills">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to skills
          </Button>
        </Link>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-[var(--text-muted)]">Content type</dt>
              <dd className="font-medium">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {skill.contentType}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Status</dt>
              <dd className="font-medium capitalize">{skill.status}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Category</dt>
              <dd className="font-medium">{skill.categoryName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Department</dt>
              <dd className="font-medium">{skill.departmentName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Author</dt>
              <dd className="font-medium">{skill.authorName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Current version</dt>
              <dd className="font-medium">v{skill.currentVersion}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Created (Forge)</dt>
              <dd className="font-medium">{formatDateTime(skill.forgeCreatedAt)}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Updated (Forge)</dt>
              <dd className="font-medium">{formatDateTime(skill.forgeUpdatedAt)}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Engagement</dt>
              <dd className="font-medium">
                {skill.upvoteCount} upvotes · {skill.downloadCount} downloads
                {skill.isFeaturedGlobal ? " · featured" : ""}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Last synced</dt>
              <dd className="font-medium">{formatDateTime(skill.syncedAt)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {skill.tags.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Tags</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {skill.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Linked governed system</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {skill.linkedSystem ? (
            <div className="flex items-center justify-between">
              <Link
                href={`/registry/${skill.linkedSystem.id}`}
                className="text-[var(--accent)] hover:underline"
              >
                {skill.linkedSystem.name}
              </Link>
              <span className="text-xs text-[var(--text-muted)]">
                Governance, risk, and compliance attached via the AI System registry.
              </span>
            </div>
          ) : (
            <p className="text-[var(--text-muted)]">
              Not linked to a governed AI System. Promotion flow coming soon — for now, link
              by editing a system in the registry and referencing this skill&apos;s Forge ID.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Content</CardTitle>
          {skill.fileName ? (
            <p className="text-xs text-[var(--text-muted)]">
              {skill.fileName}
              {skill.fileSizeBytes != null
                ? ` · ${(skill.fileSizeBytes / 1024).toFixed(1)} KB`
                : ""}
              {skill.fileType ? ` · ${skill.fileType}` : ""}
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          {skill.contentType === "app" && skill.appUrl ? (
            <a
              href={skill.appUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-[var(--accent)] hover:underline"
            >
              Open external app <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <ContentFetchButton skillId={skill.id} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
