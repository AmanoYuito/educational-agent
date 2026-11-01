import { NextApiRequest, NextApiResponse } from 'next'

import type { QuizHistoryItem } from '@/features/stores/home'
import type { WrittenAssessmentLevel } from '@/features/stores/home'
import { isDatabaseConfigured, query } from '@/lib/server/db'
import { requireSession } from '@/lib/server/auth'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const session = requireSession(req, res)
  if (!session) return

  if (!isDatabaseConfigured()) {
    return res.status(503).json({ message: 'DATABASE_URL is not set' })
  }

  if (req.method === 'GET') {
    const result = await query<{
      id: string
      question_pool_id: string | null
      question: string
      question_type: 'multiple_choice' | 'written'
      choices: string[] | null
      quiz_index: number | null
      total_questions: number | null
      difficulty_level: number | null
      question_group: string | null
      correct_index: number | null
      correct_answer: string | null
      user_answer: string
      user_index: number | null
      is_correct: boolean
      assessment_level: WrittenAssessmentLevel | null
      score: number | null
      response_time_ms: number | null
      explanation: string | null
      ai_output: string | null
      created_at: string
    }>(
      `
        SELECT
          id,
          question_pool_id,
          question,
          question_type,
          choices,
          quiz_index,
          total_questions,
          difficulty_level,
          question_group,
          correct_index,
          correct_answer,
          user_answer,
          user_index,
          is_correct,
          assessment_level,
          score,
          response_time_ms,
          explanation,
          ai_output,
          created_at
        FROM quiz_attempts
        WHERE user_id = $1
        ORDER BY created_at ASC
        LIMIT 500
      `,
      [session.userId]
    )

    const items: QuizHistoryItem[] = result.rows.map((row) => ({
      id: row.id,
      questionPoolId: row.question_pool_id || undefined,
      questionType: row.question_type,
      question: row.question,
      choices: row.choices || undefined,
      quizIndex: row.quiz_index ?? undefined,
      total: row.total_questions ?? undefined,
      difficultyLevel: row.difficulty_level ?? undefined,
      questionGroup: row.question_group || undefined,
      correctIndex: row.correct_index ?? undefined,
      correctAnswer: row.correct_answer || undefined,
      userAnswer: row.user_answer,
      userIndex: row.user_index ?? undefined,
      correct: row.is_correct,
      assessmentLevel: row.assessment_level || undefined,
      score: row.score ?? undefined,
      responseTimeMs: row.response_time_ms ?? undefined,
      explanation: row.explanation || undefined,
      aiOutput: row.ai_output || undefined,
      answeredAt: row.created_at,
    }))

    return res.status(200).json({ items })
  }

  return res.status(400).json({
    message:
      '回答結果の直接保存はできません。/api/grade-quiz で採点してください。',
  })
}
