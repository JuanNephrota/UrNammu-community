import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  ENDPOINT_MAX_OBSERVATIONS,
  authenticateDevice,
  ingestEndpointReport,
} from "@/lib/endpoint-agent";
import {
  countReportObservations,
  endpointReportSchema,
} from "@/lib/validations/endpoint-agent";
import { logger } from "@/lib/observability";

// A device that has been offline for a while flushes a spooled backlog on
// reconnect, and the report walks the registry per observation.
export const maxDuration = 60;

/**
 * POST /api/endpoint-agent/report
 *
 * One collection cycle from one enrolled device. Device-authenticated with the
 * token issued at enrollment.
 */
export async function POST(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const device = await authenticateDevice(token);
  if (!device) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let payload;
  try {
    payload = endpointReportSchema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid report payload", details: error.flatten() },
        { status: 400 },
      );
    }
    throw error;
  }

  // The token proves which device is calling; the body claims a machineId.
  // They must agree, or a leaked token could be used to write observations
  // against another machine's identity.
  if (payload.machineId !== device.machineId) {
    logger.warn("endpoint_agent.report.machine_id_mismatch", {
      deviceId: device.id,
      claimed: payload.machineId,
    });
    return NextResponse.json(
      { error: "machineId does not match the authenticated device" },
      { status: 403 },
    );
  }

  const observations = countReportObservations(payload);
  if (observations > ENDPOINT_MAX_OBSERVATIONS) {
    logger.warn("endpoint_agent.report.too_large", {
      deviceId: device.id,
      observations,
      max: ENDPOINT_MAX_OBSERVATIONS,
    });
    return NextResponse.json(
      { error: "Payload too large", observations, max: ENDPOINT_MAX_OBSERVATIONS },
      { status: 413 },
    );
  }

  try {
    const result = await ingestEndpointReport(device, payload);
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    logger.error("endpoint_agent.report.failed", {
      deviceId: device.id,
      reportId: payload.reportId,
      error: error instanceof Error ? error.message : String(error),
    });
    // 5xx so the agent keeps the batch spooled and retries.
    return NextResponse.json({ error: "Failed to ingest report" }, { status: 500 });
  }
}
