import type { Metadata } from 'next'
import { globalStyles } from '../styles'

export const metadata: Metadata = {
  title: '2nd Brain | Maximus Carapax',
  description: 'A living knowledge base that grows through collaboration',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: globalStyles }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
