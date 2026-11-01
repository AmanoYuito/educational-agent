import type { NextApiRequest, NextApiResponse } from 'next'

import { requireSession } from '@/lib/server/auth'
import { isDatabaseConfigured } from '@/lib/server/db'
import { getLearningSetProgress } from '@/lib/server/learningSessions'
import { QuizError, revealQuizAnswer } from '@/lib/server/quizGrading'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST')
    return res.status(405).json({ message: 'Method not allowed' })
  const session = requireSession(req, res)
  if (!session) return
  if (!isDatabaseConfigured())
    return res.status(503).json({ message: '学習記録DBに接続できません。' })

  const { quizId } = req.body || {}
  if (typeof quizId !== 'string' || !quizId || quizId.length > 100)
    return res.status(400).json({ message: '問題の指定が正しくありません。' })

  try {
    const result = await revealQuizAnswer(session.userId, quizId)
    const learningSet = result.quiz.learningSessionId
      ? await getLearningSetProgress(
          session.userId,
          result.quiz.learningSessionId
        )
      : null
    return res
      .status(200)
      .json({ grade: result.grade, attempt: result.attempt, learningSet })
  } catch (error) {
    if (error instanceof QuizError)
      return res.status(error.status).json({ message: error.message })
    console.error('[reveal-quiz-answer] Failed to reveal answer:', error)
    return res.status(500).json({
      message: '正答と解説を取得できませんでした。もう一度お試しください。',
    })
  }
}
