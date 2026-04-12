import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-guard";
import { ingestDiscoveredToolEntries, parseEntriesFromCsv } from "@/lib/discovered-tools-ingest";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["ADMIN", "COMPLIANCE_OFFICER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const source = String(formData.get("source") ?? "dns_proxy");
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "CSV file is required" }, { status: 400 });
  }

  const text = await file.text();
  const entries = parseEntriesFromCsv(text, source);
  if (entries.length === 0) {
    return NextResponse.json({ error: "No valid entries found in file" }, { status: 400 });
  }

  const result = await ingestDiscoveredToolEntries({
    source,
    entries,
    inputType: "csv",
    fileName: file.name,
    triggeredByUserId: session.user.userId,
  });

  return NextResponse.json(result);
}
