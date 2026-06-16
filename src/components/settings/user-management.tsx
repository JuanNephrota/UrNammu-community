"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  ExternalLink,
  Globe,
  Loader2,
  LockKeyhole,
  Mail,
  Plus,
  Shield,
  ShieldCheck,
  UserCog,
  FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ManagedUser = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  department: string | null;
  createdAt: string | Date;
  hasLocalPassword: boolean;
  authProviders: string[];
};

export function UserManagement({
  initialUsers,
  localAuthEnabled,
  devLoginEnabled,
  microsoftEnabled,
  googleEnabled,
  authSettings,
  platformUrl,
}: {
  initialUsers: ManagedUser[];
  localAuthEnabled: boolean;
  devLoginEnabled: boolean;
  microsoftEnabled: boolean;
  googleEnabled: boolean;
  authSettings: {
    enableLocalAuth: string;
    enableDevLogin: string;
    googleClientId: string;
    microsoftClientId: string;
    microsoftTenantId: string;
  };
  platformUrl: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [creating, setCreating] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [testingGoogleAuth, setTestingGoogleAuth] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "VIEWER",
    department: "",
    password: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [identityMessage, setIdentityMessage] = useState<string | null>(null);
  const [googleAuthTestResult, setGoogleAuthTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [identityConfig, setIdentityConfig] = useState({
    enableLocalAuth: authSettings.enableLocalAuth || (localAuthEnabled ? "true" : "false"),
    enableDevLogin: authSettings.enableDevLogin || (devLoginEnabled ? "true" : "false"),
    googleClientId: authSettings.googleClientId,
    googleClientSecret: "",
    microsoftClientId: authSettings.microsoftClientId,
    microsoftClientSecret: "",
    microsoftTenantId: authSettings.microsoftTenantId,
  });
  const normalizedPlatformUrl = platformUrl.replace(/\/$/, "");
  const googleCallbackUrl = `${normalizedPlatformUrl}/api/auth/callback/google`;
  const googleClientId = identityConfig.googleClientId.trim();
  const googleClientSecret = identityConfig.googleClientSecret.trim();
  const googleClientIdLooksValid =
    !googleClientId || googleClientId.endsWith(".apps.googleusercontent.com");
  const googleSaveBlocked =
    (!!googleClientId && !googleClientIdLooksValid) ||
    (!googleEnabled && !!googleClientId && !googleClientSecret);
  const googleValidationMessages = [
    ...(!googleClientIdLooksValid
      ? ["Google client IDs usually end with .apps.googleusercontent.com."]
      : []),
    ...(!googleEnabled && googleClientId && !googleClientSecret
      ? ["Add a Google OAuth client secret before saving a new Google sign-in configuration."]
      : []),
  ];
  const googleReadinessChecks = [
    { label: "Client ID", ok: !!googleClientId },
    { label: "Client secret", ok: googleEnabled || !!googleClientSecret },
    { label: "Redirect URI reviewed", ok: !!googleClientId && googleClientIdLooksValid },
  ];

  async function createUser() {
    setCreating(true);
    setMessage(null);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Failed to create user");

      setUsers((current) => [payload, ...current]);
      setForm({
        name: "",
        email: "",
        role: "VIEWER",
        department: "",
        password: "",
      });
      setMessage("Local user created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  }

  async function updateUser(
    userId: string,
    updates: { name?: string; role?: string; department?: string | null; password?: string | null }
  ) {
    setSavingUserId(userId);
    setMessage(null);

    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Failed to update user");

      setUsers((current) => current.map((user) => (user.id === userId ? payload : user)));
      setMessage("User updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update user");
    } finally {
      setSavingUserId(null);
    }
  }

  async function saveIdentitySettings() {
    setSavingIdentity(true);
    setIdentityMessage(null);
    setGoogleAuthTestResult(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enable_local_auth: identityConfig.enableLocalAuth,
          enable_dev_login: identityConfig.enableDevLogin,
          google_oauth_client_id: identityConfig.googleClientId || null,
          google_oauth_client_secret: identityConfig.googleClientSecret || null,
          microsoft_client_id: identityConfig.microsoftClientId || null,
          microsoft_client_secret: identityConfig.microsoftClientSecret || null,
          microsoft_tenant_id: identityConfig.microsoftTenantId || null,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Failed to save identity settings");

      setIdentityConfig((current) => ({
        ...current,
        googleClientSecret: "",
        microsoftClientSecret: "",
      }));
      setIdentityMessage("Identity settings saved.");
    } catch (error) {
      setIdentityMessage(error instanceof Error ? error.message : "Failed to save identity settings");
    } finally {
      setSavingIdentity(false);
    }
  }

  async function testGoogleAuthSettings() {
    setTestingGoogleAuth(true);
    setGoogleAuthTestResult(null);
    try {
      const res = await fetch("/api/settings/test-google-auth", { method: "POST" });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Failed to test Google sign-in settings");
      setGoogleAuthTestResult({
        success: payload.success,
        message: payload.success ? payload.message : payload.error,
      });
    } catch (error) {
      setGoogleAuthTestResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to test Google sign-in settings",
      });
    } finally {
      setTestingGoogleAuth(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LockKeyhole className="h-4 w-4 text-[var(--accent)]" />
              Local Accounts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant={localAuthEnabled ? "success" : "warning"}>
                {localAuthEnabled ? "Enabled" : "Disabled"}
              </Badge>
              <span className="text-sm text-[var(--text-secondary)]">
                Password-backed accounts are stored in the app database.
              </span>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              Password-backed accounts are useful for self-hosted installs, demos, and teams
              that want a simple local directory before wiring up SSO.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-[var(--accent)]" />
              Microsoft 365 / Entra ID
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant={microsoftEnabled ? "success" : "warning"}>
                {microsoftEnabled ? "Connected" : "Not Configured"}
              </Badge>
              <span className="text-sm text-[var(--text-secondary)]">
                Organization SSO for Microsoft-based tenants.
              </span>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              Configure Microsoft app registration details here to add Microsoft 365 sign-in
              on the login screen.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-[var(--accent)]" />
              Google OAuth
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant={googleEnabled ? "success" : "warning"}>
                {googleEnabled ? "Connected" : "Not Configured"}
              </Badge>
              <span className="text-sm text-[var(--text-secondary)]">
                Google sign-in for admins and compliance users.
              </span>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              Store your Google OAuth client ID and secret here to enable Google sign-in without editing environment files.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-[var(--accent)]" />
            Authentication Providers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
            <p className="text-sm font-semibold text-[var(--text-primary)]">User authentication lives here</p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
              Use this page for employee sign-in methods like Google, Microsoft 365, and local accounts.
              Google Workspace shadow AI discovery is configured separately under{" "}
              <Link href="/settings/shadow-ai" className="text-[var(--accent)] hover:underline">
                Shadow AI settings
              </Link>
              .
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Local Account Login</Label>
              <select
                value={identityConfig.enableLocalAuth}
                onChange={(e) => setIdentityConfig((current) => ({ ...current, enableLocalAuth: e.target.value }))}
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
                <option value="false">Disabled</option>
                <option value="true">Enabled</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Dev Login Shortcut</Label>
              <select
                value={identityConfig.enableDevLogin}
                onChange={(e) => setIdentityConfig((current) => ({ ...current, enableDevLogin: e.target.value }))}
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
                <option value="false">Disabled</option>
                <option value="true">Enabled</option>
              </select>
              <p className="text-[11px] text-[var(--text-faint)]">
                Keep this disabled outside local testing. Production startup will still fail if dev login is enabled.
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[var(--border-subtle)] p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Google Sign-In</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    OAuth app credentials for Google login. This does not control Google Workspace shadow AI scanning.
                  </p>
                </div>
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                >
                  Google Cloud Console <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                  Google Sign-In Checklist
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {googleReadinessChecks.map((check) => (
                    <div
                      key={check.label}
                      className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-muted)]"
                    >
                      {check.ok ? (
                        <ShieldCheck className="h-3.5 w-3.5 text-[var(--success)]" />
                      ) : (
                        <CircleAlert className="h-3.5 w-3.5 text-[var(--warning)]" />
                      )}
                      <span>{check.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Client ID</Label>
                <Input
                  value={identityConfig.googleClientId}
                  onChange={(e) => setIdentityConfig((current) => ({ ...current, googleClientId: e.target.value }))}
                  placeholder="Google OAuth client ID"
                />
              </div>
              <div className="space-y-2">
                <Label>Client Secret</Label>
                <Input
                  type="password"
                  value={identityConfig.googleClientSecret}
                  onChange={(e) => setIdentityConfig((current) => ({ ...current, googleClientSecret: e.target.value }))}
                  placeholder={googleEnabled ? "Leave blank to keep current secret" : "Google OAuth client secret"}
                />
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs text-[var(--text-muted)]">
                <p className="font-semibold text-[var(--text-primary)]">Redirect URI to allow in Google Cloud</p>
                <code className="mt-2 block rounded bg-[var(--bg-elevated)] px-2 py-1 font-mono text-[11px] text-[var(--accent)]">
                  {googleCallbackUrl}
                </code>
              </div>
              {googleValidationMessages.length > 0 && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-200">
                    Before You Save
                  </p>
                  <div className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
                    {googleValidationMessages.map((msg) => (
                      <p key={msg}>{msg}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Microsoft 365 / Entra ID</p>
                  <p className="text-xs text-[var(--text-muted)]">OAuth app registration for Microsoft login.</p>
                </div>
                <a
                  href="https://entra.microsoft.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                >
                  Microsoft Entra <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <div className="space-y-2">
                <Label>Client ID</Label>
                <Input
                  value={identityConfig.microsoftClientId}
                  onChange={(e) => setIdentityConfig((current) => ({ ...current, microsoftClientId: e.target.value }))}
                  placeholder="Microsoft application client ID"
                />
              </div>
              <div className="space-y-2">
                <Label>Tenant ID</Label>
                <Input
                  value={identityConfig.microsoftTenantId}
                  onChange={(e) => setIdentityConfig((current) => ({ ...current, microsoftTenantId: e.target.value }))}
                  placeholder="Microsoft tenant ID"
                />
              </div>
              <div className="space-y-2">
                <Label>Client Secret</Label>
                <Input
                  type="password"
                  value={identityConfig.microsoftClientSecret}
                  onChange={(e) => setIdentityConfig((current) => ({ ...current, microsoftClientSecret: e.target.value }))}
                  placeholder={microsoftEnabled ? "Leave blank to keep current secret" : "Microsoft client secret"}
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-start gap-2">
              <FlaskConical className="mt-0.5 h-4 w-4 text-amber-200" />
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                Infrastructure-only settings like <code className="rounded bg-[var(--bg-elevated)] px-1">NEXTAUTH_SECRET</code>, <code className="rounded bg-[var(--bg-elevated)] px-1">DATABASE_URL</code>, and <code className="rounded bg-[var(--bg-elevated)] px-1">SETTINGS_ENCRYPTION_KEY</code> still need to stay in the deployment environment. The UI now manages the app-level identity configuration layered on top of them.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={saveIdentitySettings} disabled={savingIdentity || googleSaveBlocked}>
              {savingIdentity ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              {savingIdentity ? "Saving..." : "Save Identity Settings"}
            </Button>
            <Button
              variant="outline"
              onClick={testGoogleAuthSettings}
              disabled={testingGoogleAuth || googleSaveBlocked || !googleClientId}
            >
              {testingGoogleAuth ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Globe className="mr-2 h-4 w-4" />}
              {testingGoogleAuth ? "Testing..." : "Test Google Sign-In"}
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/settings/shadow-ai">
                Shadow AI Settings <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            {identityMessage && (
              <span className="text-sm text-[var(--text-muted)]">{identityMessage}</span>
            )}
          </div>
          {googleAuthTestResult && (
            <div
              className="flex items-start gap-3 rounded-lg border p-4"
              style={{
                borderColor: googleAuthTestResult.success
                  ? "rgba(16, 185, 129, 0.2)"
                  : "rgba(239, 68, 68, 0.2)",
                background: googleAuthTestResult.success
                  ? "rgba(16, 185, 129, 0.05)"
                  : "rgba(239, 68, 68, 0.05)",
              }}
            >
              {googleAuthTestResult.success ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" />
              ) : (
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--critical)]" />
              )}
              <p
                className="text-sm"
                style={{
                  color: googleAuthTestResult.success ? "var(--success)" : "var(--critical)",
                }}
              >
                {googleAuthTestResult.message}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-[var(--accent)]" />
            Create Local User
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <select
                value={form.role}
                onChange={(e) => setForm((current) => ({ ...current, role: e.target.value }))}
                className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
              >
                <option value="VIEWER">Viewer</option>
                <option value="COMPLIANCE_OFFICER">Compliance Officer</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Input value={form.department} onChange={(e) => setForm((current) => ({ ...current, department: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={createUser} disabled={creating || !form.name || !form.email || !form.password}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              {creating ? "Creating..." : "Create User"}
            </Button>
            {message && (
              <span className="text-sm text-[var(--text-muted)]">{message}</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-4 w-4 text-[var(--accent)]" />
            User Directory ({users.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                saving={savingUserId === user.id}
                onSave={updateUser}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UserRow({
  user,
  saving,
  onSave,
}: {
  user: ManagedUser;
  saving: boolean;
  onSave: (
    userId: string,
    updates: { name?: string; role?: string; department?: string | null; password?: string | null }
  ) => Promise<void>;
}) {
  const [name, setName] = useState(user.name ?? "");
  const [role, setRole] = useState(user.role);
  const [department, setDepartment] = useState(user.department ?? "");
  const [password, setPassword] = useState("");

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">{user.name ?? user.email}</p>
          <p className="text-xs text-[var(--text-muted)]">{user.email}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {user.department && <Badge variant="outline">{user.department}</Badge>}
            <Badge variant="info">{user.role.replace("_", " ")}</Badge>
            {user.hasLocalPassword && <Badge variant="success">Local Password</Badge>}
            {user.authProviders.map((provider) => (
              <Badge key={provider} variant="outline">
                {provider}
              </Badge>
            ))}
          </div>
        </div>
        <Badge variant="outline">
          {new Date(user.createdAt).toLocaleDateString()}
        </Badge>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Role</Label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="flex h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-sm text-[var(--text-primary)] appearance-none"
          >
            <option value="VIEWER">Viewer</option>
            <option value="COMPLIANCE_OFFICER">Compliance Officer</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label>Department</Label>
          <Input value={department} onChange={(e) => setDepartment(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Reset Password</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank to keep current"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          onClick={() =>
            onSave(user.id, {
              name,
              role,
              department: department || null,
              password: password || undefined,
            }).then(() => setPassword(""))
          }
          disabled={saving}
        >
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
          {saving ? "Saving..." : "Save Changes"}
        </Button>
        <div className="flex items-center gap-2 text-xs text-[var(--text-faint)]">
          <Shield className="h-3.5 w-3.5" />
          <span>Accounts can use local passwords, OAuth providers, or both.</span>
        </div>
      </div>
    </div>
  );
}
