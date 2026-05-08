import type { Metadata, Viewport } from "next";
import "./globals.css";
import "@/styles/legacy.css";
import { createClient } from "@/lib/supabase/server";
import { brandingAssetUrl, fetchAppSettings } from "@/lib/app-settings";

const FALLBACK_TITLE = "iD Tech Photo Reviewer";

// SSR title + favicon both come from `app_settings`. Title joins
// brand_name + brand_tagline with the same logic the runtime override in
// App.tsx uses, so admin renames take effect on the very first paint.
// Favicon falls back to "no icon" when the admin hasn't uploaded one —
// browsers show their generic icon rather than a hardcoded brand mark.
//
// The row is select-only-to-authenticated, so the unauthenticated /login
// render hits the catch and uses the bare fallbacks.
export async function generateMetadata(): Promise<Metadata> {
  let title = FALLBACK_TITLE;
  let iconUrl: string | null = null;
  try {
    const supabase = await createClient();
    const settings = await fetchAppSettings(supabase);
    if (settings) {
      const name = settings.brandName.trim();
      const tag = settings.brandTagline.trim();
      title =
        name && tag ? `${name} · ${tag}` :
        name || tag || FALLBACK_TITLE;
      if (settings.faviconStoragePath) {
        iconUrl = brandingAssetUrl(supabase, settings.faviconStoragePath);
      }
    }
  } catch {
    // Pre-auth render or any other failure — keep both fallbacks.
  }
  return {
    title,
    description: "iD Tech Camp photo review tool.",
    // Only emit an icon link when the admin has uploaded one. Omitting
    // the field tells Next.js not to render any <link rel="icon">.
    ...(iconUrl ? { icons: { icon: [{ url: iconUrl, type: "image/png" }] } } : {}),
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
