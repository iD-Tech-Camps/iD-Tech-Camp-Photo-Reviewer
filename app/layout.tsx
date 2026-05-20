import type { Metadata, Viewport } from "next";
import "./globals.css";
import "@/styles/legacy.css";
import { fetchPublicBranding } from "@/lib/app-settings-server";

const FALLBACK_TITLE = "iD Tech Photo Reviewer";

// SSR title + favicon from app_settings via service role so /login and
// other pre-auth renders match admin branding on first paint.
export async function generateMetadata(): Promise<Metadata> {
  const branding = await fetchPublicBranding();
  const name = branding.brandName;
  const tag = branding.brandTagline;
  const title =
    name && tag ? `${name} · ${tag}` :
    name || tag || FALLBACK_TITLE;
  return {
    title,
    description: "iD Tech Camp photo review tool.",
    ...(branding.logoUrl
      ? { icons: { icon: [{ url: branding.logoUrl, type: "image/png" }] } }
      : {}),
  };
}

export const viewport: Viewport = {
  width: 1280,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,450;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
