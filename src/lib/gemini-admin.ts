import { JWT } from "google-auth-library";
import { getSetting } from "./settings";

const BIGQUERY_BASE_URL = "https://bigquery.googleapis.com/bigquery/v2";

export const GEMINI_OVERSIGHT_SETTINGS = {
  SERVICE_ACCOUNT_KEY: "gemini_billing_service_account_key",
  PROJECT_ID: "gemini_billing_project_id",
  DATASET: "gemini_billing_dataset",
  TABLE: "gemini_billing_table",
  LOCATION: "gemini_billing_location",
} as const;

type GeminiBillingConfig = {
  serviceAccountKey: string;
  projectId: string;
  dataset: string;
  table: string;
  location: string;
};

type BigQueryQueryResponse = {
  jobComplete?: boolean;
  rows?: Array<{ f?: Array<{ v?: unknown }> }>;
  schema?: {
    fields?: Array<{ name?: string }>;
  };
};

type GeminiBillingRow = {
  usage_date: string;
  project_id: string | null;
  project_name: string | null;
  service_description: string | null;
  sku_description: string | null;
  total_cost: number;
  usage_amount: number;
  usage_unit: string | null;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function getConfig(): Promise<GeminiBillingConfig> {
  const [
    serviceAccountKey,
    projectId,
    dataset,
    table,
    location,
  ] = await Promise.all([
    getSetting(GEMINI_OVERSIGHT_SETTINGS.SERVICE_ACCOUNT_KEY),
    getSetting(GEMINI_OVERSIGHT_SETTINGS.PROJECT_ID),
    getSetting(GEMINI_OVERSIGHT_SETTINGS.DATASET),
    getSetting(GEMINI_OVERSIGHT_SETTINGS.TABLE),
    getSetting(GEMINI_OVERSIGHT_SETTINGS.LOCATION),
  ]);

  const config = {
    serviceAccountKey:
      serviceAccountKey ?? process.env.GEMINI_BILLING_SERVICE_ACCOUNT_KEY ?? "",
    projectId: projectId ?? process.env.GEMINI_BILLING_PROJECT_ID ?? "",
    dataset: dataset ?? process.env.GEMINI_BILLING_DATASET ?? "",
    table: table ?? process.env.GEMINI_BILLING_TABLE ?? "",
    location: location ?? process.env.GEMINI_BILLING_LOCATION ?? "US",
  };

  if (
    !config.serviceAccountKey ||
    !config.projectId ||
    !config.dataset ||
    !config.table
  ) {
    throw new Error(
      "Google Gemini billing export is not configured. Add the service account, project, dataset, and table in Settings > Provider Admin APIs."
    );
  }

  return config;
}

function parseServiceAccountKey(raw: string) {
  try {
    const parsed = raw.trim().startsWith("{")
      ? JSON.parse(raw)
      : JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));

    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("Missing client_email or private_key.");
    }

    return parsed as { client_email: string; private_key: string };
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Invalid Google service account key: ${error.message}`
        : "Invalid Google service account key."
    );
  }
}

async function getBigQueryAccessToken(): Promise<{
  accessToken: string;
  config: GeminiBillingConfig;
}> {
  const config = await getConfig();
  const key = parseServiceAccountKey(config.serviceAccountKey);
  const authClient = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [
      "https://www.googleapis.com/auth/bigquery",
      "https://www.googleapis.com/auth/cloud-platform.read-only",
    ],
  });

  const tokenResponse = await authClient.getAccessToken();
  const accessToken =
    typeof tokenResponse === "string"
      ? tokenResponse
      : tokenResponse?.token ?? null;

  if (!accessToken) {
    throw new Error("Failed to obtain Google Cloud access token.");
  }

  return { accessToken, config };
}

async function runBigQueryQuery<T>(
  query: string,
  queryParameters: Array<{
    name: string;
    parameterType: { type: string };
    parameterValue: { value: string };
  }> = []
): Promise<T[]> {
  const { accessToken, config } = await getBigQueryAccessToken();
  const response = await fetch(
    `${BIGQUERY_BASE_URL}/projects/${encodeURIComponent(config.projectId)}/queries`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        useLegacySql: false,
        location: config.location,
        parameterMode: queryParameters.length > 0 ? "NAMED" : undefined,
        queryParameters,
      }),
    }
  );

  const payload = (await response.json().catch(() => null)) as
    | BigQueryQueryResponse
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    const message =
      payload && "error" in payload
        ? payload.error?.message
        : response.statusText;
    throw new Error(`BigQuery API error (${response.status}): ${message ?? "Unknown error"}`);
  }

  const result = payload as BigQueryQueryResponse;
  const fieldNames =
    result.schema?.fields?.map((field) => field.name ?? "") ?? [];
  const rows = result.rows ?? [];

  return rows.map((row) => {
    const values = row.f ?? [];
    return fieldNames.reduce<Record<string, unknown>>((acc, fieldName, index) => {
      acc[fieldName] = values[index]?.v ?? null;
      return acc;
    }, {}) as T;
  });
}

function getBillingTableReference(config: GeminiBillingConfig) {
  return `\`${config.projectId}.${config.dataset}.${config.table}\``;
}

function getGeminiUsageQuery(config: GeminiBillingConfig) {
  return `
    SELECT
      CAST(DATE(usage_start_time) AS STRING) AS usage_date,
      CAST(project.id AS STRING) AS project_id,
      ANY_VALUE(project.name) AS project_name,
      ANY_VALUE(service.description) AS service_description,
      ANY_VALUE(sku.description) AS sku_description,
      ROUND(SUM(cost), 6) AS total_cost,
      SUM(COALESCE(usage.amount, 0)) AS usage_amount,
      ANY_VALUE(usage.unit) AS usage_unit
    FROM ${getBillingTableReference(config)}
    WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL CAST(@lookback_days AS INT64) DAY)
      AND (
        LOWER(COALESCE(service.description, '')) LIKE '%vertex ai%'
        OR LOWER(COALESCE(service.description, '')) LIKE '%gemini%'
        OR LOWER(COALESCE(sku.description, '')) LIKE '%gemini%'
        OR LOWER(COALESCE(sku.description, '')) LIKE '%generative ai%'
      )
    GROUP BY usage_date, project_id, sku_description
    ORDER BY usage_date DESC, total_cost DESC
    LIMIT 5000
  `;
}

function normalizeBillingRow(row: Record<string, unknown>): GeminiBillingRow {
  return {
    usage_date: asString(row.usage_date) ?? new Date().toISOString().slice(0, 10),
    project_id: asString(row.project_id),
    project_name: asString(row.project_name),
    service_description: asString(row.service_description),
    sku_description: asString(row.sku_description),
    total_cost: asNumber(row.total_cost),
    usage_amount: asNumber(row.usage_amount),
    usage_unit: asString(row.usage_unit),
  };
}

function maybeExtractGeminiModel(skuDescription: string | null): string | null {
  if (!skuDescription) return null;
  const normalized = skuDescription.toLowerCase();
  const explicitMatch = normalized.match(/gemini[\w.\- ]+/);
  if (explicitMatch?.[0]) return explicitMatch[0].trim();
  if (normalized.includes("gemini")) return skuDescription;
  if (normalized.includes("vertex ai")) return "gemini";
  return null;
}

export async function isGeminiBillingConfigured(): Promise<boolean> {
  try {
    await getConfig();
    return true;
  } catch {
    return false;
  }
}

export async function getGeminiBillingOverview() {
  const config = await getConfig();
  const rows = (
    await runBigQueryQuery<Record<string, unknown>>(getGeminiUsageQuery(config), [
      {
        name: "lookback_days",
        parameterType: { type: "INT64" },
        parameterValue: { value: "30" },
      },
    ])
  ).map(normalizeBillingRow);

  const bySku = new Map<string, { label: string; cost: number; usageAmount: number }>();
  const byProject = new Map<string, { label: string; cost: number; usageAmount: number }>();

  for (const row of rows) {
    const skuLabel = row.sku_description ?? "Gemini / Vertex AI";
    const projectLabel = row.project_name ?? row.project_id ?? "Unattributed Google Cloud project";

    const sku = bySku.get(skuLabel) ?? { label: skuLabel, cost: 0, usageAmount: 0 };
    sku.cost += row.total_cost;
    sku.usageAmount += row.usage_amount;
    bySku.set(skuLabel, sku);

    const project = byProject.get(projectLabel) ?? {
      label: projectLabel,
      cost: 0,
      usageAmount: 0,
    };
    project.cost += row.total_cost;
    project.usageAmount += row.usage_amount;
    byProject.set(projectLabel, project);
  }

  const totalCost = rows.reduce((sum, row) => sum + row.total_cost, 0);

  return {
    totalCost,
    rowCount: rows.length,
    topSkus: [...bySku.values()].sort((a, b) => b.cost - a.cost).slice(0, 6),
    topProjects: [...byProject.values()].sort((a, b) => b.cost - a.cost).slice(0, 6),
  };
}

export async function getGeminiBillingRows(lookbackDays: number) {
  const config = await getConfig();
  const rows = await runBigQueryQuery<Record<string, unknown>>(getGeminiUsageQuery(config), [
    {
      name: "lookback_days",
      parameterType: { type: "INT64" },
      parameterValue: { value: String(lookbackDays) },
    },
  ]);

  return rows.map(normalizeBillingRow);
}

export async function testGeminiBilling(): Promise<{ success: boolean; message: string }> {
  try {
    const config = await getConfig();
    await runBigQueryQuery<Record<string, unknown>>(
      `SELECT COUNT(1) AS row_count FROM ${getBillingTableReference(config)} LIMIT 1`
    );

    return {
      success: true,
      message: "Connected to Google Cloud Billing export successfully.",
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

export function getGeminiUsageMetadata(row: GeminiBillingRow) {
  const usageUnit = row.usage_unit?.toLowerCase() ?? null;
  const requestCount =
    usageUnit && (usageUnit.includes("request") || usageUnit.includes("count"))
      ? Math.max(0, Math.round(row.usage_amount))
      : null;

  return {
    model: maybeExtractGeminiModel(row.sku_description),
    requestCount,
    metadata: {
      serviceDescription: row.service_description,
      skuDescription: row.sku_description,
      usageAmount: row.usage_amount,
      usageUnit: row.usage_unit,
    },
  };
}
