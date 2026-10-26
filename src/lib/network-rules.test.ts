import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateNetworkTarget,
  filterRequestHeaders,
  filterResponseHeaders,
  isForbiddenAddress,
  isForbiddenHostname,
  loggablePath,
  matchesPattern,
  networkBlockedResponseBody,
  parseNetworkProxyMode,
  parseNetworkTarget,
  parsePattern,
  rewriteLocation,
  validatePattern,
  type NetworkRule,
} from "./network-rules";

const target = (host: string, path = "/", port: number | null = null) => ({ host, port, path });

describe("parsePattern", () => {
  it("parses a bare host (apex + subdomains)", () => {
    assert.deepEqual(parsePattern("Example.com"), {
      host: "example.com", subdomainsOnly: false, anyHost: false, port: null, path: null, pathMode: "segment",
    });
  });

  it("parses wildcard, port, path and string-prefix forms", () => {
    assert.equal(parsePattern("*.example.com")?.subdomainsOnly, true);
    assert.equal(parsePattern("example.com:8443")?.port, 8443);
    assert.deepEqual(parsePattern("https://example.com/v1/files/")?.path, "/v1/files");
    const star = parsePattern("example.com/v1/file*");
    assert.equal(star?.path, "/v1/file");
    assert.equal(star?.pathMode, "string");
    assert.equal(parsePattern("*")?.anyHost, true);
  });

  it("rejects malformed patterns", () => {
    for (const bad of ["", "exa mple.com", "example.com:99999", "example.com/a/../b", "-bad.com", "a?b=1", "exa\\mple.com"]) {
      assert.equal(parsePattern(bad), null, bad);
    }
    assert.match(validatePattern("a?b") ?? "", /Query/);
    assert.equal(validatePattern("example.com"), null);
  });
});

describe("matchesPattern", () => {
  it("bare host matches apex and subdomains, not lookalikes", () => {
    const p = parsePattern("example.com")!;
    assert.equal(matchesPattern(p, target("example.com")), true);
    assert.equal(matchesPattern(p, target("api.example.com")), true);
    assert.equal(matchesPattern(p, target("notexample.com")), false);
  });

  it("*.host excludes the apex", () => {
    const p = parsePattern("*.example.com")!;
    assert.equal(matchesPattern(p, target("example.com")), false);
    assert.equal(matchesPattern(p, target("a.b.example.com")), true);
  });

  it("segment path prefix does not match a longer segment", () => {
    const p = parsePattern("example.com/v1/files")!;
    assert.equal(matchesPattern(p, target("example.com", "/v1/files")), true);
    assert.equal(matchesPattern(p, target("example.com", "/v1/files/abc")), true);
    assert.equal(matchesPattern(p, target("example.com", "/v1/filesystem")), false);
    const s = parsePattern("example.com/v1/file*")!;
    assert.equal(matchesPattern(s, target("example.com", "/v1/filesystem")), true);
  });

  it("port patterns compare against 443 by default", () => {
    assert.equal(matchesPattern(parsePattern("example.com:443")!, target("example.com")), true);
    assert.equal(matchesPattern(parsePattern("example.com:8443")!, target("example.com")), false);
    assert.equal(matchesPattern(parsePattern("example.com:8443")!, target("example.com", "/", 8443)), true);
  });
});

describe("evaluateNetworkTarget", () => {
  const rules: NetworkRule[] = [
    { id: "b1", pattern: "*", action: "BLOCK", reason: "default deny" },
    { id: "a1", pattern: "api.openai.com", action: "ALLOW" },
    { id: "b2", pattern: "api.openai.com/v1/files", action: "BLOCK", reason: "no uploads" },
    { id: "d1", pattern: "disabled.example", action: "ALLOW", enabled: false },
  ];

  it("ALLOW beats BLOCK regardless of order", () => {
    const v = evaluateNetworkTarget(target("api.openai.com", "/v1/files"), rules);
    assert.equal(v.allowed, true);
    assert.equal(v.rule?.id, "a1");
  });

  it("falls through to the first BLOCK rule", () => {
    const v = evaluateNetworkTarget(target("pastebin.com", "/raw"), rules);
    assert.equal(v.allowed, false);
    assert.equal(v.rule?.id, "b1");
    assert.equal(v.source, "rule");
  });

  it("skips disabled rules and unparsable patterns", () => {
    const v = evaluateNetworkTarget(target("disabled.example"), [...rules, { id: "x", pattern: "bad host", action: "ALLOW" }]);
    assert.equal(v.allowed, false);
  });

  it("denies Shadow AI blocked domains and their subdomains", () => {
    const v = evaluateNetworkTarget(target("app.jasper.ai", "/login"), [], ["jasper.ai"]);
    assert.equal(v.allowed, false);
    assert.equal(v.source, "shadow_ai");
    assert.equal(v.shadowDomain, "jasper.ai");
    assert.equal(evaluateNetworkTarget(target("example.com"), [], ["jasper.ai"]).allowed, true);
  });

  it("an ALLOW rule overrides a Shadow AI block", () => {
    const v = evaluateNetworkTarget(target("jasper.ai"), [{ id: "a", pattern: "jasper.ai", action: "ALLOW" }], ["jasper.ai"]);
    assert.equal(v.allowed, true);
  });

  it("blocked body names the rule and reason", () => {
    const v = evaluateNetworkTarget(target("pastebin.com", "/raw"), rules);
    const body = networkBlockedResponseBody(v, target("pastebin.com", "/raw")) as { error: { type: string; message: string } };
    assert.equal(body.error.type, "network_blocked");
    assert.match(body.error.message, /default deny/);
  });
});

describe("parseNetworkTarget", () => {
  it("builds an https URL with path and query", () => {
    const r = parseNetworkTarget("API.GitHub.com", "/repos/a/b", "?per_page=5");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.target.url, "https://api.github.com/repos/a/b?per_page=5");
      assert.equal(r.target.port, null);
      assert.equal(r.target.authority, "api.github.com");
    }
  });

  it("keeps non-default ports and folds :443 away", () => {
    const r = parseNetworkTarget("example.com:8443", "", "");
    assert.equal(r.ok && r.target.url, "https://example.com:8443/");
    const d = parseNetworkTarget("example.com:443", "x", "");
    assert.equal(d.ok && d.target.url, "https://example.com/x");
  });

  it("refuses private, loopback and metadata hosts by name", () => {
    for (const h of ["localhost", "127.0.0.1", "169.254.169.254", "10.1.2.3", "db.internal", "printer.local", "metadata.google.internal"]) {
      const r = parseNetworkTarget(h, "/", "");
      assert.equal(r.ok, false, h);
      if (!r.ok) assert.equal(r.status, 403, h);
    }
  });

  it("refuses malformed hosts and traversal paths", () => {
    assert.equal(parseNetworkTarget("exa mple.com", "/", "").ok, false);
    assert.equal(parseNetworkTarget("user@example.com", "/", "").ok, false);
    assert.equal(parseNetworkTarget("example.com", "/a/../b", "").ok, false);
    assert.equal(parseNetworkTarget("example.com", "/a%2Fb", "").ok, false);
    assert.equal(parseNetworkTarget("[::1]", "/", "").ok, false);
  });
});

describe("isForbiddenAddress", () => {
  it("flags private, loopback, link-local, CGNAT, multicast and unspecified", () => {
    for (const ip of ["10.0.0.1", "172.16.5.5", "172.31.255.255", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "224.0.0.1", "0.0.0.0", "255.255.255.255", "::1", "::", "fe80::1", "fd12::1", "fc00::1", "ff02::1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "2001:db8::1"]) {
      assert.equal(isForbiddenAddress(ip), true, ip);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "140.82.112.3", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) {
      assert.equal(isForbiddenAddress(ip), false, ip);
    }
  });

  it("isForbiddenHostname covers names and literals", () => {
    assert.equal(isForbiddenHostname("foo.localhost"), true);
    assert.equal(isForbiddenHostname("192.168.0.9"), true);
    assert.equal(isForbiddenHostname("example.com"), false);
  });
});

describe("header filtering", () => {
  it("drops hop-by-hop, platform and proxy-control request headers", () => {
    const out = filterRequestHeaders([
      ["Host", "proxy"], ["Content-Length", "3"], ["X-Proxy-Key", "s"], ["x-user-email", "a@b"],
      ["X-Forwarded-For", "1.1.1.1"], ["x-vercel-id", "x"], ["Connection", "keep-alive"],
      ["Authorization", "Bearer t"], ["Content-Type", "application/json"], ["Accept-Encoding", "br"],
    ]);
    assert.deepEqual(out, [["authorization", "Bearer t"], ["content-type", "application/json"]]);
  });

  it("drops encoding/length and origin-pinning response headers", () => {
    const out = filterResponseHeaders([
      ["Content-Encoding", "gzip"], ["Content-Length", "10"], ["Transfer-Encoding", "chunked"],
      ["Strict-Transport-Security", "max-age=1"], ["Content-Type", "text/plain"], ["X-Request-Id", "r"],
    ]);
    assert.deepEqual(out, [["content-type", "text/plain"], ["x-request-id", "r"]]);
  });
});

describe("rewriteLocation", () => {
  const base = "https://app.example/api/proxy/net";
  it("routes absolute https redirects back through the proxy", () => {
    assert.equal(rewriteLocation("https://api.example.com/v2/x?y=1", base), `${base}/api.example.com/v2/x?y=1`);
    assert.equal(rewriteLocation("https://api.example.com:8443/", base), `${base}/api.example.com:8443/`);
  });
  it("leaves relative and http locations alone", () => {
    assert.equal(rewriteLocation("/login", base), "/login");
    assert.equal(rewriteLocation("http://plain.example/", base), "http://plain.example/");
  });
});

describe("misc", () => {
  it("parseNetworkProxyMode defaults to off", () => {
    assert.equal(parseNetworkProxyMode(null), "off");
    assert.equal(parseNetworkProxyMode(" Enforce "), "enforce");
    assert.equal(parseNetworkProxyMode("monitor"), "monitor");
    assert.equal(parseNetworkProxyMode("yes"), "off");
  });
  it("loggablePath strips the query and truncates", () => {
    assert.equal(loggablePath("/a/b?key=secret"), "/a/b");
    assert.equal(loggablePath("/" + "x".repeat(1000)).length, 512);
  });
});
