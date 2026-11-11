// Plugin content — what a marketplace plugin actually ships.
//
// The extension inventory (assistant-extensions.ts) learns a plugin's name,
// marketplace and version from Claude Code's plugin_loaded events. This module
// turns that into reviewable content: it reads the marketplace's manifest from
// GitHub, resolves the plugin's own source (a path inside the marketplace
// repo, a git subdirectory, or a whole repo, each pinned to a commit), and
// stores the plugin manifest, every SKILL.md, the hook and MCP server
// definitions, commands and agents as PluginContent + PluginContentFile rows.
//
// GitHub only. Marketplaces hosted elsewhere, and plugins whose source is a
// shell command, are recorded as `unsupported` so the page can say so rather
// than silently showing nothing. Fetches go through the public REST API with
// whichever token is configured; unauthenticated calls work for public repos
// but are limited to 60 requests an hour.

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";

export const PLUGIN_CONTENT_SETTINGS_KEYS = {
  /** JSON object mapping marketplace name → GitHub "owner/repo". */
  MARKETPLACES: "extension_marketplaces",
  /** GitHub token used for marketplace and plugin fetches. */
  TOKEN: "extension_marketplace_github_token",
} as const;

/** Marketplaces every install knows without configuration. */
export const DEFAULT_MARKETPLACE_REPOS: Record<string, string> = {
  "claude-plugins-official": "anthropics/claude-plugins-official",
};

export type PluginFileKind = "manifest" | "readme" | "skill" | "hook" | "mcp" | "command" | "agent" | "other";
export type PluginContentStatus = "fetched" | "unsupported" | "not_found" | "error";

/** Files larger than this keep path and sha only. */
export const MAX_FILE_TEXT_BYTES = 64 * 1024;
/** Files per plugin, after selection. */
export const MAX_FILES_PER_PLUGIN = 80;
/**
 * Manifests are parsed, not displayed, and the official marketplace.json is
 * well past the display cap (300+ plugins), so they get their own limit.
 */
export const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "UrNammu-governance";

// ─── Pure helpers ────────────────────────────────────────

/** "https://github.com/o/r.git", "git@github.com:o/r.git", "o/r" → "o/r". */
export function parseGitHubRepo(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  let m = s.match(/^(?:https?:\/\/|git:\/\/)?(?:www\.)?github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
  if (!m) m = s.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (!m) m = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

export interface MarketplaceEntry {
  name: string;
  version?: string;
  source: unknown;
}

export interface ResolvedSource {
  repo: string;
  /** Subdirectory within the repo, "" for the root. No leading "./". */
  path: string;
  /** Commit sha when the marketplace pins one, else a ref name or "HEAD". */
  ref: string;
}

export type SourceResolution =
  | { ok: true; source: ResolvedSource }
  | { ok: false; reason: string };

function normalizePath(p: string): string {
  return p.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * Pure: turn a marketplace.json plugin entry into a fetchable GitHub source.
 * `marketplaceRepo` / `marketplaceSha` describe the marketplace repo itself,
 * which is where relative-path plugins live.
 */
export function resolvePluginSource(
  entry: MarketplaceEntry,
  marketplaceRepo: string,
  marketplaceSha: string,
): SourceResolution {
  const src = entry.source;
  if (typeof src === "string") {
    if (/^(https?:|git@|git:)/i.test(src)) {
      const repo = parseGitHubRepo(src);
      return repo ? { ok: true, source: { repo, path: "", ref: "HEAD" } } : { ok: false, reason: `non-GitHub source ${src}` };
    }
    return { ok: true, source: { repo: marketplaceRepo, path: normalizePath(src), ref: marketplaceSha } };
  }
  if (!src || typeof src !== "object") return { ok: false, reason: "plugin entry has no source" };
  const o = src as Record<string, unknown>;
  const kind = typeof o.source === "string" ? o.source : "";
  const sha = typeof o.sha === "string" ? o.sha : null;
  const refName = typeof o.ref === "string" ? o.ref : null;
  switch (kind) {
    case "url":
    case "git":
    case "github": {
      const repo = parseGitHubRepo(typeof o.url === "string" ? o.url : typeof o.repo === "string" ? o.repo : null);
      if (!repo) return { ok: false, reason: `non-GitHub source ${String(o.url ?? o.repo ?? "")}` };
      return { ok: true, source: { repo, path: "", ref: sha ?? refName ?? "HEAD" } };
    }
    case "git-subdir": {
      const repo = parseGitHubRepo(typeof o.url === "string" ? o.url : null);
      if (!repo) return { ok: false, reason: `non-GitHub source ${String(o.url ?? "")}` };
      return {
        ok: true,
        source: { repo, path: normalizePath(typeof o.path === "string" ? o.path : ""), ref: sha ?? refName ?? "HEAD" },
      };
    }
    case "command":
      return { ok: false, reason: "plugin is produced by a local command, nothing to fetch" };
    default:
      return { ok: false, reason: `unsupported source type "${kind || "unknown"}"` };
  }
}

export interface PluginManifest {
  name?: string;
  version?: string;
  description?: string;
  skills?: string | string[];
  commands?: string | string[];
  agents?: string | string[];
  hooks?: string | string[] | Record<string, unknown>;
  mcpServers?: string | string[] | Record<string, unknown>;
  [key: string]: unknown;
}

export interface SelectedFile {
  path: string;
  kind: PluginFileKind;
  name: string | null;
}

function listOf(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

function under(path: string, dir: string): boolean {
  return dir === "" ? true : path === dir || path.startsWith(dir + "/");
}

/**
 * Pure: pick the files worth storing from a plugin's tree (paths relative to
 * the plugin root). Honors the manifest's custom skills/commands/agents/hooks
 * /mcpServers locations on top of the conventional directories.
 */
export function selectPluginFiles(paths: string[], manifest: PluginManifest | null): SelectedFile[] {
  const skillDirs = ["skills", ...listOf(manifest?.skills).map(normalizePath)];
  const commandDirs = ["commands", ...listOf(manifest?.commands).map(normalizePath)];
  const agentDirs = ["agents", ...listOf(manifest?.agents).map(normalizePath)];
  const hookFiles = new Set(["hooks/hooks.json", ...listOf(manifest?.hooks).map(normalizePath)]);
  const mcpFiles = new Set([".mcp.json", ...listOf(manifest?.mcpServers).map(normalizePath)]);

  const out: SelectedFile[] = [];
  for (const p of paths) {
    if (p === ".claude-plugin/plugin.json") out.push({ path: p, kind: "manifest", name: null });
    else if (/^readme\.md$/i.test(p)) out.push({ path: p, kind: "readme", name: null });
    else if (hookFiles.has(p)) out.push({ path: p, kind: "hook", name: null });
    else if (mcpFiles.has(p)) out.push({ path: p, kind: "mcp", name: null });
    else if (/(^|\/)SKILL\.md$/.test(p) && skillDirs.some((d) => under(p, d))) {
      const parts = p.split("/");
      out.push({ path: p, kind: "skill", name: parts.length >= 2 ? parts[parts.length - 2] : null });
    } else if (/\.md$/i.test(p) && commandDirs.some((d) => under(p, d))) {
      out.push({ path: p, kind: "command", name: p.split("/").pop()!.replace(/\.md$/i, "") });
    } else if (/\.md$/i.test(p) && agentDirs.some((d) => under(p, d))) {
      out.push({ path: p, kind: "agent", name: p.split("/").pop()!.replace(/\.md$/i, "") });
    }
  }
  // Manifest and definitions first, then the rest alphabetically — the cap
  // below must never drop the files a reviewer needs most.
  const rank: Record<PluginFileKind, number> = { manifest: 0, hook: 1, mcp: 2, skill: 3, agent: 4, command: 5, readme: 6, other: 7 };
  out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.path.localeCompare(b.path));
  return out.slice(0, MAX_FILES_PER_PLUGIN);
}

/** Pure: stable digest over (path, blob sha) pairs. */
export function computeContentHash(files: { path: string; sha: string }[]): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) h.update(`${f.path}\0${f.sha}\n`);
  return h.digest("hex");
}

/** Count the MCP servers an .mcp.json (or inline manifest block) defines. */
export function countMcpServers(text: string | null | undefined): number {
  if (!text) return 0;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const servers = parsed.mcpServers && typeof parsed.mcpServers === "object" ? parsed.mcpServers : parsed;
    return Object.keys(servers as Record<string, unknown>).filter((k) => k !== "$schema").length;
  } catch {
    return 0;
  }
}

/** Count hook entries in a hooks.json (every matcher × hook). */
export function countHooks(text: string | null | undefined): number {
  if (!text) return 0;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const hooks = parsed.hooks && typeof parsed.hooks === "object" ? (parsed.hooks as Record<string, unknown>) : parsed;
    let n = 0;
    for (const v of Object.values(hooks)) {
      if (!Array.isArray(v)) continue;
      for (const group of v) {
        const inner = group && typeof group === "object" ? (group as Record<string, unknown>).hooks : null;
        n += Array.isArray(inner) ? inner.length : 1;
      }
    }
    return n;
  } catch {
    return 0;
  }
}

// ─── GitHub client ───────────────────────────────────────

export interface GitHubClient {
  json<T>(path: string): Promise<T>;
}

export class GitHubFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = "GitHubFetchError";
  }
}

export async function getMarketplaceGitHubToken(): Promise<string | null> {
  return (
    (await getSetting(PLUGIN_CONTENT_SETTINGS_KEYS.TOKEN)) ??
    (await getSetting("github_copilot_token")) ??
    process.env.GITHUB_TOKEN ??
    null
  );
}

export function createGitHubClient(token: string | null, fetchImpl: typeof fetch = fetch): GitHubClient {
  return {
    async json<T>(path: string): Promise<T> {
      const res = await fetchImpl(`${GITHUB_API}${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": USER_AGENT,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const remaining = res.headers.get("x-ratelimit-remaining");
        const hint = res.status === 403 && remaining === "0" ? " (GitHub rate limit exhausted — configure a token)" : "";
        throw new GitHubFetchError(`GitHub ${res.status} on ${path}${hint}${body ? `: ${body.slice(0, 200)}` : ""}`, res.status, path);
      }
      return (await res.json()) as T;
    },
  };
}

interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

async function resolveCommit(gh: GitHubClient, repo: string, ref: string): Promise<string> {
  const data = await gh.json<{ sha: string }>(`/repos/${repo}/commits/${encodeURIComponent(ref)}`);
  return data.sha;
}

async function readTree(gh: GitHubClient, repo: string, sha: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const data = await gh.json<{ tree: TreeEntry[]; truncated?: boolean }>(`/repos/${repo}/git/trees/${sha}?recursive=1`);
  return { entries: data.tree, truncated: Boolean(data.truncated) };
}

async function readBlob(
  gh: GitHubClient,
  repo: string,
  sha: string,
  limit: number = MAX_FILE_TEXT_BYTES,
): Promise<{ text: string | null; size: number; truncated: boolean }> {
  const data = await gh.json<{ content: string; encoding: string; size: number }>(`/repos/${repo}/git/blobs/${sha}`);
  if (data.encoding !== "base64") return { text: null, size: data.size, truncated: false };
  const buf = Buffer.from(data.content, "base64");
  // Crude binary check: a NUL byte in the first 8KB.
  if (buf.subarray(0, 8192).includes(0)) return { text: null, size: buf.length, truncated: false };
  if (buf.length > limit) {
    return { text: buf.subarray(0, limit).toString("utf8"), size: buf.length, truncated: true };
  }
  return { text: buf.toString("utf8"), size: buf.length, truncated: false };
}

// ─── Marketplace resolution ──────────────────────────────

export async function loadMarketplaceRepos(): Promise<Record<string, string>> {
  const out = { ...DEFAULT_MARKETPLACE_REPOS };
  const raw = await getSetting(PLUGIN_CONTENT_SETTINGS_KEYS.MARKETPLACES);
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const entries: [string, unknown][] = Array.isArray(parsed)
      ? parsed.map((e) => [String((e as Record<string, unknown>)?.name ?? ""), (e as Record<string, unknown>)?.repo])
      : Object.entries(parsed as Record<string, unknown>);
    for (const [name, repo] of entries) {
      const parsedRepo = parseGitHubRepo(typeof repo === "string" ? repo : null);
      if (name && parsedRepo) out[name] = parsedRepo;
    }
  } catch {
    // A malformed setting must not take the defaults down with it.
  }
  return out;
}

interface MarketplaceManifest {
  name?: string;
  plugins?: MarketplaceEntry[];
  renames?: Record<string, string>;
}

interface LoadedMarketplace {
  repo: string;
  sha: string;
  manifest: MarketplaceManifest;
}

async function loadMarketplace(gh: GitHubClient, repo: string): Promise<LoadedMarketplace> {
  const sha = await resolveCommit(gh, repo, "HEAD");
  const { entries } = await readTree(gh, repo, sha);
  const manifestEntry = entries.find((e) => e.type === "blob" && e.path === ".claude-plugin/marketplace.json");
  if (!manifestEntry) throw new GitHubFetchError(`${repo} has no .claude-plugin/marketplace.json`, 404, repo);
  const blob = await readBlob(gh, repo, manifestEntry.sha, MAX_MANIFEST_BYTES);
  if (!blob.text || blob.truncated) throw new GitHubFetchError(`${repo} marketplace.json is not readable text`, 422, repo);
  return { repo, sha, manifest: JSON.parse(blob.text) as MarketplaceManifest };
}

export function findMarketplaceEntry(manifest: MarketplaceManifest, plugin: string): MarketplaceEntry | null {
  const plugins = manifest.plugins ?? [];
  const direct = plugins.find((p) => p.name === plugin);
  if (direct) return direct;
  const renamed = manifest.renames?.[plugin];
  return renamed ? (plugins.find((p) => p.name === renamed) ?? null) : null;
}

// ─── Fetch one plugin ────────────────────────────────────

export interface PluginFetchOutcome {
  marketplace: string;
  plugin: string;
  status: PluginContentStatus | "unchanged";
  reason?: string;
  files?: number;
  commitSha?: string | null;
}

interface FetchedPlugin {
  status: PluginContentStatus;
  statusReason: string | null;
  repo: string | null;
  path: string | null;
  ref: string | null;
  commitSha: string | null;
  version: string | null;
  manifest: PluginManifest | null;
  files: { path: string; kind: PluginFileKind; name: string | null; sha: string; size: number; text: string | null; truncated: boolean }[];
}

/**
 * Fetch one plugin's files from GitHub. Pure with respect to the database:
 * takes a client and a loaded marketplace, returns what should be stored.
 * `knownCommitSha` lets the caller skip the blob reads when the pinned
 * commit has not moved.
 */
export async function fetchPluginFromGitHub(
  gh: GitHubClient,
  marketplace: LoadedMarketplace,
  plugin: string,
  knownCommitSha: string | null = null,
): Promise<FetchedPlugin | { unchanged: true; commitSha: string }> {
  const base = (status: PluginContentStatus, reason: string | null): FetchedPlugin => ({
    status,
    statusReason: reason,
    repo: null,
    path: null,
    ref: null,
    commitSha: null,
    version: null,
    manifest: null,
    files: [],
  });
  const entry = findMarketplaceEntry(marketplace.manifest, plugin);
  if (!entry) return base("not_found", `"${plugin}" is not listed in the ${marketplace.repo} marketplace`);
  const resolved = resolvePluginSource(entry, marketplace.repo, marketplace.sha);
  if (!resolved.ok) return base("unsupported", resolved.reason);
  const { repo, path, ref } = resolved.source;

  const commitSha = await resolveCommit(gh, repo, ref);
  if (knownCommitSha && knownCommitSha === commitSha) return { unchanged: true, commitSha };

  const { entries, truncated } = await readTree(gh, repo, commitSha);
  const prefix = path ? path + "/" : "";
  const blobs = entries.filter((e) => e.type === "blob" && (prefix === "" || e.path.startsWith(prefix)));
  if (blobs.length === 0) {
    return { ...base("not_found", `no files under ${repo}/${path || "(root)"} at ${commitSha.slice(0, 7)}`), repo, path, ref, commitSha };
  }
  const relative = new Map(blobs.map((e) => [e.path.slice(prefix.length), e]));

  // Manifest first: it can redirect where skills/hooks/servers live.
  let manifest: PluginManifest | null = null;
  const manifestEntry = relative.get(".claude-plugin/plugin.json");
  if (manifestEntry) {
    const blob = await readBlob(gh, repo, manifestEntry.sha, MAX_MANIFEST_BYTES);
    if (blob.text && !blob.truncated) {
      try {
        manifest = JSON.parse(blob.text) as PluginManifest;
      } catch {
        manifest = null;
      }
    }
  }

  const selected = selectPluginFiles([...relative.keys()], manifest);
  const files: FetchedPlugin["files"] = [];
  for (const sel of selected) {
    const e = relative.get(sel.path)!;
    const blob = await readBlob(gh, repo, e.sha);
    files.push({ path: sel.path, kind: sel.kind, name: sel.name, sha: e.sha, size: blob.size, text: blob.text, truncated: blob.truncated });
  }

  const version = (typeof manifest?.version === "string" ? manifest.version : null) ?? entry.version ?? null;
  return {
    status: "fetched",
    statusReason: truncated ? "repository tree was truncated by GitHub; some files may be missing" : null,
    repo,
    path,
    ref,
    commitSha,
    version,
    manifest,
    files,
  };
}

// ─── Persistence ─────────────────────────────────────────

async function storeFetched(marketplace: string, plugin: string, fetched: FetchedPlugin, now: Date): Promise<PluginFetchOutcome> {
  const existing = await prisma.pluginContent.findUnique({ where: { marketplace_plugin: { marketplace, plugin } } });
  const contentHash = fetched.status === "fetched" ? computeContentHash(fetched.files) : null;
  const changed = Boolean(contentHash && existing?.contentHash && existing.contentHash !== contentHash);
  const byKind = (k: PluginFileKind) => fetched.files.filter((f) => f.kind === k);
  const hookCount = byKind("hook").reduce((n, f) => n + countHooks(f.text), 0);
  const inlineHooks = fetched.manifest?.hooks && typeof fetched.manifest.hooks === "object" && !Array.isArray(fetched.manifest.hooks)
    ? countHooks(JSON.stringify(fetched.manifest.hooks))
    : 0;
  const mcpCount = byKind("mcp").reduce((n, f) => n + countMcpServers(f.text), 0);
  const inlineMcp = fetched.manifest?.mcpServers && typeof fetched.manifest.mcpServers === "object" && !Array.isArray(fetched.manifest.mcpServers)
    ? countMcpServers(JSON.stringify(fetched.manifest.mcpServers))
    : 0;

  const data = {
    repo: fetched.repo,
    path: fetched.path,
    ref: fetched.ref,
    commitSha: fetched.commitSha,
    version: fetched.version,
    status: fetched.status,
    statusReason: fetched.statusReason,
    manifest: (fetched.manifest ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
    skillCount: byKind("skill").length,
    hookCount: hookCount + inlineHooks,
    mcpServerCount: mcpCount + inlineMcp,
    commandCount: byKind("command").length,
    agentCount: byKind("agent").length,
    contentHash: contentHash ?? existing?.contentHash ?? null,
    previousContentHash: changed ? existing!.contentHash : (existing?.previousContentHash ?? null),
    changedAt: changed ? now : (existing?.changedAt ?? null),
    fetchedAt: now,
  };

  await prisma.$transaction(async (tx) => {
    const row = await tx.pluginContent.upsert({
      where: { marketplace_plugin: { marketplace, plugin } },
      create: { marketplace, plugin, ...data },
      update: data,
    });
    if (fetched.status === "fetched") {
      await tx.pluginContentFile.deleteMany({ where: { contentId: row.id } });
      if (fetched.files.length) {
        await tx.pluginContentFile.createMany({
          data: fetched.files.map((f) => ({ contentId: row.id, ...f })),
        });
      }
    }
  });

  return { marketplace, plugin, status: fetched.status, reason: fetched.statusReason ?? undefined, files: fetched.files.length, commitSha: fetched.commitSha };
}

export interface FetchPluginContentOptions {
  /** Specific plugins; default is every named plugin the inventory has seen. */
  plugins?: { marketplace: string; plugin: string }[];
  /** Re-read files even when the pinned commit has not moved. */
  force?: boolean;
  timeBudgetMs?: number;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export interface FetchPluginContentResult {
  done: boolean;
  outcomes: PluginFetchOutcome[];
  skippedMarketplaces: { marketplace: string; reason: string }[];
}

/** The (marketplace, plugin) pairs the inventory knows by name. */
export async function listInventoriedPlugins(): Promise<{ marketplace: string; plugin: string }[]> {
  const rows = await prisma.assistantExtension.findMany({
    where: { redacted: false, marketplace: { not: null }, OR: [{ kind: "plugin" }, { pluginName: { not: null } }] },
    select: { kind: true, name: true, pluginName: true, marketplace: true },
  });
  const seen = new Map<string, { marketplace: string; plugin: string }>();
  for (const r of rows) {
    const plugin = r.kind === "plugin" ? r.name : r.pluginName;
    if (!plugin || !r.marketplace || plugin === "third-party" || r.marketplace === "third-party") continue;
    seen.set(`${r.marketplace}\0${plugin}`, { marketplace: r.marketplace, plugin });
  }
  return [...seen.values()].sort((a, b) => a.marketplace.localeCompare(b.marketplace) || a.plugin.localeCompare(b.plugin));
}

export async function fetchPluginContent(opts: FetchPluginContentOptions = {}): Promise<FetchPluginContentResult> {
  const deadline = Date.now() + (opts.timeBudgetMs ?? 240_000);
  const targets = opts.plugins?.length ? opts.plugins : await listInventoriedPlugins();
  const repos = await loadMarketplaceRepos();
  const gh = createGitHubClient(await getMarketplaceGitHubToken(), opts.fetchImpl);
  const now = new Date();

  const outcomes: PluginFetchOutcome[] = [];
  const skippedMarketplaces: { marketplace: string; reason: string }[] = [];
  const loaded = new Map<string, LoadedMarketplace | null>();

  for (const target of targets) {
    if (Date.now() > deadline) return { done: false, outcomes, skippedMarketplaces };
    const repo = repos[target.marketplace];
    if (!repo) {
      if (!skippedMarketplaces.some((s) => s.marketplace === target.marketplace)) {
        skippedMarketplaces.push({
          marketplace: target.marketplace,
          reason: `no GitHub repository configured for marketplace "${target.marketplace}" (set ${PLUGIN_CONTENT_SETTINGS_KEYS.MARKETPLACES})`,
        });
      }
      continue;
    }
    let marketplace = loaded.get(target.marketplace);
    if (marketplace === undefined) {
      try {
        marketplace = await loadMarketplace(gh, repo);
      } catch (err) {
        marketplace = null;
        skippedMarketplaces.push({ marketplace: target.marketplace, reason: err instanceof Error ? err.message : String(err) });
      }
      loaded.set(target.marketplace, marketplace);
    }
    if (!marketplace) continue;

    try {
      const existing = opts.force
        ? null
        : await prisma.pluginContent.findUnique({
            where: { marketplace_plugin: { marketplace: target.marketplace, plugin: target.plugin } },
            select: { commitSha: true, status: true },
          });
      const fetched = await fetchPluginFromGitHub(
        gh,
        marketplace,
        target.plugin,
        existing?.status === "fetched" ? existing.commitSha : null,
      );
      if ("unchanged" in fetched) {
        await prisma.pluginContent.update({
          where: { marketplace_plugin: { marketplace: target.marketplace, plugin: target.plugin } },
          data: { fetchedAt: now },
        });
        outcomes.push({ ...target, status: "unchanged", commitSha: fetched.commitSha });
        continue;
      }
      outcomes.push(await storeFetched(target.marketplace, target.plugin, fetched, now));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await storeFetched(
        target.marketplace,
        target.plugin,
        { status: "error", statusReason: reason, repo: null, path: null, ref: null, commitSha: null, version: null, manifest: null, files: [] },
        now,
      );
      outcomes.push({ ...target, status: "error", reason });
      // A rate-limit or auth failure will repeat for every plugin; stop early.
      if (err instanceof GitHubFetchError && (err.status === 401 || err.status === 403)) {
        return { done: false, outcomes, skippedMarketplaces };
      }
    }
  }
  return { done: true, outcomes, skippedMarketplaces };
}

// ─── Read side ───────────────────────────────────────────

export interface PluginContentSummaryRow {
  id: string;
  marketplace: string;
  plugin: string;
  version: string | null;
  status: PluginContentStatus;
  statusReason: string | null;
  repo: string | null;
  commitSha: string | null;
  skillCount: number;
  hookCount: number;
  mcpServerCount: number;
  commandCount: number;
  agentCount: number;
  fetchedAt: Date;
  changedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  /** fetched content differs from what was last reviewed (or never reviewed). */
  needsReview: boolean;
}

function toSummary(r: {
  id: string;
  marketplace: string;
  plugin: string;
  version: string | null;
  status: string;
  statusReason: string | null;
  repo: string | null;
  commitSha: string | null;
  skillCount: number;
  hookCount: number;
  mcpServerCount: number;
  commandCount: number;
  agentCount: number;
  fetchedAt: Date;
  changedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  reviewedHash: string | null;
  contentHash: string | null;
}): PluginContentSummaryRow {
  return {
    id: r.id,
    marketplace: r.marketplace,
    plugin: r.plugin,
    version: r.version,
    status: r.status as PluginContentStatus,
    statusReason: r.statusReason,
    repo: r.repo,
    commitSha: r.commitSha,
    skillCount: r.skillCount,
    hookCount: r.hookCount,
    mcpServerCount: r.mcpServerCount,
    commandCount: r.commandCount,
    agentCount: r.agentCount,
    fetchedAt: r.fetchedAt,
    changedAt: r.changedAt,
    reviewedAt: r.reviewedAt,
    reviewedBy: r.reviewedBy,
    needsReview: r.status === "fetched" && (!r.reviewedHash || r.reviewedHash !== r.contentHash),
  };
}

export async function listPluginContent(): Promise<PluginContentSummaryRow[]> {
  const rows = await prisma.pluginContent.findMany({ orderBy: [{ marketplace: "asc" }, { plugin: "asc" }] });
  return rows.map(toSummary);
}

/** Map "marketplace\0plugin" → row id, for linking inventory rows. */
export async function pluginContentIndex(): Promise<Map<string, PluginContentSummaryRow>> {
  const rows = await listPluginContent();
  return new Map(rows.map((r) => [`${r.marketplace}\0${r.plugin}`, r]));
}

export function pluginContentKey(marketplace: string | null, plugin: string | null): string | null {
  return marketplace && plugin ? `${marketplace}\0${plugin}` : null;
}

export interface PluginContentDetail extends PluginContentSummaryRow {
  path: string | null;
  ref: string | null;
  manifest: Record<string, unknown> | null;
  previousContentHash: string | null;
  contentHash: string | null;
  reviewNote: string | null;
  files: { id: string; kind: PluginFileKind; path: string; name: string | null; sha: string; size: number; text: string | null; truncated: boolean }[];
}

export async function getPluginContent(id: string): Promise<PluginContentDetail | null> {
  const row = await prisma.pluginContent.findUnique({ where: { id }, include: { files: { orderBy: [{ kind: "asc" }, { path: "asc" }] } } });
  if (!row) return null;
  const rank: Record<string, number> = { manifest: 0, hook: 1, mcp: 2, skill: 3, agent: 4, command: 5, readme: 6, other: 7 };
  return {
    ...toSummary(row),
    path: row.path,
    ref: row.ref,
    manifest: row.manifest && typeof row.manifest === "object" && !Array.isArray(row.manifest) ? (row.manifest as Record<string, unknown>) : null,
    previousContentHash: row.previousContentHash,
    contentHash: row.contentHash,
    reviewNote: row.reviewNote,
    files: [...row.files]
      .sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || a.path.localeCompare(b.path))
      .map((f) => ({ id: f.id, kind: f.kind as PluginFileKind, path: f.path, name: f.name, sha: f.sha, size: f.size, text: f.text, truncated: f.truncated })),
  };
}

export async function markPluginContentReviewed(id: string, reviewer: string, note: string | null): Promise<PluginContentSummaryRow | null> {
  const row = await prisma.pluginContent.findUnique({ where: { id } });
  if (!row) return null;
  const updated = await prisma.pluginContent.update({
    where: { id },
    data: { reviewedAt: new Date(), reviewedBy: reviewer, reviewedHash: row.contentHash, reviewNote: note },
  });
  return toSummary(updated);
}

export const PLUGIN_FILE_KIND_LABELS: Record<PluginFileKind, string> = {
  manifest: "Manifest",
  readme: "README",
  skill: "Skill",
  hook: "Hooks",
  mcp: "MCP servers",
  command: "Command",
  agent: "Agent",
  other: "Other",
};

export const PLUGIN_STATUS_LABELS: Record<PluginContentStatus, string> = {
  fetched: "Fetched",
  unsupported: "Unsupported source",
  not_found: "Not found",
  error: "Fetch failed",
};
