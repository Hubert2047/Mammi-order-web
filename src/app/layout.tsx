import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Mâm Mì Order',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>
}
