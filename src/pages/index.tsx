import type { GetServerSideProps, NextApiRequest } from 'next'

import { LessonPortal } from '@/components/lessonPortal'
import { LoginScreen } from '@/components/loginScreen'
import { enabledLessons, type LessonDefinition } from '@/config/lessons'
import { getSessionFromRequest } from '@/lib/server/auth'

type HomeProps = {
  isAuthenticated: boolean
  lessons: LessonDefinition[]
}

export const getServerSideProps: GetServerSideProps<HomeProps> = async ({
  req,
}) => {
  const session = getSessionFromRequest(req as NextApiRequest)
  return {
    props: {
      isAuthenticated: Boolean(session),
      lessons: enabledLessons,
    },
  }
}

const Home = ({ isAuthenticated, lessons }: HomeProps) => {
  if (!isAuthenticated) return <LoginScreen />
  return <LessonPortal lessons={lessons} />
}

export default Home
