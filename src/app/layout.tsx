import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReadySpec",
  description: "Repository-aware agent that turns rough tickets into evidence-backed implementation briefs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}
