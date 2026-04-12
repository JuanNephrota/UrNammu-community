import type { Metadata } from "next";
import { Bricolage_Grotesque, DM_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { DemoModeBanner } from "@/components/demo/demo-mode-banner";
import { isDemoModeEnabled } from "@/lib/demo-mode";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Nammu",
  description: "Enterprise AI governance, risk, and compliance platform",
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const demoMode = isDemoModeEnabled();

  return (
    <html lang="en" className={`${bricolage.variable} ${dmSans.variable} h-full`}>
      <body className="h-full antialiased" style={{ fontFamily: "var(--font-body), system-ui, sans-serif" }}>
        <Providers>
          {demoMode && <DemoModeBanner />}
          {children}
        </Providers>
      </body>
    </html>
  );
}
