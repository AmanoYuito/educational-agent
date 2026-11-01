import { NextApiRequest, NextApiResponse } from 'next'

import { requireSession } from '@/lib/server/auth'
import { isDatabaseConfigured } from '@/lib/server/db'
import { getQuestionKnowledge } from '@/lib/server/questionKnowledge'
import { getLessonById } from '@/config/lessons'
import {
  issueQuestionPoolItem,
  getAdaptiveDifficulty,
  selectLearningSetQuestionPoolRow,
} from '@/lib/server/questionPoolSelection'
import { getLearningSessionForIssue } from '@/lib/server/learningSessions'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const session = requireSession(req, res)
  if (!session) return

  if (!isDatabaseConfigured()) {
    return res.status(503).json({ message: 'DATABASE_URL is not set' })
  }

  const topicQuery =
    typeof req.query.topic === 'string' ? req.query.topic.trim() : ''
  const difficultyQuery =
    typeof req.query.difficulty === 'string'
      ? Number(req.query.difficulty)
      : null
  const lessonQuery =
    typeof req.query.lesson === 'string' ? req.query.lesson.trim() : ''
  const lesson = getLessonById(lessonQuery)
  if (!lesson)
    return res.status(400).json({ message: 'unknown lesson', item: null })
  const knowledge = getQuestionKnowledge(lesson.datasetId)
  if (!knowledge)
    return res
      .status(400)
      .json({ message: 'unknown lesson dataset', item: null })

  const learningSet = await getLearningSessionForIssue(
    session.userId,
    lesson.id
  )
  const targetDifficulty = Number.isFinite(difficultyQuery)
    ? difficultyQuery
    : await getAdaptiveDifficulty(
        session.userId,
        lesson.id,
        learningSet.questionType
      )
  const row = await selectLearningSetQuestionPoolRow({
    learnerId: session.userId,
    lessonId: lesson.id,
    datasetId: knowledge.id,
    topic: topicQuery,
    difficulty: targetDifficulty,
    questionType: learningSet.questionType,
    excludeQuestionPoolIds: learningSet.issuedQuestionPoolIds,
    excludeUnderstandSkills: learningSet.issuedUnderstandSkills,
  })
  if (!row) {
    return res.status(404).json({
      message:
        learningSet.questionType === 'written'
          ? '記述問題が問題プールにありません。理解問題を採用してください。'
          : '4択問題が問題プールにありません。記憶問題を採用してください。',
      item: null,
    })
  }

  const item = await issueQuestionPoolItem(session.userId, row, learningSet)
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ item })
}
