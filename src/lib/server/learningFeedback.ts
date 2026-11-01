import { getLessonById } from '@/config/lessons'
import {
  understandSkillLabels,
  type UnderstandSkill,
} from '@/features/questionPool/types'
import type { LearningSetProgress } from '@/features/stores/home'
import { query } from './db'
import { sanitizeLearningFeedbackText } from './learningFeedbackText'

type FeedbackAttemptRow = {
  question: string
  question_type: 'multiple_choice' | 'written'
  understand_skill: UnderstandSkill | null
  question_group: string | null
  correct_answer: string | null
  user_answer: string
  is_correct: boolean
  assessment_level: 'understood' | 'partial' | 'review' | null
  score: number | null
  response_time_ms: number | null
  explanation: string | null
}

const feedbackEndpoint = () => {
  const base = String(process.env.DIFY_URL || 'https://api.dify.ai/v1')
    .trim()
    .replace(/\/$/, '')
  return base.endsWith('/chat-messages') ? base : `${base}/chat-messages`
}

const feedbackApiKey = () =>
  String(
    process.env.DIFY_FEEDBACK_API_KEY ||
      process.env.DIFY_API_KEY ||
      process.env.DIFY_KEY ||
      process.env.NEXT_PUBLIC_DIFY_API_KEY ||
      ''
  ).trim()

const extractFeedbackText = (data: any): string => {
  const raw = String(
    data?.answer ||
      data?.text ||
      data?.message ||
      data?.content ||
      data?.result ||
      ''
  ).trim()
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    const value = String(parsed?.feedback || parsed?.message || '').trim()
    if (value) return sanitizeLearningFeedbackText(value).slice(0, 2000)
  } catch {}
  return sanitizeLearningFeedbackText(
    raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  ).slice(0, 2000)
}

const compactTopic = (value: string, maxLength = 46): string => {
  const normalized = value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[。．.!！?？]+$/g, '')
    .trim()
  if (!normalized) return ''
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}…`
    : normalized
}

const fallbackFeedbackText = (
  recentAttempts: Array<{
    question: string
    isCorrect: boolean
    explanation: string
    understandSkill: UnderstandSkill | null
  }>
): string => {
  const correct = recentAttempts.find((attempt) => attempt.isCorrect)
  const incorrect = recentAttempts.filter((attempt) => !attempt.isCorrect)
  const sentences: string[] = []

  if (correct) {
    sentences.push(
      `今回の問題では、「${compactTopic(correct.question)}」に関する内容を確認できています。`
    )
  } else {
    sentences.push(
      '今回の問題に取り組んだことで、見直すポイントが見えてきました。'
    )
  }

  for (const attempt of incorrect.slice(0, 2)) {
    const skill = attempt.understandSkill
      ? `${understandSkillLabels[attempt.understandSkill]}問題の「`
      : '「'
    sentences.push(
      `${skill}${compactTopic(attempt.question)}」では、回答と正答の考え方にずれがありました。`
    )
  }

  const explanation = compactTopic(
    incorrect.find((attempt) => attempt.explanation)?.explanation || '',
    70
  )
  if (explanation) {
    sentences.push(
      `見直すときは、「${explanation}」という点を確かめてみましょう。`
    )
  }
  sentences.push(
    incorrect.length
      ? '次の5問では、間違えた内容を資料で一度確認してから答えてみましょう。'
      : '次の5問でも、同じ内容を別の聞かれ方で答えられるか確かめてみましょう。'
  )
  return sentences.join(' ')
}

const withFallbackFeedback = (
  progress: LearningSetProgress,
  recentAttempts: Array<{
    question: string
    isCorrect: boolean
    explanation: string
    understandSkill: UnderstandSkill | null
  }>
): LearningSetProgress => ({
  ...progress,
  feedback: progress.feedback
    ? {
        ...progress.feedback,
        llmMessage: fallbackFeedbackText(recentAttempts),
      }
    : progress.feedback,
})

const feedbackClaimsEvidenceIsMissing = (value: string | undefined) =>
  Boolean(
    value &&
      /(問題|正誤|回答).{0,32}(届いていない|届いていません|確認できない|情報がない)/.test(
        value
      )
  )

export async function generateLearningFeedback(
  userId: string,
  sessionId: string,
  progress: LearningSetProgress | null
): Promise<LearningSetProgress | null> {
  if (!progress?.feedbackUpdated || !progress.feedback) return progress
  if (
    progress.feedback.llmMessage &&
    !feedbackClaimsEvidenceIsMissing(progress.feedback.llmMessage)
  )
    return progress

  const key = feedbackApiKey()
  let fallbackAttempts: Array<{
    question: string
    isCorrect: boolean
    explanation: string
    understandSkill: UnderstandSkill | null
  }> = []

  try {
    const sessionResult = await query<{ lesson_id: string }>(
      `SELECT lesson_id
       FROM learning_sessions
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [sessionId, userId]
    )
    const lessonId = sessionResult.rows[0]?.lesson_id
    if (!lessonId) return progress

    const attemptsResult = await query<FeedbackAttemptRow>(
      `SELECT question, question_type, understand_skill, question_group,
              correct_answer, user_answer, is_correct, assessment_level,
              score, response_time_ms, explanation
       FROM quiz_attempts
       WHERE user_id = $1 AND lesson_id = $2 AND learning_session_id IS NOT NULL
       ORDER BY created_at ASC`,
      [userId, lessonId]
    )
    const checkpoint = progress.feedback.checkpointAnswered
    const period = progress.feedback.periodAnswered
    const periodStart = Math.max(0, checkpoint - period)
    const recentAttempts = attemptsResult.rows
      .slice(periodStart, checkpoint)
      .map((attempt, index) => ({
        number: periodStart + index + 1,
        genre: attempt.question_group || 'general',
        questionType: attempt.question_type,
        understandSkill: attempt.understand_skill,
        question: attempt.question.slice(0, 1000),
        userAnswer: attempt.user_answer.slice(0, 1000),
        correctAnswer: String(attempt.correct_answer || '').slice(0, 1000),
        isCorrect: attempt.is_correct,
        assessmentLevel: attempt.assessment_level,
        score: attempt.score,
        responseTimeMs: attempt.response_time_ms,
        explanation: String(attempt.explanation || '').slice(0, 1200),
      }))
    fallbackAttempts = recentAttempts
    if (!key) {
      console.warn('[learning-feedback] Dify API key is not configured')
      return withFallbackFeedback(progress, recentAttempts)
    }
    const evidence = {
      lesson: getLessonById(lessonId)?.title || lessonId,
      checkpointAnswered: checkpoint,
      periodAnswered: period,
      comprehensive: progress.feedback.comprehensive,
      aggregate: {
        memory: progress.feedback.memory,
        understanding: progress.feedback.understanding.filter(
          (item) => item.answered > 0
        ),
      },
      recentAttempts,
    }
    const learningFeedbackJson = JSON.stringify(evidence)

    const response = await fetch(feedbackEndpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: {
          mode: 'learning_feedback',
          learning_feedback_json: learningFeedbackJson,
        },
        query: [
          '今回の回答結果をもとに、学習者向けのフィードバックを作ってください。',
          '次のJSONには、評価対象になった実際の問題文、学習者の回答、正答・模範回答、正誤、記述問題の理解タイプが入っています。必ずこの内容を使ってください。',
          '授業名や授業回を本文に書かず、「今回の〇〇では」のような前置きも付けないでください。最初の文から回答結果と具体的な学習内容を伝えてください。',
          '<learning_feedback_data>',
          learningFeedbackJson,
          '</learning_feedback_data>',
        ].join('\n'),
        response_mode: 'blocking',
        user: `learning-feedback-${userId}`,
        files: [],
      }),
      signal: AbortSignal.timeout(180000),
    })
    if (!response.ok) {
      console.error(
        '[learning-feedback] Dify request failed:',
        response.status,
        (await response.text()).slice(0, 500)
      )
      return withFallbackFeedback(progress, recentAttempts)
    }

    const feedbackText = extractFeedbackText(await response.json())
    if (!feedbackText) return withFallbackFeedback(progress, recentAttempts)

    await query(
      `INSERT INTO learning_feedbacks (
         user_id, lesson_id, checkpoint_answered, feedback_text, evidence
       ) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (user_id, lesson_id, checkpoint_answered)
       DO UPDATE SET
         feedback_text = EXCLUDED.feedback_text,
         evidence = EXCLUDED.evidence,
         updated_at = now()`,
      [userId, lessonId, checkpoint, feedbackText, JSON.stringify(evidence)]
    )
    return {
      ...progress,
      feedback: { ...progress.feedback, llmMessage: feedbackText },
    }
  } catch (error) {
    console.error('[learning-feedback] Failed to generate feedback:', error)
    return fallbackAttempts.length
      ? withFallbackFeedback(progress, fallbackAttempts)
      : progress
  }
}
