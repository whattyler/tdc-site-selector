import type { Metadata } from "next";
import { Alegreya, Carlito } from "next/font/google";
import "./globals.css";

/** Display: wordmark, section headers, bucket headers, the verdict word. */
const alegreya = Alegreya({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
});

/** Body: everything else — table, inputs, numbers. Metric-identical to Calibri. */
const carlito = Carlito({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TDC Site Selector",
  description: "Address in, GO / NO-GO and a max land price out.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${alegreya.variable} ${carlito.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
