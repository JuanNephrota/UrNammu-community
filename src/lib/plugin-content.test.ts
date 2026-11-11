import test from "node:test";
import assert from "node:assert/strict";
import {
  computeContentHash,
  countHooks,
  countMcpServers,
  fetchPluginFromGitHub,
  findMarketplaceEntry,
  parseGitHubRepo,
  resolvePluginSource,
  selectPluginFiles,
  type GitHubClient,
} from "./plugin-content";

test("parseGitHubRepo accepts the URL shapes marketplaces use", () => {
  assert.equal(parseGitHubRepo("https://github.com/AikidoSec/aikido-claude-plugin.git"), "AikidoSec/aikido-claude-plugin");
  assert.equal(parseGitHubRepo("https://github.com/anthropics/claude-plugins-official"), "anthropics/claude-plugins-official");
  assert.equal(parseGitHubRepo("git@github.com:org/repo.git"), "org/repo");
  assert.equal(parseGitHubRepo("org/repo"), "org/repo");
  assert.equal(parseGitHubRepo("https://gitlab.com/org/repo.git"), null);
  assert.equal(parseGitHubRepo(""), null);
});

test("resolvePluginSource handles relative paths, git-subdir, whole repos, and refuses commands", () => {
  const mp = "anthropics/claude-plugins-official";
  const sha = "abc123";
  assert.deepEqual(resolvePluginSource({ name: "a", source: "./plugins/agent-sdk-dev" }, mp, sha), {
    ok: true,
    source: { repo: mp, path: "plugins/agent-sdk-dev", ref: sha },
  });
  assert.deepEqual(
    resolvePluginSource(
      { name: "b", source: { source: "git-subdir", url: "https://github.com/42Crunch-AI/claude-plugins.git", path: "plugins/api", ref: "v1.5.5", sha: "faf530" } },
      mp,
      sha,
    ),
    { ok: true, source: { repo: "42Crunch-AI/claude-plugins", path: "plugins/api", ref: "faf530" } },
  );
  assert.deepEqual(
    resolvePluginSource({ name: "c", source: { source: "url", url: "https://github.com/AikidoSec/aikido-claude-plugin.git", sha: "8fdc99" } }, mp, sha),
    { ok: true, source: { repo: "AikidoSec/aikido-claude-plugin", path: "", ref: "8fdc99" } },
  );
  assert.deepEqual(resolvePluginSource({ name: "d", source: { source: "url", url: "https://github.com/x/y.git" } }, mp, sha), {
    ok: true,
    source: { repo: "x/y", path: "", ref: "HEAD" },
  });
  const cmd = resolvePluginSource({ name: "xcode", source: { source: "command", command: "xcrun agent plugin path" } }, mp, sha);
  assert.equal(cmd.ok, false);
  const gitlab = resolvePluginSource({ name: "e", source: { source: "url", url: "https://gitlab.com/x/y.git" } }, mp, sha);
  assert.equal(gitlab.ok, false);
});

test("findMarketplaceEntry follows renames", () => {
  const manifest = { plugins: [{ name: "agentforce-adlc", source: "./p" }], renames: { adlc: "agentforce-adlc" } };
  assert.equal(findMarketplaceEntry(manifest, "adlc")?.name, "agentforce-adlc");
  assert.equal(findMarketplaceEntry(manifest, "missing"), null);
});

test("selectPluginFiles keeps manifest, definitions, skills, commands, agents, and honors manifest paths", () => {
  const paths = [
    ".claude-plugin/plugin.json",
    "README.md",
    ".mcp.json",
    "hooks/hooks.json",
    "skills/scan/SKILL.md",
    "skills/scan/reference.md",
    "commands/review.md",
    "agents/reviewer.md",
    "custom-skills/extra/SKILL.md",
    "src/index.ts",
    "package.json",
  ];
  const selected = selectPluginFiles(paths, { skills: ["./custom-skills"] });
  assert.deepEqual(
    selected.map((f) => [f.kind, f.path, f.name]),
    [
      ["manifest", ".claude-plugin/plugin.json", null],
      ["hook", "hooks/hooks.json", null],
      ["mcp", ".mcp.json", null],
      ["skill", "custom-skills/extra/SKILL.md", "extra"],
      ["skill", "skills/scan/SKILL.md", "scan"],
      ["agent", "agents/reviewer.md", "reviewer"],
      ["command", "commands/review.md", "review"],
      ["readme", "README.md", null],
    ],
  );
});

test("content hash is order-independent and changes with any blob", () => {
  const a = computeContentHash([{ path: "x", sha: "1" }, { path: "y", sha: "2" }]);
  const b = computeContentHash([{ path: "y", sha: "2" }, { path: "x", sha: "1" }]);
  const c = computeContentHash([{ path: "y", sha: "3" }, { path: "x", sha: "1" }]);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("hook and MCP server counting read both file shapes", () => {
  assert.equal(countMcpServers(JSON.stringify({ mcpServers: { a: {}, b: {} } })), 2);
  assert.equal(countMcpServers(JSON.stringify({ a: {}, $schema: "x" })), 1);
  assert.equal(countMcpServers("not json"), 0);
  assert.equal(
    countHooks(JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command" }, { type: "command" }] }], Stop: [{ hooks: [{ type: "command" }] }] } })),
    3,
  );
  assert.equal(countHooks(JSON.stringify({ PreToolUse: [{ type: "command" }] })), 1);
});

function fakeGitHub(responses: Record<string, unknown>): GitHubClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async json<T>(path: string): Promise<T> {
      calls.push(path);
      const key = Object.keys(responses).find((k) => path.startsWith(k));
      if (!key) throw new Error(`unexpected GitHub call ${path}`);
      return responses[key] as T;
    },
  };
}

const b64 = (s: string) => ({ content: Buffer.from(s).toString("base64"), encoding: "base64", size: Buffer.byteLength(s) });

test("fetchPluginFromGitHub resolves a relative-path plugin, reads its files, and reports unchanged on a re-fetch", async () => {
  const marketplace = {
    repo: "anthropics/claude-plugins-official",
    sha: "mpsha",
    manifest: { plugins: [{ name: "demo", source: "./plugins/demo", version: "0.9.0" }] },
  };
  const gh = fakeGitHub({
    "/repos/anthropics/claude-plugins-official/commits/mpsha": { sha: "mpsha" },
    "/repos/anthropics/claude-plugins-official/git/trees/mpsha": {
      tree: [
        { path: "plugins/demo/.claude-plugin/plugin.json", type: "blob", sha: "s-manifest" },
        { path: "plugins/demo/skills/review/SKILL.md", type: "blob", sha: "s-skill" },
        { path: "plugins/demo/hooks/hooks.json", type: "blob", sha: "s-hooks" },
        { path: "plugins/other/skills/x/SKILL.md", type: "blob", sha: "s-other" },
      ],
    },
    "/repos/anthropics/claude-plugins-official/git/blobs/s-manifest": b64(JSON.stringify({ name: "demo", version: "1.0.0" })),
    "/repos/anthropics/claude-plugins-official/git/blobs/s-skill": b64("---\nname: review\n---\nReview the diff."),
    "/repos/anthropics/claude-plugins-official/git/blobs/s-hooks": b64(JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "echo hi" }] }] } })),
  });

  const fetched = await fetchPluginFromGitHub(gh, marketplace, "demo");
  assert.ok(!("unchanged" in fetched));
  assert.equal(fetched.status, "fetched");
  assert.equal(fetched.repo, "anthropics/claude-plugins-official");
  assert.equal(fetched.path, "plugins/demo");
  assert.equal(fetched.commitSha, "mpsha");
  assert.equal(fetched.version, "1.0.0", "manifest version beats the marketplace entry");
  assert.deepEqual(
    fetched.files.map((f) => [f.kind, f.path, f.name]),
    [
      ["manifest", ".claude-plugin/plugin.json", null],
      ["hook", "hooks/hooks.json", null],
      ["skill", "skills/review/SKILL.md", "review"],
    ],
  );
  assert.match(fetched.files[2].text ?? "", /Review the diff/);
  assert.ok(!gh.calls.some((c) => c.includes("s-other")), "files outside the plugin path are never read");

  const again = await fetchPluginFromGitHub(gh, marketplace, "demo", "mpsha");
  assert.deepEqual(again, { unchanged: true, commitSha: "mpsha" });

  const missing = await fetchPluginFromGitHub(gh, marketplace, "nope");
  assert.ok(!("unchanged" in missing));
  assert.equal(missing.status, "not_found");
});

test("fetchPluginFromGitHub pins a git-subdir plugin to the marketplace's sha and marks command sources unsupported", async () => {
  const marketplace = {
    repo: "anthropics/claude-plugins-official",
    sha: "mpsha",
    manifest: {
      plugins: [
        { name: "ext", source: { source: "git-subdir", url: "https://github.com/vendor/plugins.git", path: "plugins/ext", sha: "pinned" } },
        { name: "xcode", source: { source: "command", command: "xcrun" } },
      ],
    },
  };
  const gh = fakeGitHub({
    "/repos/vendor/plugins/commits/pinned": { sha: "pinned" },
    "/repos/vendor/plugins/git/trees/pinned": { tree: [{ path: "plugins/ext/skills/a/SKILL.md", type: "blob", sha: "s1" }] },
    "/repos/vendor/plugins/git/blobs/s1": b64("do a thing"),
  });
  const ext = await fetchPluginFromGitHub(gh, marketplace, "ext");
  assert.ok(!("unchanged" in ext));
  assert.equal(ext.status, "fetched");
  assert.equal(ext.repo, "vendor/plugins");
  assert.equal(ext.files.length, 1);
  assert.equal(ext.manifest, null);

  const xcode = await fetchPluginFromGitHub(gh, marketplace, "xcode");
  assert.ok(!("unchanged" in xcode));
  assert.equal(xcode.status, "unsupported");
});
