import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const viewport: Viewport = {
  themeColor: "#b85c38",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // viewport-fit=cover makes env(safe-area-inset-*) report real values so the
  // shell's safe-area padding applies consistently. Without it the inset
  // resolves to 0 on some paints, jamming the header under the status bar/notch.
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "PaySats — Save in Bitcoin",
  description:
    "Save in Bitcoin. Preserve wealth. Never sell. PaySats x IDRX allows direct IDR deposits and auto DCA into Bitcoin.",
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PaySats",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* Extensions (e.g. password managers) inject attributes on <body>; suppress avoids false hydration errors. */}
      <body
        className="min-h-full flex flex-col bg-paysats-bg"
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
