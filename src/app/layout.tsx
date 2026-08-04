import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Interviews — ABTalks",
  description: "Live AI voice interview screening platform by ABTalks",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`}>
      <body className="antialiased min-h-screen flex flex-col font-sans bg-background text-foreground">
        {/* ABTalks-style Navbar */}
        <nav className="w-full border-b border-border/40 bg-background/80 backdrop-blur-lg sticky top-0 z-50">
          <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-3">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#7364E6] to-[#ec4899] flex items-center justify-center text-white text-sm font-bold">
                AB
              </div>
              <span className="font-display font-bold text-lg tracking-tight text-white">
                ABTalks
              </span>
              <span className="text-xs font-medium text-white/40 border border-white/10 rounded px-1.5 py-0.5 ml-1">
                Interviews
              </span>
            </Link>
            <div className="flex items-center gap-4">
              <Link
                href="/admin"
                className="text-sm font-medium text-white/60 hover:text-white transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href="/admin/jobs/new"
                className="text-sm font-medium px-4 py-2 rounded-lg bg-primary text-white btn-abtalks"
              >
                Post a Job
              </Link>
            </div>
          </div>
        </nav>

        <main className="flex-1 flex flex-col">{children}</main>
      </body>
    </html>
  );
}
