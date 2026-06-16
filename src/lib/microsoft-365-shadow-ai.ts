import { matchDomain, resolveAIToolMatch } from "./ai-tools-registry";
import { getSetting, MICROSOFT_SHADOW_AI_SETTINGS_KEYS } from "./settings";
import type { FullScanResult, ScanDiscovery } from "./google-workspace";

type MicrosoftConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

type MicrosoftOauthGrant = {
  clientId?: string;
  consentType?: string;
  principalId?: string;
  scope?: string;
};

type MicrosoftServicePrincipal = {
  id?: string;
  appId?: string;
  appDisplayName?: string;
  displayName?: string;
  homepage?: string;
  publisherName?: string;
  servicePrincipalNames?: string[];
  tags?: string[];
  servicePrincipalType?: string;
  verifiedPublisher?: {
    displayName?: string;
    verifiedPublisherId?: string;
    addedDateTime?: string;
  };
};

type MicrosoftAppRoleAssignment = {
  appRoleId?: string;
  principalId?: string;
  principalType?: string;
  resourceId?: string;
};

async function getMicrosoftConfig(): Promise<MicrosoftConfig | null> {
  const [tenantId, clientId, clientSecret] = await Promise.all([
    getSetting(MICROSOFT_SHADOW_AI_SETTINGS_KEYS.TENANT_ID),
    getSetting(MICROSOFT_SHADOW_AI_SETTINGS_KEYS.CLIENT_ID),
    getSetting(MICROSOFT_SHADOW_AI_SETTINGS_KEYS.CLIENT_SECRET),
  ]);

  const resolved = {
    tenantId:
      tenantId ?? process.env.MICROSOFT_SHADOW_AI_TENANT_ID ?? "",
    clientId:
      clientId ?? process.env.MICROSOFT_SHADOW_AI_CLIENT_ID ?? "",
    clientSecret:
      clientSecret ?? process.env.MICROSOFT_SHADOW_AI_CLIENT_SECRET ?? "",
  };

  return resolved.tenantId && resolved.clientId && resolved.clientSecret
    ? resolved
    : null;
}

export async function isMicrosoft365Configured(): Promise<boolean> {
  return !!(await getMicrosoftConfig());
}

export async function getMicrosoft365AccessToken(): Promise<string> {
  const config = await getMicrosoftConfig();
  if (!config) {
    throw new Error(
      "Microsoft 365 Shadow AI is not configured. Add tenant ID, client ID, and client secret."
    );
  }

  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );

  const payload = (await tokenResponse.json()) as
    | { access_token?: string; error_description?: string; error?: string }
    | undefined;

  if (!tokenResponse.ok || !payload?.access_token) {
    throw new Error(
      payload?.error_description ??
        payload?.error ??
        "Unable to authenticate to Microsoft Graph."
    );
  }

  return payload.access_token;
}

async function graphGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(
      payload.error?.message ??
        `Microsoft Graph request failed with ${response.status}.`
    );
  }

  return payload;
}

async function graphList<T>(
  path: string,
  accessToken: string,
  limit: number = 250
): Promise<T[]> {
  const results: T[] = [];
  let nextUrl = `https://graph.microsoft.com/v1.0${path}`;

  while (nextUrl && results.length < limit) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const payload = (await response.json()) as {
      value?: T[];
      "@odata.nextLink"?: string;
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(
        payload.error?.message ??
          `Microsoft Graph request failed with ${response.status}.`
      );
    }

    results.push(...(payload.value ?? []));
    nextUrl = payload["@odata.nextLink"] ?? "";
  }

  return results.slice(0, limit);
}

function extractDomain(servicePrincipal: MicrosoftServicePrincipal): string | null {
  const homepage = servicePrincipal.homepage?.trim();
  if (homepage) {
    try {
      return new URL(homepage).hostname.replace(/^www\./, "");
    } catch {
      return homepage.replace(/^https?:\/\//, "").split("/")[0] ?? null;
    }
  }

  for (const candidate of servicePrincipal.servicePrincipalNames ?? []) {
    if (candidate.includes(".")) {
      return candidate
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0];
    }
  }

  return null;
}

function extractCandidateDomains(
  servicePrincipal: MicrosoftServicePrincipal
): string[] {
  const domains = new Set<string>();
  const homepageDomain = extractDomain(servicePrincipal);
  if (homepageDomain) domains.add(homepageDomain);

  for (const candidate of servicePrincipal.servicePrincipalNames ?? []) {
    const normalized = candidate
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      ?.trim()
      .toLowerCase();
    if (normalized && normalized.includes(".")) domains.add(normalized);
  }

  return Array.from(domains);
}

function summarizeDiscoverySignals(input: {
  consentType: string | null;
  principalCount: number;
  scopeCount: number;
  assignmentCount: number;
  matchReasons: string[];
  confidence: string;
}) {
  return [
    `Matched with ${input.confidence} confidence via ${input.matchReasons.join(", ")}.`,
    `${input.principalCount} delegated principal(s), ${input.assignmentCount} app-role assignment(s), ${input.scopeCount} unique scope(s).`,
    input.consentType === "AllPrincipals"
      ? "Admin consent appears tenant-wide."
      : "Consent appears user-scoped.",
  ].join(" ");
}

export async function runMicrosoft365Scan(): Promise<FullScanResult> {
  const accessToken = await getMicrosoft365AccessToken();
  const grants = await graphList<MicrosoftOauthGrant>(
    "/oauth2PermissionGrants?$top=200&$select=clientId,consentType,principalId,scope",
    accessToken
  );

  const uniqueClientIds = Array.from(
    new Set(grants.map((grant) => grant.clientId).filter(Boolean))
  ) as string[];

  const principalMap = new Map<
    string,
    {
      scopes: string[];
      principals: Set<string>;
      consentType: string | null;
      grantCount: number;
    }
  >();

  for (const grant of grants) {
    if (!grant.clientId) continue;
    const scoped = principalMap.get(grant.clientId) ?? {
      scopes: [],
      principals: new Set<string>(),
      consentType: grant.consentType ?? null,
      grantCount: 0,
    };

    const scopes = (grant.scope ?? "")
      .split(" ")
      .map((scope) => scope.trim())
      .filter(Boolean);

    for (const scope of scopes) {
      if (!scoped.scopes.includes(scope)) scoped.scopes.push(scope);
    }
    if (grant.principalId) scoped.principals.add(grant.principalId);
    scoped.grantCount += 1;
    principalMap.set(grant.clientId, scoped);
  }

  const discoveries: ScanDiscovery[] = [];

  for (const clientId of uniqueClientIds.slice(0, 50)) {
    try {
      const servicePrincipal = await graphGet<MicrosoftServicePrincipal>(
        `/servicePrincipals/${clientId}?$select=id,appId,appDisplayName,displayName,homepage,publisherName,servicePrincipalNames,tags,servicePrincipalType,verifiedPublisher`,
        accessToken
      );
      const appRoleAssignments = await graphList<MicrosoftAppRoleAssignment>(
        `/servicePrincipals/${clientId}/appRoleAssignedTo?$top=50&$select=appRoleId,principalId,principalType,resourceId`,
        accessToken,
        50
      ).catch(() => []);

      const metadata = principalMap.get(clientId);
      const displayName =
        servicePrincipal.appDisplayName ??
        servicePrincipal.displayName ??
        servicePrincipal.publisherName ??
        "";
      const candidateDomains = extractCandidateDomains(servicePrincipal);
      const servicePrincipalHints = [
        displayName,
        servicePrincipal.homepage ?? "",
        servicePrincipal.publisherName ?? "",
        servicePrincipal.verifiedPublisher?.displayName ?? "",
        servicePrincipal.servicePrincipalType ?? "",
        ...(servicePrincipal.tags ?? []),
        ...(servicePrincipal.servicePrincipalNames ?? []),
      ]
        .filter(Boolean)
        .join(" ");

      const resolvedMatch =
        resolveAIToolMatch({
          clientName: servicePrincipalHints,
          scopes: metadata?.scopes ?? [],
          publisherName:
            servicePrincipal.verifiedPublisher?.displayName ??
            servicePrincipal.publisherName ??
            null,
          domains: candidateDomains,
          appIds: [servicePrincipal.appId ?? "", servicePrincipal.id ?? ""],
          additionalText: servicePrincipal.tags ?? [],
        }) ??
        candidateDomains
          .map((domain) => {
            const tool = matchDomain(domain);
            return tool
              ? {
                  tool,
                  confidence: "medium" as const,
                  score: 7,
                  reasons: [`domain matched "${domain}"`],
                }
              : null;
          })
          .find(Boolean) ??
        null;

      if (!resolvedMatch) continue;

      const assignmentPrincipals = new Set(
        appRoleAssignments
          .map((assignment) => assignment.principalId)
          .filter(Boolean)
      );
      const observedUsers = Math.max(
        metadata?.principals.size ?? 0,
        assignmentPrincipals.size
      );
      const userCount =
        observedUsers ||
        (metadata?.consentType === "AllPrincipals" ? 3 : 1);

      discoveries.push({
        toolName: resolvedMatch.tool.toolName,
        vendor: resolvedMatch.tool.vendor,
        domain: candidateDomains[0] ?? resolvedMatch.tool.domains[0],
        userEmails: [],
        userCount,
        matchConfidence: resolvedMatch.confidence,
        matchScore: resolvedMatch.score,
        matchReasons: resolvedMatch.reasons,
        notes: summarizeDiscoverySignals({
          consentType: metadata?.consentType ?? null,
          principalCount: metadata?.principals.size ?? 0,
          scopeCount: metadata?.scopes.length ?? 0,
          assignmentCount: assignmentPrincipals.size,
          matchReasons: resolvedMatch.reasons,
          confidence: resolvedMatch.confidence,
        }),
      });
    } catch {
      // Skip individual service principals that fail lookup or are unavailable.
    }
  }

  const deduped = new Map<string, ScanDiscovery>();
  for (const discovery of discoveries) {
    const key = `${discovery.toolName}::${discovery.domain}`;
    const existing = deduped.get(key);
    if (existing) {
      existing.userCount = Math.max(existing.userCount, discovery.userCount);
      if (discovery.notes && !existing.notes?.includes(discovery.notes)) {
        existing.notes = existing.notes
          ? `${existing.notes}\n${discovery.notes}`
          : discovery.notes;
      }
      continue;
    }
    deduped.set(key, discovery);
  }

  return {
    discoveries: Array.from(deduped.values()),
    totalEventsScanned: grants.length,
    aiToolsFound: deduped.size,
  };
}
