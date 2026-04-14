import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import type { Provider } from "next-auth/providers/index";
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
          const userCount = await prisma.user.count();
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
        if (user || trigger === "signIn") {
          const jwtEmail = String(user?.email ?? token.email ?? "");
          const dbUser = jwtEmail
            ? await prisma.user.findUnique({
                where: { email: jwtEmail },
                select: { id: true, role: true, department: true },
              })
            : null;
          if (dbUser) {
            token.userId = dbUser.id;
            token.role = dbUser.role;
            token.department = dbUser.department;
          }
        }
        return token;
      },
      async session({ session, token }) {
        if (session.user) {
          session.user.userId = token.userId as string;
          session.user.role = token.role as string;
          session.user.department = token.department as string | null;
        }
        return session;
      },
    },
    pages: {
      signIn: "/login",
    },
  };
}
