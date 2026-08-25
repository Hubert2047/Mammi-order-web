import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'

export const metadata: Metadata = {
  title: '漫迷 Order',
  icons: { icon: '/logo.png', apple: '/logo.png' },
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body className="min-h-screen bg-white text-black antialiased"><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />{children}</body></html>
}
