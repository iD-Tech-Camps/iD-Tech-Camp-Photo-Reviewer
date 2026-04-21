import type { Metadata, Viewport } from "next";
import "./globals.css";
import "@/styles/legacy.css";

export const metadata: Metadata = {
  title: "Treeline · Photo Review",
  description: "iD Tech Camp photo review tool.",
};

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
