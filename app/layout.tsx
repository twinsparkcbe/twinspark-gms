import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { GlobalLoaderProvider } from "@/components/shared/global-loader";

import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Twinspark Garage Management",
  description: "Garage management system for Twinspark (Coimbatore)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        <GlobalLoaderProvider>
          {children}
          <Toaster />
        </GlobalLoaderProvider>
      </body>
    </html>
  );
}
