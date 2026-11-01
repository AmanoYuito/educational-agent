import type { NextApiRequest, NextApiResponse } from 'next'

import { isDatabaseConfigured } from '@/lib/server/db'
import { getQuestionKnowledge } from '@/lib/server/questionKnowledge'
import { getLessonByDatasetId } from '@/config/lessons'
import { verifyQuestionPoolRequestToken } from '@/lib/server/questionPoolRequest'
import {
  issueQuestionPoolItem,
  selectLearningSetQuestionPoolRow,
} from '@/lib/server/questionPoolSelection'
import { getLearningSessionForIssue } from '@/lib/server/learningSessions'

const bearerToken = (req: NextApiRequest) =>
  String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || ''

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST')
    return res
      .status(405)
      .json({ type: 'error', message: 'Method not allowed' })
  if (!isDatabaseConfigured())
    return res
      .status(503)
      .json({ type: 'error', message: 'DATABASE_URL is not set' })

  const claims = verifyQuestionPoolRequestToken(bearerToken(req))
  if (!claims)
    return res.status(401).json({ type: 'error', message: 'Unauthorized' })

  const requestedDatasetId = String(req.body?.source_dataset_id || '').trim()
  if (
    !requestedDatasetId ||
    requestedDatasetId !== claims.datasetId ||
    !getQuestionKnowledge(requestedDatasetId)
  )
    return res
      .status(400)
      .json({ type: 'error', message: 'Invalid source_dataset_id' })

  const requestedDifficulty = String(req.body?.difficulty ?? '').trim()
  const lessonId = getLessonByDatasetId(requestedDatasetId)?.id || 'legacy'
  const learningSet = await getLearningSessionForIssue(claims.userId, lessonId)
  const row = await selectLearningSetQuestionPoolRow({
    learnerId: claims.userId,
    lessonId,
    datasetId: requestedDatasetId,
    topic: typeof req.body?.topic === 'string' ? req.body.topic : undefined,
    difficulty:
      requestedDifficulty && Number.isFinite(Number(requestedDifficulty))
        ? Number(requestedDifficulty)
        : undefined,
    questionType: learningSet.questionType,
    excludeQuestionPoolIds: learningSet.issuedQuestionPoolIds,
    excludeUnderstandSkills: learningSet.issuedUnderstandSkills,
  })
  if (!row) {
    // The Dify HTTP node can still complete and return a useful application error.
    return res.status(200).json({
      type: 'question_pool_empty',
      message: '選択中の教材には、採用済みの問題がありません。',
    })
  }

  const item = await issueQuestionPoolItem(claims.userId, row, learningSet)
  if (!item)
    return res.status(200).json({
      type: 'question_pool_empty',
      message: '選択中の教材には、出題可能な問題がありません。',
    })

  return res.status(200).json({
    type: 'quiz',
    serverQuizId: item.serverQuizId,
    questionPoolId: item.id,
    questionType: item.questionType,
    public: { question: item.question, choices: item.choices },
    question: item.question,
    choices: item.choices,
    difficultyLevel: item.difficultyLevel,
    questionGroup: item.questionGroup,
    understandSkill: item.understandSkill,
    learningSessionId: item.learningSessionId,
    quizIndex: item.quizIndex,
    total: item.total,
  })
}
