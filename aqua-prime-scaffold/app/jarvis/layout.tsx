import { Orbitron, Share_Tech_Mono } from "next/font/google";

const display = Orbitron({
  subsets: ["latin"],
  variable: "--aqua-display",
  weight: ["500", "700", "800"],
});

const mono = Share_Tech_Mono({
  subsets: ["latin"],
  variable: "--aqua-sans",
  weight: "400",
});

export default function JarvisLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${display.variable} ${mono.variable} aqua-root`}>{children}</div>;
}
