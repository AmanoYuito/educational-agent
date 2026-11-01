import type { NextApiRequest, NextApiResponse } from 'next'
import { requireSession } from '@/lib/server/auth'
import { isDatabaseConfigured } from '@/lib/server/db'
import { QuizError } from '@/lib/server/quizGrading'
import {
  explainLearningQuiz,
  loadLearningQuiz,
} from '@/lib/server/quizLearning'
import type { QuizExplanationKind } from '@/features/messages/quizLearning'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET' && req.method !== 'POST')
    return res.status(405).json({ message: 'Method not allowed' })
  const session = requireSession(req, res)
  if (!session) return
  if (!isDatabaseConfigured())
    return res.status(503).json({ message: '学習記録DBに接続できません。' })
  const quizId = req.method === 'GET' ? req.query.quizId : req.body?.quizId
  if (typeof quizId !== 'string' || !quizId.trim() || quizId.length > 100)
    return res.status(400).json({ message: '問題のIDを確認してください。' })
  const kind = req.body?.kind
  if (req.method === 'POST' && !['mistake', 'simple', 'example'].includes(kind))
    return res.status(400).json({ message: '解説の種類を確認してください。' })
  try {
    const record = await loadLearningQuiz(session.userId, quizId)
    if (req.method === 'GET')
      return res.status(200).json({ sources: record.quiz.sources || [] })
    return res
      .status(200)
      .json(
        await explainLearningQuiz(
          session.userId,
          quizId,
          record,
          kind as QuizExplanationKind
        )
      )
  } catch (error) {
    const message =
      error instanceof QuizError
        ? error.message
        : '追加の解説を取得できませんでした。時間をおいて再度お試しください。'
    return res
      .status(error instanceof QuizError ? error.status : 502)
      .json({ message })
  }
}
