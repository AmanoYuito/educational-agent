import type { NextApiRequest, NextApiResponse } from 'next'
import { requireSession } from '@/lib/server/auth'
import { isDatabaseConfigured } from '@/lib/server/db'
import {
  getIssuedQuizForGrading,
  QuizError,
  saveWrittenQuizGrade,
} from '@/lib/server/quizGrading'
import { getLearningSetProgress } from '@/lib/server/learningSessions'
import { generateLearningFeedback } from '@/lib/server/learningFeedback'
import { evaluateWrittenQuizAnswer } from '@/lib/server/writtenQuizGrading'

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

  const quizId = String(req.body?.quizId || '').trim()
  const userAnswer = String(req.body?.userAnswer || '').trim()
  if (
    !quizId ||
    quizId.length > 100 ||
    !userAnswer ||
    userAnswer.length > 10000
  )
    return res.status(400).json({ message: '回答の形式が正しくありません。' })

  try {
    const issued = await getIssuedQuizForGrading(session.userId, quizId)
    if (!issued)
      throw new QuizError(
        404,
        '問題が見つかりません。新しく問題を生成してください。'
      )
    if (issued.quiz.questionType !== 'written')
      throw new QuizError(400, 'この問題は記述問題ではありません。')
    if (issued.gradedResult) {
      if (issued.gradedResult.attempt?.userAnswer !== userAnswer)
        throw new QuizError(
          409,
          'この問題は回答済みです。画面を更新してください。'
        )
      let learningSet = issued.gradedResult.attempt?.learningSessionId
        ? await getLearningSetProgress(
            session.userId,
            issued.gradedResult.attempt.learningSessionId
          )
        : null
      if (issued.gradedResult.attempt?.learningSessionId) {
        learningSet = await generateLearningFeedback(
          session.userId,
          issued.gradedResult.attempt.learningSessionId,
          learningSet
        )
      }
      return res.status(200).json({ ...issued.gradedResult, learningSet })
    }

    const evaluation = await evaluateWrittenQuizAnswer(
      session.userId,
      issued.quiz,
      userAnswer
    )
    const result = await saveWrittenQuizGrade(
      session.userId,
      quizId,
      userAnswer,
      evaluation
    )
    let learningSet = result.attempt.learningSessionId
      ? await getLearningSetProgress(
          session.userId,
          result.attempt.learningSessionId
        )
      : null
    if (result.attempt.learningSessionId) {
      learningSet = await generateLearningFeedback(
        session.userId,
        result.attempt.learningSessionId,
        learningSet
      )
    }
    return res.status(200).json({ ...result, learningSet })
  } catch (error) {
    if (error instanceof QuizError)
      return res.status(error.status).json({ message: error.message })
    console.error('[grade-written-quiz] Failed to grade answer:', error)
    return res.status(500).json({
      message:
        '記述問題を採点できませんでした。同じ回答をもう一度送信してください。',
    })
  }
}
