import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'

export const metadata: Metadata = {
    title: '漫迷 Order',
    icons: {
        icon: [
            { url: '/logo.png?v=1.0', type: 'image/png', sizes: '512x512' },
            { url: '/logo.png?v=1.0', type: 'image/png', rel: 'shortcut icon' },
        ],
        shortcut: '/logo.png?v=1.0',
        apple: '/logo.png?v=1.0',
    },
    robots: { index: false, follow: false },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <html lang='vi'>
            <body className='min-h-screen bg-white text-black antialiased'>
                <Script src='https://challenges.cloudflare.com/turnstile/v0/api.js' strategy='afterInteractive' />
                {children}
            </body>
        </html>
    )
}
