import type { GetServerSideProps } from 'next'
import Head from 'next/head'

import { getLessonById, type LessonDefinition } from '@/config/lessons'
import { FAVICON_PATH } from '@/config/branding'
import { withBasePath } from '@/utils/basePath'

type MaterialPageProps = { lesson: LessonDefinition }

export const getServerSideProps: GetServerSideProps<MaterialPageProps> = async (
  context
) => {
  const lessonId = String(context.params?.lessonId || '')
  const lesson = getLessonById(lessonId)
  if (!lesson) return { notFound: true }
  return { props: { lesson } }
}

export default function LessonMaterialPage({ lesson }: MaterialPageProps) {
  const title = `${lesson.courseName}　${lesson.lessonName}`
  const pdfUrl = withBasePath(lesson.materialPath)

  return (
    <>
      <Head>
        <title>{title}</title>
        <link
          rel="icon"
          type="image/png"
          sizes="256x256"
          href={withBasePath(FAVICON_PATH)}
        />
      </Head>
      <main aria-label={`${title}の授業資料`}>
        <iframe
          src={pdfUrl}
          title={title}
          style={{
            position: 'fixed',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 0,
            background: '#fff',
          }}
        />
      </main>
    </>
  )
}
