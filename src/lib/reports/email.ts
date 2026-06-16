import { getSettings, REPORT_SETTINGS_KEYS } from "@/lib/settings";

export interface ReportEmailParams {
  to: string[];
  subject: string;
  html: string;
  attachment: { filename: string; content: Buffer; contentType: string };
}

export type ReportEmailResult =
  | { delivered: true; to: string[] }
  | { delivered: false; skipped: true; reason: string }
  | { delivered: false; skipped: false; error: string };

/**
 * Send a report by email via the Resend REST API (no SDK dependency).
 * If Resend is not configured (no API key / from-address), this is a no-op
 * that returns `skipped` — scheduled runs still succeed and stay downloadable
 * from the in-app run history.
 */
export async function sendReportEmail(
  params: ReportEmailParams
): Promise<ReportEmailResult> {
  const settings = await getSettings([
    REPORT_SETTINGS_KEYS.RESEND_API_KEY,
    REPORT_SETTINGS_KEYS.EMAIL_FROM,
  ]);
  const apiKey = settings[REPORT_SETTINGS_KEYS.RESEND_API_KEY];
  const from = settings[REPORT_SETTINGS_KEYS.EMAIL_FROM];

  if (!apiKey || !from) {
    return {
      delivered: false,
      skipped: true,
      reason: "Resend not configured (set resend_api_key and report_email_from in Settings)",
    };
  }
  const recipients = params.to.filter((r) => r.includes("@"));
  if (recipients.length === 0) {
    return { delivered: false, skipped: true, reason: "No valid recipients" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: params.subject,
        html: params.html,
        attachments: [
          {
            filename: params.attachment.filename,
            content: params.attachment.content.toString("base64"),
            content_type: params.attachment.contentType,
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        delivered: false,
        skipped: false,
        error: `Resend responded ${res.status}: ${detail.slice(0, 200)}`,
      };
    }
    return { delivered: true, to: recipients };
  } catch (err) {
    return {
      delivered: false,
      skipped: false,
      error: err instanceof Error ? err.message : "Unknown email error",
    };
  }
}

export function reportEmailHtml(opts: {
  name: string;
  description?: string | null;
  rowCount: number;
  dateRangeLabel?: string | null;
}): string {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0a0f1c;max-width:560px;margin:0 auto">
    <div style="border-bottom:2px solid #0891b2;padding-bottom:8px;margin-bottom:16px">
      <span style="font-size:16px;font-weight:700;letter-spacing:1px">URNAMMU</span>
      <div style="font-size:11px;color:#64748b">AI Governance &amp; Compliance</div>
    </div>
    <h2 style="margin:0 0 4px">${escapeHtml(opts.name)}</h2>
    ${opts.description ? `<p style="color:#64748b;margin:0 0 12px">${escapeHtml(opts.description)}</p>` : ""}
    <p style="margin:0 0 4px">Your scheduled report is attached.</p>
    <ul style="color:#475569;font-size:13px;padding-left:18px">
      <li>${opts.rowCount.toLocaleString("en-US")} rows</li>
      ${opts.dateRangeLabel ? `<li>Date range: ${escapeHtml(opts.dateRangeLabel)}</li>` : ""}
      <li>Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</li>
    </ul>
    <p style="color:#94a3b8;font-size:11px;margin-top:24px">Sent automatically by UrNammu. Manage this schedule in the Reports section.</p>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
  );
}
