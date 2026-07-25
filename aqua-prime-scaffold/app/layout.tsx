import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { ScaffoldEthProvider } from "~~/components/ScaffoldEthProvider";
import "./globals.css";

const ClientToaster = dynamic(() => import("~~/components/ClientToaster").then(m => m.ClientToaster), {
  ssr: false,
});

export const metadata: Metadata = {
  title: "Prime Desk — self-custodied spot MM terminal",
  description: "Bloomberg-style market-making desk on 1inch Aqua + SwapVM (WETH/USDC)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-mono antialiased" suppressHydrationWarning>
        <ScaffoldEthProvider>
          {children}
          <ClientToaster />
        </ScaffoldEthProvider>
      </body>
    </html>
  );
}
