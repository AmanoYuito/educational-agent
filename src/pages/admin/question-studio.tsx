import type { GetServerSideProps, NextApiRequest } from 'next'

import { AdminQuestionStudio } from '@/components/adminQuestionStudio'
import { Meta } from '@/components/meta'
import { AuthStatus } from '@/components/authStatus'
import { selectableQuestionKnowledgeSources } from '@/lib/server/questionKnowledge'
import type { QuestionKnowledgeSource } from '@/features/questionPool/types'
import { getSessionFromRequest } from '@/lib/server/auth'
import { enabledLessons } from '@/config/lessons'

type Props = {
  username: string
  knowledgeSources: QuestionKnowledgeSource[]
  lessons: { id: string; title: string }[]
}

export const getServerSideProps: GetServerSideProps<Props> = async ({
  req,
}) => {
  const session = getSessionFromRequest(req as NextApiRequest)

  if (!session) {
    return {
      redirect: {
        destination: '/',
        permanent: false,
      },
    }
  }

  if (session.role !== 'admin') {
    return {
      redirect: {
        destination: '/',
        permanent: false,
      },
    }
  }

  return {
    props: {
      username: session.username,
      knowledgeSources: selectableQuestionKnowledgeSources,
      lessons: enabledLessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
      })),
    },
  }
}

const AdminQuestionStudioPage = ({
  username,
  knowledgeSources,
  lessons,
}: Props) => {
  return (
    <>
      <Meta />
      <AuthStatus />
      <AdminQuestionStudio
        username={username}
        knowledgeSources={knowledgeSources}
        lessons={lessons}
      />
    </>
  )
}

export default AdminQuestionStudioPage
