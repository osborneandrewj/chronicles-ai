import type { Metadata, Viewport } from "next";
import { Cinzel, Inter, Lora, Share_Tech_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const cinzel = Cinzel({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const shareTech = Share_Tech_Mono({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-mono-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Chronicles AI",
  description: "Interactive streaming narrator (MVP)",
};

// viewportFit cover lets safe-area-inset env() values resolve under the
// iOS home indicator. interactiveWidget=resizes-content lifts the layout
// when the software keyboard opens, so the composer stays visible without
// JS keyboard tracking.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${lora.variable} ${cinzel.variable} ${shareTech.variable}`}>
      <body className="min-h-screen bg-neutral-950 font-sans text-neutral-100 antialiased">
        {children}
      </body>
    </html>
  );
}
