import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BookSimple | Business workspace",
  description:
    "A simple workspace for small businesses to manage conversations and bookings.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
