import type { GetServerSideProps, NextApiRequest } from 'next'

import { StudyWorkspace } from '@/components/studyWorkspace'
import { getLessonById, type LessonDefinition } from '@/config/lessons'
import { getSessionFromRequest } from '@/lib/server/auth'

type LessonPageProps = {
  lesson: LessonDefinition
}

export const getServerSideProps: GetServerSideProps<LessonPageProps> = async ({
  req,
  params,
}) => {
  const session = getSessionFromRequest(req as NextApiRequest)
  if (!session) {
    return { redirect: { destination: '/', permanent: false } }
  }

  const lessonId = typeof params?.lessonId === 'string' ? params.lessonId : ''
  const lesson = getLessonById(lessonId)
  if (!lesson) return { notFound: true }

  return { props: { lesson } }
}

export default function LessonPage({ lesson }: LessonPageProps) {
  return <StudyWorkspace lesson={lesson} />
}
