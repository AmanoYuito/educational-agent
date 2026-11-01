import { randomUUID } from 'crypto'

import type {
  LearningSetFeedback,
  LearningSetProgress,
} from '@/features/stores/home'
import {
  understandSkillLabels,
  type UnderstandSkill,
} from '@/features/questionPool/types'
import { ensureSchema, query } from './db'
import { sanitizeLearningFeedbackText } from './learningFeedbackText'

export const LEARNING_SET_TOTAL = 10

// 授業回を通して、4択2問→記述1問の順番を繰り返す。
export const questionTypeForSetIndex = (
  index: number
): 'multiple_choice' | 'written' =>
  index % 3 === 0 ? 'written' : 'multiple_choice'

type SessionRow = {
  id: string
  lesson_id: string
  total_questions: number
  completed_at: string | null
}

type AttemptRow = {
  question_type: 'multiple_choice' | 'written'
  understand_skill: UnderstandSkill | null
  question_group: string | null
  is_correct: boolean
  answer_status: 'correct' | 'incorrect' | 'unanswered'
  assessment_level: 'understood' | 'partial' | 'review' | null
}

type FeedbackTrend = 'improved' | 'stable' | 'declined' | 'new'

export type LearningSessionForIssue = {
  sessionId: string
  quizIndex: number
  total: number
  questionType: 'multiple_choice' | 'written'
  issuedQuestionPoolIds: string[]
  issuedUnderstandSkills: UnderstandSkill[]
}

export async function getLearningSessionForIssue(
  userId: string,
  lessonId: string
): Promise<LearningSessionForIssue> {
  await ensureSchema()
  const active = await query<SessionRow>(
    `SELECT id, lesson_id, total_questions, completed_at
     FROM learning_sessions
     WHERE user_id = $1 AND lesson_id = $2 AND completed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, lessonId]
  )
  let session = active.rows[0]
  if (!session) {
    const id = randomUUID()
    const created = await query<SessionRow>(
      `INSERT INTO learning_sessions (id, user_id, lesson_id, total_questions)
       VALUES ($1, $2, $3, $4)
       RETURNING id, lesson_id, total_questions, completed_at`,
      [id, userId, lessonId, LEARNING_SET_TOTAL]
    )
    session = created.rows[0]
  }

  const [issued, totalIssuedResult] = await Promise.all([
    query<{
      question_pool_id: string | null
      understand_skill: UnderstandSkill | null
    }>(
      `SELECT quiz->>'questionPoolId' AS question_pool_id,
              quiz->>'understandSkill' AS understand_skill
       FROM issued_quizzes
       WHERE user_id = $1 AND learning_session_id = $2
       ORDER BY created_at ASC`,
      [userId, session.id]
    ),
    query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM issued_quizzes AS iq
       INNER JOIN learning_sessions AS ls ON ls.id = iq.learning_session_id
       WHERE iq.user_id = $1 AND ls.lesson_id = $2`,
      [userId, lessonId]
    ),
  ])
  const issuedQuestionPoolIds = issued.rows
    .map((row) => row.question_pool_id)
    .filter((id): id is string => Boolean(id))
  const issuedUnderstandSkills = issued.rows
    .map((row) => row.understand_skill)
    .filter((skill): skill is UnderstandSkill => Boolean(skill))
  const quizIndex = issuedQuestionPoolIds.length + 1

  // 10問を終えた後は次の記録単位を開始する。出題形式の順番は授業回全体で継続する。
  if (quizIndex > session.total_questions) {
    await query(
      'UPDATE learning_sessions SET completed_at = COALESCE(completed_at, now()), updated_at = now() WHERE id = $1',
      [session.id]
    )
    return getLearningSessionForIssue(userId, lessonId)
  }

  const globalQuestionIndex = Number(totalIssuedResult.rows[0]?.count || 0) + 1
  return {
    sessionId: session.id,
    quizIndex,
    total: session.total_questions,
    questionType: questionTypeForSetIndex(globalQuestionIndex),
    issuedQuestionPoolIds,
    issuedUnderstandSkills,
  }
}

const questionGroupLabels: Record<string, string> = {
  general: '基本事項',
  process: 'プロセス',
  process_management: 'プロセス管理',
  process_state: 'プロセスの状態遷移',
  memory_layout: 'プロセスのメモリ構成',
  cpu_scheduling: 'CPUスケジューリング',
  scheduling: 'スケジューリング',
  thread: 'プロセスとスレッド',
  fork: 'forkシステムコール',
  mail_protocol: 'メールプロトコル',
}

const formatQuestionGroup = (value: string | null): string => {
  const normalized = String(value || 'general').trim() || 'general'
  return (
    questionGroupLabels[normalized.toLowerCase()] ||
    normalized.replace(/[_-]+/g, ' ')
  )
}

const correctCount = (attempts: AttemptRow[]) =>
  attempts.filter((attempt) => attempt.is_correct).length

const partialCount = (attempts: AttemptRow[]) =>
  attempts.filter((attempt) => attempt.assessment_level === 'partial').length

const accuracy = (attempts: AttemptRow[]) =>
  attempts.length
    ? (correctCount(attempts) + partialCount(attempts) * 0.5) / attempts.length
    : 0

const feedbackTrend = (
  currentAttempts: AttemptRow[],
  previousAttempts: AttemptRow[]
): FeedbackTrend => {
  if (!previousAttempts.length) return 'new'
  const difference = accuracy(currentAttempts) - accuracy(previousAttempts)
  if (difference >= 0.2) return 'improved'
  if (difference <= -0.2) return 'declined'
  return 'stable'
}

const memoryMessage = (
  attempts: AttemptRow[],
  previousAttempts: AttemptRow[],
  trend: FeedbackTrend
) => {
  const rate = accuracy(attempts)
  if (trend === 'improved')
    return '4択・記憶は前回までより正答率が上がっています。'
  if (trend === 'declined')
    return '4択・記憶は今回つまずきが見られました。基本事項を確認してみましょう。'
  if (rate >= 0.8)
    return previousAttempts.length
      ? '基本事項を引き続きよく記憶できています。'
      : '基本事項をよく記憶できています。'
  if (rate >= 0.6) return '基本事項はおおむね記憶できています。'
  return '基本事項を資料で見直してから、もう一度確かめてみましょう。'
}

const genreMessage = (
  label: string,
  status: 'achieved' | 'review',
  trend: FeedbackTrend
) => {
  if (trend === 'improved')
    return `「${label}」は前回までより正答率が上がっています。`
  if (trend === 'declined')
    return `「${label}」は今回つまずきが見られました。資料で確認してみましょう。`
  if (status === 'achieved')
    return trend === 'stable'
      ? `「${label}」は引き続きよくできています。`
      : `「${label}」はよくできています。`
  return `「${label}」は資料でもう一度確認してみましょう。`
}

const skillMessage = (
  skill: UnderstandSkill,
  status: 'achieved' | 'review' | 'not_attempted',
  trend: FeedbackTrend
) => {
  const label = understandSkillLabels[skill]
  const reviewMessages: Record<UnderstandSkill, string> = {
    interpret:
      '教材の表現が何を意味するか、自分の言葉で言い換えられるようにしよう。',
    exemplify:
      '教材の特徴に当てはまる身近な例を自分で考え、その理由も書けるようにしよう。',
    classify:
      '教材の特徴や条件を手がかりに、何がどの分類に当てはまるか整理できるようにしよう。',
    summarize: '教材の中心となる内容を選び、短くまとめられるようにしよう。',
    infer:
      '教材に示された事実や関係から、そこから分かることを考えられるようにしよう。',
    compare: '比べる対象の共通点と違いを分けて、言葉で説明できるようにしよう。',
    explain: '仕組みや理由のつながりを順番に説明できるようにしよう。',
  }
  const achievedMessages: Record<UnderstandSkill, string> = {
    interpret: '教材の内容を自分の言葉で捉えられています。',
    exemplify: '教材の特徴に当てはまる例と、その理由を考えられています。',
    classify: '教材の特徴や条件に沿って分類できています。',
    summarize: '教材の中心となる内容を選んでまとめられています。',
    infer: '教材に示された内容から分かることを考えられています。',
    compare: '比べる対象の共通点と違いを整理できています。',
    explain: '仕組みや理由のつながりを説明できています。',
  }
  if (status === 'not_attempted')
    return `${label}問題は今回まだ確認していません。`
  if (status === 'achieved') {
    const prefix =
      trend === 'improved'
        ? '前回までよりできるようになっています。'
        : trend === 'stable'
          ? '引き続き、'
          : ''
    return `${prefix}${achievedMessages[skill]}`
  }
  const prefix =
    trend === 'improved'
      ? '前回までよりできる部分が増えています。'
      : trend === 'declined'
        ? '今回は少し迷いが見られました。'
        : ''
  return `${prefix}${reviewMessages[skill]}`
}

const buildFeedback = (
  allAttempts: AttemptRow[],
  checkpointAnswered: number
): LearningSetFeedback => {
  const comprehensive = checkpointAnswered % 10 === 0
  const periodAnswered = comprehensive ? 10 : 5
  const periodStart = Math.max(0, checkpointAnswered - periodAnswered)
  const attempts = allAttempts.slice(periodStart, checkpointAnswered)
  const previousAttempts = allAttempts.slice(0, periodStart)
  const memoryAttempts = attempts.filter(
    (attempt) => attempt.question_type === 'multiple_choice'
  )
  const previousMemoryAttempts = previousAttempts.filter(
    (attempt) => attempt.question_type === 'multiple_choice'
  )
  const memoryTrend = feedbackTrend(memoryAttempts, previousMemoryAttempts)

  const genreMap = new Map<
    string,
    { label: string; attempts: AttemptRow[]; previousAttempts: AttemptRow[] }
  >()
  for (const attempt of attempts) {
    const key = String(attempt.question_group || 'general').trim() || 'general'
    const current = genreMap.get(key) || {
      label: formatQuestionGroup(key),
      attempts: [],
      previousAttempts: previousAttempts.filter(
        (previous) =>
          (String(previous.question_group || 'general').trim() || 'general') ===
          key
      ),
    }
    current.attempts.push(attempt)
    genreMap.set(key, current)
  }
  const genres: LearningSetFeedback['genres'] = Array.from(genreMap.entries())
    .map(([key, item]) => {
      const correct = correctCount(item.attempts)
      const partial = partialCount(item.attempts)
      const status: 'achieved' | 'review' =
        (correct + partial * 0.5) / item.attempts.length >= 0.7
          ? 'achieved'
          : 'review'
      const trend = feedbackTrend(item.attempts, item.previousAttempts)
      return {
        key,
        label: item.label,
        answered: item.attempts.length,
        correct,
        partial,
        status,
        trend,
        message: genreMessage(item.label, status, trend),
      }
    })
    .sort(
      (left, right) =>
        right.answered - left.answered || left.label.localeCompare(right.label)
    )

  const understanding: LearningSetFeedback['understanding'] = (
    Object.keys(understandSkillLabels) as UnderstandSkill[]
  ).map((skill) => {
    const skillAttempts = attempts.filter(
      (attempt) =>
        attempt.question_type === 'written' &&
        attempt.understand_skill === skill
    )
    const previousSkillAttempts = previousAttempts.filter(
      (attempt) =>
        attempt.question_type === 'written' &&
        attempt.understand_skill === skill
    )
    const correct = correctCount(skillAttempts)
    const partial = partialCount(skillAttempts)
    const count = skillAttempts.length
    const status =
      count === 0
        ? 'not_attempted'
        : (correct + partial * 0.5) / count >= 0.7
          ? 'achieved'
          : 'review'
    const trend = feedbackTrend(skillAttempts, previousSkillAttempts)
    return {
      skill,
      label: understandSkillLabels[skill],
      answered: count,
      correct,
      partial,
      status,
      trend,
      message: skillMessage(skill, status, trend),
    }
  })

  return {
    memory: {
      answered: memoryAttempts.length,
      correct: correctCount(memoryAttempts),
      partial: 0,
      trend: memoryTrend,
      message: memoryMessage(
        memoryAttempts,
        previousMemoryAttempts,
        memoryTrend
      ),
    },
    genres,
    understanding,
    checkpointAnswered,
    periodAnswered,
    comprehensive,
    message: comprehensive
      ? checkpointAnswered === 10
        ? '最初の10問から、できていることと次に取り組みたいことをまとめました。'
        : `直近10問とこれまでの回答を比べて、${checkpointAnswered}問時点でできていることをまとめました。`
      : `直近5問を前回までの回答と比べて、${checkpointAnswered}問時点の学びの変化をまとめました。`,
  }
}

export async function getLearningSetProgress(
  userId: string,
  sessionId: string
): Promise<LearningSetProgress | null> {
  const sessionResult = await query<SessionRow>(
    `SELECT id, lesson_id, total_questions, completed_at
     FROM learning_sessions WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [sessionId, userId]
  )
  const session = sessionResult.rows[0]
  if (!session) return null

  const [issuedResult, attemptsResult, allAttemptsResult] = await Promise.all([
    query<{ count: string }>(
      'SELECT count(*)::text AS count FROM issued_quizzes WHERE learning_session_id = $1 AND user_id = $2',
      [sessionId, userId]
    ),
    query<AttemptRow>(
      `SELECT question_type, understand_skill, question_group, is_correct, answer_status, assessment_level
       FROM quiz_attempts WHERE learning_session_id = $1 AND user_id = $2
       ORDER BY created_at ASC`,
      [sessionId, userId]
    ),
    query<AttemptRow>(
      `SELECT question_type, understand_skill, question_group, is_correct, answer_status, assessment_level
       FROM quiz_attempts
       WHERE user_id = $1 AND lesson_id = $2 AND learning_session_id IS NOT NULL
       ORDER BY created_at ASC`,
      [userId, session.lesson_id]
    ),
  ])
  const issued = Number(issuedResult.rows[0]?.count || 0)
  const scoredAttempts = attemptsResult.rows.filter(
    (attempt) => attempt.answer_status !== 'unanswered'
  )
  const allScoredAttempts = allAttemptsResult.rows.filter(
    (attempt) => attempt.answer_status !== 'unanswered'
  )
  const answered = scoredAttempts.length
  const cumulativeAnswered = allScoredAttempts.length
  const completed = issued >= session.total_questions
  if (completed && !session.completed_at) {
    await query(
      'UPDATE learning_sessions SET completed_at = now(), updated_at = now() WHERE id = $1 AND completed_at IS NULL',
      [sessionId]
    )
  }

  const checkpointAnswered =
    cumulativeAnswered >= 10 ? cumulativeAnswered - (cumulativeAnswered % 5) : 0
  const feedback = checkpointAnswered
    ? buildFeedback(allScoredAttempts, checkpointAnswered)
    : undefined
  if (feedback) {
    const cachedFeedback = await query<{ feedback_text: string }>(
      `SELECT feedback_text
       FROM learning_feedbacks
       WHERE user_id = $1 AND lesson_id = $2 AND checkpoint_answered = $3
       LIMIT 1`,
      [userId, session.lesson_id, checkpointAnswered]
    )
    if (cachedFeedback.rows[0]?.feedback_text) {
      feedback.llmMessage = sanitizeLearningFeedbackText(
        cachedFeedback.rows[0].feedback_text
      )
    }
  }

  return {
    sessionId,
    total: session.total_questions,
    issued,
    answered,
    cumulativeAnswered,
    completed,
    feedbackUpdated:
      checkpointAnswered >= 10 && cumulativeAnswered === checkpointAnswered,
    feedback,
  }
}
