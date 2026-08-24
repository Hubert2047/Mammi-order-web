import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '漫迷 Order',
  icons: { icon: '/logo.png', apple: '/logo.png' },
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body className="min-h-screen bg-white text-black antialiased">{children}</body></html>
}
