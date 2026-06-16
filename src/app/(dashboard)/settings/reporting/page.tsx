import { requireRole } from "@/lib/auth-guard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ReportingEmailSettings } from "@/components/settings/reporting-email-settings";
import { getSettings, REPORT_SETTINGS_KEYS } from "@/lib/settings";

export default async function ReportingSettingsPage() {
  await requireRole(["ADMIN"]);

  const settings = await getSettings([
    REPORT_SETTINGS_KEYS.RESEND_API_KEY,
    REPORT_SETTINGS_KEYS.EMAIL_FROM,
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Report Email Delivery</CardTitle>
        <CardDescription>
          Optional Resend configuration for emailing scheduled reports to recipients.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ReportingEmailSettings
          initial={{
            emailFrom: settings[REPORT_SETTINGS_KEYS.EMAIL_FROM] ?? "",
            hasApiKey: Boolean(settings[REPORT_SETTINGS_KEYS.RESEND_API_KEY]),
          }}
        />
      </CardContent>
    </Card>
  );
}
