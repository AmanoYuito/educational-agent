import type { GetServerSideProps, NextApiRequest } from 'next'
import { getSessionFromRequest } from '@/lib/server/auth'
import { AdminQuizEvaluation } from '@/components/adminQuizEvaluation'
import { Meta } from '@/components/meta'
import { AuthStatus } from '@/components/authStatus'

type Props = { userId: string; username: string }

export const getServerSideProps: GetServerSideProps<Props> = async ({
  req,
}) => {
  const session = getSessionFromRequest(req as NextApiRequest)
  if (!session || session.role !== 'admin')
    return { redirect: { destination: '/', permanent: false } }
  return { props: { userId: session.userId, username: session.username } }
}

export default function QuizEvaluationPage(props: Props) {
  return (
    <>
      <Meta />
      <AuthStatus />
      <AdminQuizEvaluation {...props} />
    </>
  )
}
