import { NextApiRequest, NextApiResponse } from 'next'

import type { GeneratedQuizMemory } from '@/features/stores/home'
import { requireSession } from '@/lib/server/auth'
import { isDatabaseConfigured, query } from '@/lib/server/db'
import { getLessonById } from '@/config/lessons'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const session = requireSession(req, res)
  if (!session) return

  if (!isDatabaseConfigured()) {
    return res.status(503).json({ message: 'DATABASE_URL is not set' })
  }

  const { latestGeneratedQuizMemory, difyConversationId, lessonId } =
    req.body as {
      latestGeneratedQuizMemory?: GeneratedQuizMemory | null
      difyConversationId?: string
      lessonId?: string
    }
  const lesson = getLessonById(lessonId)
  if (!lesson) {
    return res.status(400).json({ message: 'Invalid lesson' })
  }

  await query(
    `
      INSERT INTO user_learning_state (
        user_id,
        lesson_id,
        latest_generated_quiz_memory,
        dify_conversation_id,
        updated_at
      )
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (user_id, lesson_id) DO UPDATE
      SET
        latest_generated_quiz_memory =
          EXCLUDED.latest_generated_quiz_memory,
        dify_conversation_id = EXCLUDED.dify_conversation_id,
        updated_at = now()
    `,
    [
      session.userId,
      lesson.id,
      latestGeneratedQuizMemory
        ? JSON.stringify(latestGeneratedQuizMemory)
        : null,
      difyConversationId || '',
    ]
  )

  return res.status(200).json({ message: 'User state saved' })
}
