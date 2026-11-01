import type { GetServerSideProps, NextApiRequest } from 'next'

import { AdminActivityLogs } from '@/components/adminActivityLogs'
import { AuthStatus } from '@/components/authStatus'
import { Meta } from '@/components/meta'
import { enabledLessons } from '@/config/lessons'
import { getSessionFromRequest } from '@/lib/server/auth'

type Props = {
  lessons: { id: string; title: string }[]
}

export const getServerSideProps: GetServerSideProps<Props> = async ({
  req,
}) => {
  const session = getSessionFromRequest(req as NextApiRequest)
  if (!session || session.role !== 'admin') {
    return { redirect: { destination: '/', permanent: false } }
  }
  return {
    props: {
      lessons: enabledLessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
      })),
    },
  }
}

export default function ActivityLogsPage({ lessons }: Props) {
  return (
    <>
      <Meta />
      <AuthStatus />
      <AdminActivityLogs lessons={lessons} />
    </>
  )
}
