import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../style.css';

export const metadata: Metadata = {
  title: 'BenchReplay',
  description: 'Follow a paper-folding lesson with hands-free step replay.',
};

export const viewport: Viewport = { themeColor: '#f1eee6' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
