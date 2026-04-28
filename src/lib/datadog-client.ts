import { getSetting } from "./settings";
import {
  DATADOG_DEFAULT_SITE,
  DATADOG_SETTINGS_KEYS,
  DATADOG_SUPPORTED_SITES,
  type DatadogSite,
} from "./settings";

export type DatadogAlertType = "error" | "warning" | "info" | "success";

export interface DatadogEvent {
  title: string;
  text: string;
  tags?: string[];
  alertType?: DatadogAlertType;
  timestamp?: Date;
  aggregationKey?: string;
  sourceTypeName?: string;
}

export function resolveDatadogSite(raw: string | null | undefined): DatadogSite {
  if (!raw) return DATADOG_DEFAULT_SITE;
  return DATADOG_SUPPORTED_SITES.includes(raw as DatadogSite)
    ? (raw as DatadogSite)
    : DATADOG_DEFAULT_SITE;
}

export function datadogEventsUrl(site: DatadogSite): string {
  // Datadog uses `api.<site>` for US1/EU/etc. and `api.us3.datadoghq.com`, etc.
  // for regional sites. The formula is consistent: `https://api.${site}`.
  return `https://api.${site}/api/v1/events`;
}

export async function isDatadogEnabled(): Promise<boolean> {
  const [apiKey, enabled] = await Promise.all([
    getSetting(DATADOG_SETTINGS_KEYS.API_KEY),
    getSetting(DATADOG_SETTINGS_KEYS.ENABLED),
  ]);
  return !!apiKey && enabled === "true";
}

export async function isDatadogConfigured(): Promise<boolean> {
  return !!(await getSetting(DATADOG_SETTINGS_KEYS.API_KEY));
}

async function getCredentials(): Promise<{ apiKey: string; site: DatadogSite }> {
  const [apiKey, rawSite] = await Promise.all([
    getSetting(DATADOG_SETTINGS_KEYS.API_KEY),
    getSetting(DATADOG_SETTINGS_KEYS.SITE),
  ]);
  if (!apiKey) {
    throw new Error("Datadog API key not configured. Add it in Settings > Integrations.");
  }
  return { apiKey, site: resolveDatadogSite(rawSite) };
}

export async function sendDatadogEvent(event: DatadogEvent): Promise<void> {
  const { apiKey, site } = await getCredentials();
  const body = {
    title: event.title,
    text: event.text,
    tags: event.tags ?? [],
    alert_type: event.alertType ?? "info",
    date_happened: event.timestamp ? Math.floor(event.timestamp.getTime() / 1000) : undefined,
    aggregation_key: event.aggregationKey,
    source_type_name: event.sourceTypeName ?? "urnammu",
  };

  const res = await fetch(datadogEventsUrl(site), {
    method: "POST",
    headers: {
      "DD-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Datadog API error (${res.status}): ${text || res.statusText}`);
  }
}

/**
 * Fire-and-forget variant that never throws, gated on isDatadogEnabled().
 * Use this from hot paths (alert creation, sync completion) where we don't
 * want a Datadog outage to break governance workflows.
 */
export async function notifyDatadog(event: DatadogEvent): Promise<{ forwarded: boolean; error?: string }> {
  try {
    if (!(await isDatadogEnabled())) {
      return { forwarded: false };
    }
    await sendDatadogEvent(event);
    return { forwarded: true };
  } catch (err) {
    return {
      forwarded: false,
      error: err instanceof Error ? err.message : "Unknown Datadog forwarding error",
    };
  }
}

export async function testDatadog(): Promise<{ success: boolean; message: string }> {
  try {
    await sendDatadogEvent({
      title: "UrNammu test event",
      text: "This is a test event from UrNammu AI governance platform. If you can see this, your Datadog integration is working.",
      tags: ["source:urnammu", "env:test"],
      alertType: "info",
    });
    return { success: true, message: "Test event delivered to Datadog." };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Connection failed",
    };
  }
}
