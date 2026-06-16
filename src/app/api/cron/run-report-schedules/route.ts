import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateReport } from "@/lib/reports/generate";
import { computeNextRun, type Frequency } from "@/lib/reports/schedule";
import { reportEmailHtml, sendReportEmail } from "@/lib/reports/email";
import { MAX_STORED_ARTIFACT_BYTES } from "@/lib/reports/access";
import type { ReportConfig, ReportDataSourceKey, ReportFormatKey } from "@/lib/reports/types";
import { bearerTokenMatches } from "@/lib/secret-compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/run-report-schedules — invoked by Vercel Cron (every 15 min).
// Runs every enabled schedule whose nextRunAt has passed: generates the
// report, stores a ReportRun, emails recipients (if Resend is configured),
// and advances nextRunAt. Failures are recorded as FAILED runs + an alert.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !bearerTokenMatches(authHeader, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const due = await prisma.reportSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    include: { definition: true },
    take: 25, // bound work per tick; the next tick picks up the rest
  });

  const results: Array<{ scheduleId: string; status: string; detail?: string }> = [];

  for (const schedule of due) {
    const def = schedule.definition;
    const format = schedule.format as ReportFormatKey;
    try {
      const generated = await generateReport(
        {
          name: def.name,
          description: def.description,
          dataSource: def.dataSource as ReportDataSourceKey,
          config: def.config as unknown as ReportConfig,
        },
        format,
        { generatedBy: "Scheduled run" }
      );

      let deliveredTo: string[] = [];
      let emailDetail = "no recipients";
      if (schedule.recipients.length > 0) {
        const email = await sendReportEmail({
          to: schedule.recipients,
          subject: `[UrNammu] ${def.name}`,
          html: reportEmailHtml({
            name: def.name,
            description: def.description,
            rowCount: generated.rowCount,
          }),
          attachment: {
            filename: generated.filename,
            content: generated.buffer,
            contentType: generated.contentType,
          },
        });
        if (email.delivered) {
          deliveredTo = email.to;
          emailDetail = `emailed ${email.to.length}`;
        } else if (email.skipped) {
          emailDetail = `email skipped: ${email.reason}`;
        } else {
          emailDetail = `email error: ${email.error}`;
        }
      }

      await prisma.reportRun.create({
        data: {
          definitionId: def.id,
          scheduleId: schedule.id,
          format,
          status: "SUCCESS",
          rowCount: generated.rowCount,
          filename: generated.filename,
          contentType: generated.contentType,
          content:
            generated.buffer.byteLength <= MAX_STORED_ARTIFACT_BYTES
              ? new Uint8Array(generated.buffer)
              : null,
          deliveredTo,
        },
      });

      const nextRunAt = computeNextRun(
        schedule.frequency as Frequency,
        schedule.hourUtc,
        schedule.dayOfWeek,
        schedule.dayOfMonth,
        now
      );
      await prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now, nextRunAt },
      });

      results.push({ scheduleId: schedule.id, status: "success", detail: emailDetail });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Report generation failed";
      await prisma.reportRun.create({
        data: {
          definitionId: def.id,
          scheduleId: schedule.id,
          format,
          status: "FAILED",
          error: message,
        },
      });
      // Advance nextRunAt so a persistently-failing schedule doesn't run every tick.
      const nextRunAt = computeNextRun(
        schedule.frequency as Frequency,
        schedule.hourUtc,
        schedule.dayOfWeek,
        schedule.dayOfMonth,
        now
      );
      await prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now, nextRunAt },
      });
      await prisma.alert.create({
        data: {
          title: `Scheduled report failed: ${def.name}`,
          description: message,
          severity: "MEDIUM",
          status: "OPEN",
          source: "report_scheduler",
        },
      });
      results.push({ scheduleId: schedule.id, status: "failed", detail: message });
    }
  }

  return NextResponse.json({ processed: due.length, results });
}
