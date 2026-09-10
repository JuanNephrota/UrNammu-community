import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import type { Provider } from "next-auth/providers/index";
import type { JWT } from "next-auth/jwt";
import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import { verifyPassword } from "./passwords";
import { isDemoModeEnabled } from "./demo-mode";
import { AUTH_SETTINGS_KEYS, getSetting } from "./settings";

const isProduction = process.env.NODE_ENV === "production";

async function getBooleanSetting(key: string, fallback: boolean) {
  const value = await getSetting(key);
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/**
 * Sessions are JWTs, so an already-signed-in user keeps their token until it
 * expires. Every request re-reads the account from the database and drops the
 * identity claims unless the account is still ACTIVE — that is what makes
 * suspension and deletion take effect immediately rather than eventually.
 */
export function isActiveStatus(status: string | null | undefined): boolean {
  return status === "ACTIVE";
}

function revokeClaims(token: JWT, status: string): JWT {
  token.status = status;
  delete (token as Partial<JWT>).userId;
  delete (token as Partial<JWT>).role;
  delete (token as Partial<JWT>).department;
  return token;
}

export async function hydrateJwtClaims(
  token: JWT,
  user?: { email?: string | null; id?: string | null }
): Promise<JWT> {
  const jwtEmail = String(user?.email ?? token.email ?? "");
  if (!jwtEmail) return token;

  const dbUser = await prisma.user.findUnique({
    where: { email: jwtEmail },
    select: { id: true, role: true, department: true, status: true },
  });

  if (dbUser) {
    // `status` is absent when a stubbed/legacy record predates the column.
    const status = dbUser.status ?? "ACTIVE";
    if (!isActiveStatus(status)) {
      return revokeClaims(token, status);
    }
    token.userId = dbUser.id;
    token.role = dbUser.role;
    token.department = dbUser.department;
    token.status = status;
    return token;
  }

  // Mid-sign-in the adapter may not have committed the row yet, so trust the
  // provider's user object. Otherwise the account has gone (or was deleted and
  // its email scrubbed) and the token must stop granting access.
  if (user?.id) {
    token.userId = user.id;
    token.status = "ACTIVE";
    return token;
  }

  return revokeClaims(token, "DELETED");
}

export async function getAuthOptions(): Promise<NextAuthOptions> {
  const providers: Provider[] = [];
  const isDemoMode = isDemoModeEnabled();
  const isDevLoginEnabled = await getBooleanSetting(
    AUTH_SETTINGS_KEYS.ENABLE_DEV_LOGIN,
    !isProduction
  );
  const isLocalAuthEnabled = await getBooleanSetting(
    AUTH_SETTINGS_KEYS.ENABLE_LOCAL_AUTH,
    !isProduction || isDemoMode
  );

  if (isProduction && isDevLoginEnabled) {
    throw new Error("Dev login must not be enabled in production.");
  }

  const [googleClientId, googleClientSecret] = await Promise.all([
    getSetting(AUTH_SETTINGS_KEYS.GOOGLE_CLIENT_ID),
    getSetting(AUTH_SETTINGS_KEYS.GOOGLE_CLIENT_SECRET),
  ]);
  if (googleClientId && googleClientSecret) {
    providers.push(
      GoogleProvider({
        clientId: googleClientId,
        clientSecret: googleClientSecret,
      })
    );
  }

  const [microsoftClientId, microsoftClientSecret, microsoftTenantId] = await Promise.all([
    getSetting(AUTH_SETTINGS_KEYS.MICROSOFT_CLIENT_ID),
    getSetting(AUTH_SETTINGS_KEYS.MICROSOFT_CLIENT_SECRET),
    getSetting(AUTH_SETTINGS_KEYS.MICROSOFT_TENANT_ID),
  ]);
  if (microsoftClientId && microsoftClientSecret && microsoftTenantId) {
    providers.push(
      AzureADProvider({
        clientId: microsoftClientId,
        clientSecret: microsoftClientSecret,
        tenantId: microsoftTenantId,
      })
    );
  }

  if (isLocalAuthEnabled) {
    providers.push(
      CredentialsProvider({
        id: "local-account",
        name: "Local Account",
        credentials: {
          email: { label: "Email", type: "email", placeholder: "name@example.com" },
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials) {
          if (!credentials?.email || !credentials.password) return null;
          const email = String(credentials.email);

          const user = await prisma.user.findUnique({
            where: { email },
          });

          if (!user?.passwordHash) return null;
          if (!isActiveStatus(user.status)) return null;

          const isValid = await verifyPassword(credentials.password, user.passwordHash);
          if (!isValid) return null;

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
          };
        },
      })
    );
  }

  if (isDevLoginEnabled) {
    providers.push(
      CredentialsProvider({
        id: "dev-login",
        name: "Dev Login",
        credentials: {
          email: { label: "Email", type: "email", placeholder: "name@example.com" },
        },
        async authorize(credentials) {
          if (!credentials?.email) return null;
          const email = String(credentials.email);

          let user;
          if (!isProduction) {
            user = await prisma.user.upsert({
              where: { email },
              update: {},
              create: {
                email,
                name: email.split("@")[0],
                role: "VIEWER",
              },
            });
          } else {
            user = await prisma.user.findUnique({
              where: { email },
            });
          }

          if (!user) return null;
          if (!isActiveStatus(user.status)) return null;

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
          };
        },
      })
    );
  }

  return {
    secret: process.env.NEXTAUTH_SECRET,
    adapter: PrismaAdapter(prisma) as NextAuthOptions["adapter"],
    providers,
    session: {
      strategy: "jwt",
    },
    callbacks: {
      async signIn({ user, account }) {
        const email = typeof user.email === "string" ? user.email : null;
        if (
          (account?.provider === "google" || account?.provider === "azure-ad") &&
          email
        ) {
          // SSO bypasses the credentials providers' own status check, so gate
          // it here — a suspended account must not get a session from Google
          // or Entra either.
          const existing = await prisma.user.findUnique({
            where: { email },
            select: { status: true },
          });
          if (existing && !isActiveStatus(existing.status)) return false;

          const userCount = await prisma.user.count({
            where: { status: "ACTIVE" },
          });
          if (userCount <= 1) {
            await prisma.user.updateMany({
              where: { email },
              data: { role: "ADMIN" },
            });
          }
        }
        return true;
      },
      async jwt({ token, user, trigger }) {
        if (token.email || user || trigger === "signIn") {
          return hydrateJwtClaims(token, user);
        }
        return token;
      },
      async session({ session, token }) {
        // No userId means hydrateJwtClaims revoked the token (suspended or
        // deleted account). Leaving the claims off makes getSession() return
        // null, which redirects the dashboard to /login and 401s the APIs.
        if (session.user && token.userId) {
          session.user.userId = token.userId as string;
          session.user.role = token.role as string;
          session.user.department = token.department as string | null;
        }
        return session;
      },
    },
    pages: {
      signIn: "/login",
      // Keep provider errors (including the AccessDenied a suspended account
      // gets) on the branded login screen instead of NextAuth's default page.
      error: "/login",
    },
  };
}
