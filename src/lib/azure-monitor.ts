/**
 * Azure Monitor access for the /proxy-health live-ops board.
 *
 * Reads standard platform metrics from the nammu-ai-proxy Function App
 * (FunctionExecutionCount, Http2xx/4xx/5xx, AverageResponseTime) over a
 * short window. Uses the regional metrics endpoint
 * (`https://{region}.metrics.monitor.azure.com`) via `@azure/monitor-query-metrics`.
 *
 * Auth uses either an explicit service-principal (when all three SP fields
 * are set in AppSettings) or the `DefaultAzureCredential` chain — Azure CLI
 * locally, managed identity in Azure. Vercel deploys should populate the SP
 * fields; the CLI path doesn't work in a serverless runtime.
 */

import {
  MetricsClient,
  type MetricsQueryResult,
} from "@azure/monitor-query-metrics";
import { DefaultAzureCredential, ClientSecretCredential } from "@azure/identity";
import type { TokenCredential } from "@azure/core-auth";
import { getSetting, AZURE_MONITOR_SETTINGS_KEYS } from "./settings";

const METRIC_NAMESPACE = "Microsoft.Web/sites";

const METRIC_NAMES = [
  "FunctionExecutionCount",
  "Http2xx",
  "Http4xx",
  "Http5xx",
  "AverageResponseTime",
] as const;

export type ProxyHealthWindow = {
  windowStart: Date;
  windowEnd: Date;
  invocationCount: number | null;
  http2xxCount: number | null;
  http4xxCount: number | null;
  http5xxCount: number | null;
  avgResponseTimeMs: number | null;
  rawMetrics: unknown;
};

export type ProxyHealthConfig = {
  subscriptionId: string;
  resourceGroup: string;
  functionAppName: string;
  region: string;
};

export async function loadProxyHealthConfig(): Promise<ProxyHealthConfig | null> {
  const [subscriptionId, resourceGroup, functionAppName, region] = await Promise.all([
    getSetting(AZURE_MONITOR_SETTINGS_KEYS.SUBSCRIPTION_ID),
    getSetting(AZURE_MONITOR_SETTINGS_KEYS.RESOURCE_GROUP),
    getSetting(AZURE_MONITOR_SETTINGS_KEYS.FUNCTION_APP_NAME),
    getSetting(AZURE_MONITOR_SETTINGS_KEYS.REGION),
  ]);

  if (!subscriptionId || !resourceGroup || !functionAppName) return null;
  return {
    subscriptionId,
    resourceGroup,
    functionAppName,
    region: region?.trim() || "eastus",
  };
}

async function buildCredential(): Promise<TokenCredential> {
  const [tenantId, clientId, clientSecret] = await Promise.all([
    getSetting(AZURE_MONITOR_SETTINGS_KEYS.TENANT_ID),
    getSetting(AZURE_MONITOR_SETTINGS_KEYS.CLIENT_ID),
    getSetting(AZURE_MONITOR_SETTINGS_KEYS.CLIENT_SECRET),
  ]);

  if (tenantId && clientId && clientSecret) {
    return new ClientSecretCredential(tenantId, clientId, clientSecret);
  }
  return new DefaultAzureCredential();
}

function resourceId({ subscriptionId, resourceGroup, functionAppName }: ProxyHealthConfig): string {
  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${functionAppName}`;
}

function endpoint(region: string): string {
  // Azure Monitor regional endpoint for the multi-resource metrics API.
  const normalized = region.toLowerCase().replace(/\s+/g, "");
  return `https://${normalized}.metrics.monitor.azure.com`;
}

/**
 * Sum counter-type metrics; compute a mean for AverageResponseTime.
 */
function aggregateMetric(result: MetricsQueryResult, name: string, mode: "sum" | "avg"): number | null {
  const metric = result.metrics.find((m) => m.name === name);
  if (!metric) return null;

  const points = metric.timeseries.flatMap((ts) => ts.data ?? []);
  if (!points.length) return null;

  if (mode === "sum") {
    const totals = points
      .map((d) => d.total)
      .filter((v): v is number => typeof v === "number");
    return totals.length ? totals.reduce((a, b) => a + b, 0) : null;
  }

  const averages = points
    .map((d) => d.average)
    .filter((v): v is number => typeof v === "number");
  return averages.length ? averages.reduce((a, b) => a + b, 0) / averages.length : null;
}

export async function fetchProxyHealth(
  config: ProxyHealthConfig,
  windowMinutes = 15
): Promise<ProxyHealthWindow> {
  const credential = await buildCredential();
  const client = new MetricsClient(endpoint(config.region), credential);

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowMinutes * 60 * 1000);

  const results = await client.queryResources(
    [resourceId(config)],
    [...METRIC_NAMES],
    METRIC_NAMESPACE,
    {
      startTime: windowStart,
      endTime: windowEnd,
      interval: "PT1M",
    }
  );

  const result = results[0];
  if (!result) {
    return {
      windowStart,
      windowEnd,
      invocationCount: null,
      http2xxCount: null,
      http4xxCount: null,
      http5xxCount: null,
      avgResponseTimeMs: null,
      rawMetrics: { empty: true },
    };
  }

  const avgSeconds = aggregateMetric(result, "AverageResponseTime", "avg");

  return {
    windowStart,
    windowEnd,
    invocationCount: aggregateMetric(result, "FunctionExecutionCount", "sum"),
    http2xxCount: aggregateMetric(result, "Http2xx", "sum"),
    http4xxCount: aggregateMetric(result, "Http4xx", "sum"),
    http5xxCount: aggregateMetric(result, "Http5xx", "sum"),
    avgResponseTimeMs: avgSeconds != null ? avgSeconds * 1000 : null,
    rawMetrics: JSON.parse(JSON.stringify(result)),
  };
}
