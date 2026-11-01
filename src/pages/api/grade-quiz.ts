import type { NextApiRequest, NextApiResponse } from 'next'
import { requireSession } from '@/lib/server/auth'
import { isDatabaseConfigured } from '@/lib/server/db'
import { gradeQuiz, QuizError } from '@/lib/server/quizGrading'
import { getLearningSetProgress } from '@/lib/server/learningSessions'
import { generateLearningFeedback } from '@/lib/server/learningFeedback'

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
  const { quizId, userIndex, userAnswer } = req.body || {}
  if (
    typeof quizId !== 'string' ||
    !quizId ||
    quizId.length > 100 ||
    !Number.isInteger(userIndex) ||
    userIndex < 0 ||
    userIndex > 3 ||
    typeof userAnswer !== 'string' ||
    !userAnswer.trim() ||
    userAnswer.length > 10000
  ) {
    return res.status(400).json({ message: '回答の形式が正しくありません。' })
  }
  try {
    // Do not accept a correct answer, a score, or a user ID from the browser.
    const result = await gradeQuiz(
      session.userId,
      quizId,
      userIndex,
      userAnswer
    )
    const learningSessionId = result.attempt?.learningSessionId
    let learningSet = learningSessionId
      ? await getLearningSetProgress(session.userId, learningSessionId)
      : null
    if (learningSessionId) {
      learningSet = await generateLearningFeedback(
        session.userId,
        learningSessionId,
        learningSet
      )
    }
    return res.status(200).json({ ...result, learningSet })
  } catch (error) {
    if (error instanceof QuizError)
      return res.status(error.status).json({ message: error.message })
    console.error('[grade-quiz] Failed to save grade:', error)
    return res.status(500).json({
      message:
        '採点結果を保存できませんでした。同じ回答をもう一度送信してください。',
    })
  }
}
