import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: { default: 'CareSlot Clinic', template: '%s · CareSlot' }, description: 'Clinic accounts, care team and patient connections.', robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><head><link rel="preload" href="/fonts/dm-sans.ttf" as="font" type="font/ttf" crossOrigin="anonymous"/></head><body>{children}</body></html>; }
