import { buildUrl } from '@/utils/buildUrl'
import { FAVICON_PATH } from '@/config/branding'
import Head from 'next/head'
export const Meta = () => {
  const title = 'コンピュータシステム2 学習支援AI'
  const description =
    '授業資料を見ながらAIエージェントに質問し、問題演習に取り組めます。'
  const siteOrigin =
    process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/+$/, '') ||
    'https://160.251.180.133'
  const imageUrl = `${siteOrigin}${buildUrl(FAVICON_PATH)}`
  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:site_name" content={title} />
      <meta property="og:image" content={imageUrl} />
      <meta property="og:image:alt" content="わんころもち" />
      <meta property="og:image:width" content="256" />
      <meta property="og:image:height" content="256" />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={imageUrl} />
    </Head>
  )
}
