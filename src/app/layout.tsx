import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Research Atlas — Research Network Explorer",
  description: "Search research papers, authors, citations and semantic connections.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
