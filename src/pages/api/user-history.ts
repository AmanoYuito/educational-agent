import { NextApiRequest, NextApiResponse } from 'next'

import type {
  GeneratedQuizMemory,
  LearningSetProgress,
  QuizHistoryItem,
  WrittenAssessmentLevel,
} from '@/features/stores/home'
import type { Message } from '@/features/messages/messages'
import type { UnderstandSkill } from '@/features/questionPool/types'
import { requireSession } from '@/lib/server/auth'
import { isDatabaseConfigured, query } from '@/lib/server/db'
import { getLessonById } from '@/config/lessons'
import { getLearningSetProgress } from '@/lib/server/learningSessions'
import { generateLearningFeedback } from '@/lib/server/learningFeedback'

const parseMessageContent = (
  rawContent: string
): Message['content'] | undefined => {
  if (!rawContent) return ''

  const trimmed = rawContent.trim()
  if (!trimmed) return ''

  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
    return rawContent
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed as Message['content']
    }
  } catch {
    // Ignore parse errors and fall back to plain text.
  }

  return rawContent
}

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
  const lessonId =
    typeof req.query.lesson === 'string' ? req.query.lesson.trim() : ''
  const lesson = getLessonById(lessonId)
  if (!lesson) {
    return res.status(400).json({ message: 'Invalid lesson' })
  }

  const [
    chatResult,
    quizResult,
    stateResult,
    learningSessionResult,
    questionCountResult,
  ] = await Promise.all([
    query<{
      id: string
      role: string
      content: string
      created_at: string
    }>(
      `
        SELECT
          id,
          role,
          content,
          created_at
        FROM chat_messages
        WHERE user_id = $1 AND lesson_id = $2
        ORDER BY created_at ASC
        LIMIT 500
      `,
      [session.userId, lesson.id]
    ),
    query<{
      id: string
      question_pool_id: string | null
      learning_session_id: string | null
      understand_skill: UnderstandSkill | null
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
          learning_session_id,
          understand_skill,
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
        WHERE user_id = $1 AND lesson_id = $2
        ORDER BY created_at ASC
        LIMIT 500
      `,
      [session.userId, lesson.id]
    ),
    query<{
      latest_generated_quiz_memory: GeneratedQuizMemory | null
      dify_conversation_id: string | null
    }>(
      `
        SELECT
          latest_generated_quiz_memory,
          dify_conversation_id
        FROM user_learning_state
        WHERE user_id = $1 AND lesson_id = $2
        LIMIT 1
      `,
      [session.userId, lesson.id]
    ),
    query<{ id: string }>(
      `SELECT id FROM learning_sessions
       WHERE user_id = $1 AND lesson_id = $2
       ORDER BY (completed_at IS NULL) DESC, created_at DESC
       LIMIT 1`,
      [session.userId, lesson.id]
    ),
    query<{ total: number; mastered_ids: string[] }>(
      `SELECT
           COUNT(*)::integer AS total,
           COALESCE(
             ARRAY_AGG(question_pool.id) FILTER (
               WHERE EXISTS (
                 SELECT 1
                 FROM quiz_attempts
                 WHERE quiz_attempts.user_id = $3
                   AND quiz_attempts.lesson_id = $1
                   AND quiz_attempts.question_pool_id = question_pool.id
                   AND quiz_attempts.is_correct = TRUE
               )
             ),
             ARRAY[]::text[]
           ) AS mastered_ids
         FROM question_pool
         WHERE lesson_id = $1
           AND source_dataset_id = $2
           AND is_active = TRUE
           AND (
             (
               question_type = 'multiple_choice'
               AND jsonb_typeof(choices) = 'array'
               AND jsonb_array_length(choices) = 4
               AND correct_index BETWEEN 0 AND 3
               AND COALESCE(bloom_level, 'remember') = 'remember'
             )
             OR (
               question_type = 'written'
               AND bloom_level = 'understand'
               AND NULLIF(BTRIM(correct_answer), '') IS NOT NULL
             )
           )`,
      [lesson.id, lesson.datasetId, session.userId]
    ),
  ])

  const chatMessages: Message[] = chatResult.rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: parseMessageContent(row.content),
    timestamp: row.created_at,
  }))

  const quizHistory: QuizHistoryItem[] = quizResult.rows.map((row) => ({
    id: row.id,
    questionPoolId: row.question_pool_id || undefined,
    learningSessionId: row.learning_session_id || undefined,
    understandSkill: row.understand_skill || undefined,
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

  const learningState = stateResult.rows[0]
  const learningSessionId = learningSessionResult.rows[0]?.id
  let learningSetProgress: LearningSetProgress | null = learningSessionId
    ? await getLearningSetProgress(session.userId, learningSessionId)
    : null
  if (learningSessionId && learningSetProgress?.feedbackUpdated) {
    learningSetProgress = await generateLearningFeedback(
      session.userId,
      learningSessionId,
      learningSetProgress
    )
  }

  return res.status(200).json({
    chatMessages,
    quizHistory,
    latestGeneratedQuizMemory:
      learningState?.latest_generated_quiz_memory || null,
    difyConversationId: learningState?.dify_conversation_id || '',
    learningSetProgress,
    activeLessonQuestionCount: questionCountResult.rows[0]?.total || 0,
    activeLessonMasteredQuestionIds:
      questionCountResult.rows[0]?.mastered_ids || [],
  })
}
