import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "memo — payment protection for small-business trade",
  description:
    "A stablecoin letter of credit on NEAR. Lock USDC in milestones, release on proof, and a payout address nobody can change.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Header />
          <main>
            <div className="container">{children}</div>
          </main>
          <footer>
            <div className="container row between">
              <span>memo · You shouldn&apos;t have to trust a stranger to trade with one.</span>
              <a href="https://github.com/ahmardchain/memo">Source on GitHub</a>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
