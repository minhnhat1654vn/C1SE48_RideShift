import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RideShift – Trợ lý chuyển đổi giao thông thông minh",
  description:
    "Nền tảng hỗ trợ ra quyết định giao thông dựa trên GIS cho Hà Nội. Lập tuyến, kiểm tra tuân thủ LEZ, chất lượng không khí và đề xuất phương tiện dựa trên MCDM.",
  keywords: [
    "RideShift",
    "LEZ",
    "Hanoi",
    "transportation",
    "GIS",
    "MCDM",
    "TOPSIS",
    "giao thông",
    "Hà Nội",
    "vùng phát thải thấp",
  ],
  authors: [{ name: "C1SE.48 Team" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
