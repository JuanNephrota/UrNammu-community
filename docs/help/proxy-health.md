# Proxy Health

Live-ops board for the AI proxy. Use it to answer "is the proxy up and writing?" before investigating a gap in Oversight data.

## Heartbeat tiles

These refresh every 15 seconds and are computed from what the proxy has actually written to the database:

- **Heartbeat Age** — how long since the most recent usage log was written. This is the single most useful field on the page: if it is minutes old under normal traffic, the proxy is not reaching the database.
- **Proxy Writes** — usage-log rows written in the current window.
- **Flagged** — of those, how many tripped prompt-risk detection.
- **Policy Denials** — denials recorded in the same window.
- **Window** — the interval the tiles are summarizing.

A genuinely quiet period looks identical to an outage on these tiles. Confirm against expected traffic before escalating.

## Azure Monitor metrics

Optional, and refreshed with the **Sync now** button rather than on the 15-second poll. When an Azure Monitor connection is configured, the board pulls the function app's own platform metrics — **Invocations**, **Error Rate**, **Avg Response**, and a 2xx / 4xx / 5xx breakdown — over the last hour.

This is the half of the picture the heartbeat tiles cannot see: invocations that failed **before** writing anything. Invocations arriving but no proxy writes landing usually means a database or credential problem inside the proxy; no invocations at all points upstream, at routing or client configuration.

## Recent proxy writes

The ten most recent usage logs, with **Time**, **Status**, **User**, **Dept**, **Tokens**, and **Cost**. Rows are labeled **Flagged** or **Blocked** where they apply, and failures are distinguished as **Proxy error** or **Upstream error** — the former is yours to fix, the latter is the provider's.

Use this table to confirm attribution headers are populated. Rows with no user or department mean `x-user-email` and `x-department` are not being sent; configure them in **Settings → Proxy Setup**.

## Sync errors

If the last Azure Monitor sync failed, the metrics card reports **Last sync failed**; a connection that has never run shows **Never synced**. Neither affects proxy operation or logging — they only mean this board cannot show platform metrics right now.

## When configuration is missing

Azure Monitor requires a subscription ID, resource group, and function app name. Without all three the metrics card reports that it is unconfigured, and the heartbeat tiles keep working on their own.
