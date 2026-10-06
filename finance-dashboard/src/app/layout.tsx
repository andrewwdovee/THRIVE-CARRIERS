import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Thrive Finance",
  description: "Bank, cash flow and business KPI dashboard for Thrive Companies and Lead Tech",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
