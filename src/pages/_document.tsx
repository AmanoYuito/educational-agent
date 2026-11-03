import { Html, Head, Main, NextScript } from 'next/document'
import { FAVICON_PATH } from '@/config/branding'

export default function Document() {
  const publicPath = (
    process.env.PUBLIC_PATH ||
    process.env.BASE_PATH ||
    ''
  ).replace(/\/+$/, '')

  return (
    <Html lang="ja">
      <Head>
        <link
          rel="shortcut icon"
          type="image/x-icon"
          href={`${publicPath}/favicon.ico?v=08cbc3d7`}
        />
        <link
          rel="icon"
          type="image/png"
          sizes="256x256"
          href={`${publicPath}${FAVICON_PATH}`}
        />
        <link
          rel="apple-touch-icon"
          sizes="256x256"
          href={`${publicPath}${FAVICON_PATH}`}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=M+PLUS+2&family=Montserrat&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
