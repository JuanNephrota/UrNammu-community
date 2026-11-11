import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth-guard";
import {
  EXTENSION_CLIENTS,
  EXTENSION_KINDS,
  loadAssistantExtensionInventory,
  type ExtensionClient,
  type ExtensionKind,
} from "@/lib/assistant-extensions";

export const dynamic = "force-dynamic";

/**
 * GET /api/assistant-extensions
 *   ?client=claude_code|cursor  ?kind=plugin|mcp_server|skill|hook|agent
 *   ?q=<text>  ?redacted=1  ?limit=<n>
 *
 * The per-person inventory of coding-assistant extensions as seen in OTel
 * telemetry. Identifiers and provenance only.
 */
export async function GET(req: NextRequest) {
  return withAuth(async () => {
    const params = req.nextUrl.searchParams;
    const client = params.get("client");
    const kind = params.get("kind");
    const inventory = await loadAssistantExtensionInventory({
      client: client && EXTENSION_CLIENTS.includes(client as ExtensionClient) ? (client as ExtensionClient) : null,
      kind: kind && EXTENSION_KINDS.includes(kind as ExtensionKind) ? (kind as ExtensionKind) : null,
      q: params.get("q"),
      redactedOnly: params.get("redacted") === "1",
      limit: Number(params.get("limit")) || undefined,
    });
    return NextResponse.json(inventory);
  });
}
