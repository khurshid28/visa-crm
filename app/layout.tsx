import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "Visa CRM",
  description: "Guruhlarni boshqarish va appointment tizimi",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uz">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
