import type { Metadata, Viewport } from "next";
import { Outfit, Source_Sans_3, Geist_Mono } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Hello Sugar Marketplace",
  description: "Find and sell Hello Sugar franchise locations",
  metadataBase: new URL("https://marketplace.hellosugar.salon"),
};

// viewport-fit=cover lets the page extend into the display cutout / home-indicator
// region so env(safe-area-inset-*) padding (see globals.css) can resolve to real
// values on notched devices instead of always being 0.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${sourceSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-white text-gray-900 antialiased">
        <NuqsAdapter>{children}</NuqsAdapter>
      </body>
    </html>
  );
}
