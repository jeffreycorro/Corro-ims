import type { Metadata } from "next";
import { Source_Sans_3, Source_Serif_4 } from "next/font/google";
import { DemoBanner } from "@/components/demo-banner";
import "./globals.css";

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CorConDev Portal",
    template: "%s · CorConDev",
  },
  description:
    "Internal operations portal for Corro Construction Development and Trade Corporation.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sourceSans.variable} ${sourceSerif.variable} font-sans antialiased`}>
        <DemoBanner />
        {children}
      </body>
    </html>
  );
}
