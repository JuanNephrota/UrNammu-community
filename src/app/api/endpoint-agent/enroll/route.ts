import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { bearerTokenMatches } from "@/lib/secret-compare";
import { enrollDevice, getEnrollmentSecret } from "@/lib/endpoint-agent";
import { endpointEnrollSchema } from "@/lib/validations/endpoint-agent";
import { logger } from "@/lib/observability";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

// Generous for a fleet behind one office NAT, tight enough to stop secret
// guessing and device-row flooding from a single host.
const allowEnroll = createRateLimiter(60, 60_000);

/**
 * POST /api/endpoint-agent/enroll
 *
 * Called once per machine, authenticated with the org-wide enrollment secret
 * that MDM ships alongside the binary. Returns a per-device token that the
 * agent persists and uses for everything afterwards.
 *
 * The enrollment secret is necessarily readable on every managed laptop, so it
 * is treated as a low-value credential: it can create a device row and mint a
 * token for a machine the caller names — including re-enrolling one that is
 * already live, which invalidates that device's token. That last case raises
 * an alert (see enrollDevice) rather than being refused, because a reimaged
 * laptop legitimately arrives the same way. It cannot read the fleet or
 * resurrect a revoked device. Rotate the secret in Settings → Endpoint Agent
 * if a laptop is lost.
 */
export async function POST(req: NextRequest) {
  if (!allowEnroll(clientKey(req.headers))) {
    return NextResponse.json({ error: "Too many enrollment attempts" }, { status: 429 });
  }

  const secret = await getEnrollmentSecret();
  if (!secret) {
    // Fail closed and say why: an operator who has not generated the secret
    // yet should not have to guess from a bare 401.
    return NextResponse.json(
      { error: "Endpoint agent enrollment is not configured" },
      { status: 503 },
    );
  }

  if (!bearerTokenMatches(req.headers.get("authorization"), secret)) {
    logger.warn("endpoint_agent.enroll.unauthorized", {});
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const payload = endpointEnrollSchema.parse(raw);
    const result = await enrollDevice(payload);

    if ("revoked" in result) {
      // 403, not 401: the credential was good, the device is not welcome.
      // The agent treats this as terminal and stops rather than retrying.
      return NextResponse.json(
        { error: "This device has been revoked", revoked: true },
        { status: 403 },
      );
    }

    return NextResponse.json(
      {
        deviceId: result.device.id,
        token: result.token,
        reEnrolled: result.reEnrolled,
      },
      { status: result.reEnrolled ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid enrollment payload", details: error.flatten() },
        { status: 400 },
      );
    }
    logger.error("endpoint_agent.enroll.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Enrollment failed" }, { status: 500 });
  }
}
