import { randomUUID } from 'crypto'
import type { NextApiRequest, NextApiResponse } from 'next'
import type { QueryResultRow } from 'pg'

import { enabledLessons } from '@/config/lessons'
import type {
  ActivityLogItem,
  ActivityLogResponse,
  ActivityLogType,
  ActivityLogUsersResponse,
} from '@/features/admin/activityLogs'
import { understandSkillLabels } from '@/features/questionPool/types'
import { requireSession } from '@/lib/server/auth'
import {
  ensureLearningLogSchema,
  getPool,
  isDatabaseConfigured,
} from '@/lib/server/db'

type ActivityEventRow = {
  id: string
  event_type: ActivityLogType
  user_id: string
  username: string
  lesson_id: string
  created_at: string
  subtype: string | null
  content: string | null
  question: string | null
  user_answer: string | null
  correct_answer: string | null
  is_correct: boolean | null
  assessment_level: string | null
  score: number | null
  response_time_ms: number | null
  understand_skill: string | null
  difficulty_level: number | null
  question_group: string | null
  checkpoint_answered: number | null
  feedback_text: string | null
  duration_ms: number | null
  view_mode: string | null
  page_number: number | null
  page_count: number | null
  device_type: string | null
  os_name: string | null
  browser_name: string | null
  user_agent: string | null
  ip_hash: string | null
  metadata: Record<string, unknown> | null
}

type ActivitySummaryRow = {
  total_count: string
  chat_count: string
  quiz_count: string
  feedback_count: string
  quiz_correct_count: string
  quiz_partial_count: string
  quiz_review_count: string
  average_response_ms: string | null
  multiple_choice_count: string
  multiple_choice_correct_count: string
  written_count: string
  written_understood_count: string
  written_partial_count: string
  written_review_count: string
  activity_count: string
  active_time_ms: string
  material_time_ms: string
  avatar_time_ms: string
  quiz_time_ms: string
  conversation_time_ms: string
  material_page_views: string
  material_consults_during_quiz: string
}

type UserRow = { id: string; username: string }

type ActivityLogErrorResponse = {
  message: string
  requestId?: string
}

type SkillStatsRow = {
  understand_skill: string
  attempts: string
  understood: string
  partial: string
  review: string
  average_response_ms: string | null
}

type DeviceStatsRow = {
  device_type: string
  os_name: string
  browser_name: string
  events: string
  active_time_ms: string
}

const eventsCte = `
  WITH events AS (
    SELECT
      cm.id::text AS id,
      'chat'::text AS event_type,
      cm.user_id::text AS user_id,
      p.username::text AS username,
      cm.lesson_id::text AS lesson_id,
      cm.created_at::timestamptz AS created_at,
      cm.role::text AS subtype,
      cm.content::text AS content,
      NULL::text AS question,
      NULL::text AS user_answer,
      NULL::text AS correct_answer,
      NULL::boolean AS is_correct,
      NULL::text AS assessment_level,
      NULL::integer AS score,
      NULL::integer AS response_time_ms,
      NULL::text AS understand_skill,
      NULL::integer AS difficulty_level,
      NULL::text AS question_group,
      NULL::integer AS checkpoint_answered,
      NULL::text AS feedback_text,
      NULL::integer AS duration_ms,
      NULL::text AS view_mode,
      NULL::integer AS page_number,
      NULL::integer AS page_count,
      NULL::text AS device_type,
      NULL::text AS os_name,
      NULL::text AS browser_name,
      NULL::text AS user_agent,
      NULL::text AS ip_hash,
      NULL::jsonb AS metadata
    FROM chat_messages cm
    INNER JOIN profiles p ON p.id = cm.user_id

    UNION ALL

    SELECT
      qa.id::text AS id,
      'quiz'::text AS event_type,
      qa.user_id::text AS user_id,
      p.username::text AS username,
      qa.lesson_id::text AS lesson_id,
      qa.created_at::timestamptz AS created_at,
      qa.question_type::text AS subtype,
      qa.explanation::text AS content,
      qa.question::text AS question,
      qa.user_answer::text AS user_answer,
      qa.correct_answer::text AS correct_answer,
      qa.is_correct::boolean AS is_correct,
      qa.assessment_level::text AS assessment_level,
      qa.score::integer AS score,
      qa.response_time_ms::integer AS response_time_ms,
      qa.understand_skill::text AS understand_skill,
      qa.difficulty_level::integer AS difficulty_level,
      qa.question_group::text AS question_group,
      NULL::integer AS checkpoint_answered,
      NULL::text AS feedback_text,
      NULL::integer AS duration_ms,
      NULL::text AS view_mode,
      NULL::integer AS page_number,
      NULL::integer AS page_count,
      NULL::text AS device_type,
      NULL::text AS os_name,
      NULL::text AS browser_name,
      NULL::text AS user_agent,
      NULL::text AS ip_hash,
      NULL::jsonb AS metadata
    FROM quiz_attempts qa
    INNER JOIN profiles p ON p.id = qa.user_id

    UNION ALL

    SELECT
      CONCAT(lf.user_id, ':', lf.lesson_id, ':', lf.checkpoint_answered) AS id,
      'feedback'::text AS event_type,
      lf.user_id::text AS user_id,
      p.username::text AS username,
      lf.lesson_id::text AS lesson_id,
      lf.updated_at::timestamptz AS created_at,
      'learning_feedback'::text AS subtype,
      NULL::text AS content,
      NULL::text AS question,
      NULL::text AS user_answer,
      NULL::text AS correct_answer,
      NULL::boolean AS is_correct,
      NULL::text AS assessment_level,
      NULL::integer AS score,
      NULL::integer AS response_time_ms,
      NULL::text AS understand_skill,
      NULL::integer AS difficulty_level,
      NULL::text AS question_group,
      lf.checkpoint_answered::integer AS checkpoint_answered,
      lf.feedback_text::text AS feedback_text,
      NULL::integer AS duration_ms,
      NULL::text AS view_mode,
      NULL::integer AS page_number,
      NULL::integer AS page_count,
      NULL::text AS device_type,
      NULL::text AS os_name,
      NULL::text AS browser_name,
      NULL::text AS user_agent,
      NULL::text AS ip_hash,
      NULL::jsonb AS metadata
    FROM learning_feedbacks lf
    INNER JOIN profiles p ON p.id = lf.user_id

    UNION ALL

    SELECT
      lae.id::text AS id,
      'activity'::text AS event_type,
      lae.user_id::text AS user_id,
      p.username::text AS username,
      lae.lesson_id::text AS lesson_id,
      lae.created_at::timestamptz AS created_at,
      lae.event_type::text AS subtype,
      NULL::text AS content,
      NULL::text AS question,
      NULL::text AS user_answer,
      NULL::text AS correct_answer,
      NULL::boolean AS is_correct,
      NULL::text AS assessment_level,
      NULL::integer AS score,
      NULL::integer AS response_time_ms,
      NULL::text AS understand_skill,
      NULL::integer AS difficulty_level,
      NULL::text AS question_group,
      NULL::integer AS checkpoint_answered,
      NULL::text AS feedback_text,
      lae.duration_ms::integer AS duration_ms,
      lae.view_mode::text AS view_mode,
      lae.page_number::integer AS page_number,
      lae.page_count::integer AS page_count,
      lae.device_type::text AS device_type,
      lae.os_name::text AS os_name,
      lae.browser_name::text AS browser_name,
      lae.user_agent::text AS user_agent,
      lae.ip_hash::text AS ip_hash,
      lae.metadata::jsonb AS metadata
    FROM learning_activity_events lae
    INNER JOIN profiles p ON p.id = lae.user_id
  )
`

const readQueryValue = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value.trim() : ''

const readPositiveInteger = (
  value: string | string[] | undefined,
  fallback: number,
  maximum: number
) => {
  const parsed = Number(readQueryValue(value))
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback
}

const readDate = (value: string | string[] | undefined, endOfDay = false) => {
  const raw = readQueryValue(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return ''
  const date = new Date(
    `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+09:00`
  )
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

const assessmentLabel = (row: ActivityEventRow) => {
  if (row.event_type !== 'quiz') return ''
  if (row.assessment_level === 'understood') return '理解できている'
  if (row.assessment_level === 'partial') return '一部理解'
  if (row.assessment_level === 'review') return '要復習'
  return row.is_correct ? '正解' : '不正解'
}

const csvCell = (value: unknown) => {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

const toCsv = (rows: ActivityEventRow[]) => {
  const lessonNames = new Map(
    enabledLessons.map((lesson) => [lesson.id, lesson.title])
  )
  const headers = [
    '日時',
    'ユーザー名',
    'ユーザーID',
    '授業回',
    '種別',
    '問題形式・発言者',
    '理解の問い方',
    '出題分野',
    '難易度',
    '問題文',
    '学習者の回答',
    '正答・模範回答',
    '判定',
    '得点',
    '回答時間（秒）',
    '内容・解説・フィードバック',
    '回答節目',
    '活動時間（秒）',
    '表示画面',
    '資料ページ',
    '端末種別',
    'OS',
    'ブラウザ',
    '匿名化IP',
    'User-Agent',
    '追加情報',
  ]
  const typeLabels: Record<ActivityLogType, string> = {
    chat: '会話',
    quiz: '問題回答',
    feedback: '学習フィードバック',
    activity: '学習行動',
  }
  const lines = rows.map((row) =>
    [
      row.created_at,
      row.username,
      row.user_id,
      lessonNames.get(row.lesson_id) ||
        (row.lesson_id === 'legacy' ? '旧データ' : row.lesson_id),
      typeLabels[row.event_type],
      row.subtype || '',
      row.understand_skill
        ? understandSkillLabels[
            row.understand_skill as keyof typeof understandSkillLabels
          ] || row.understand_skill
        : '',
      row.question_group || '',
      row.difficulty_level ?? '',
      row.question || '',
      row.user_answer || '',
      row.correct_answer || '',
      assessmentLabel(row),
      row.score ?? '',
      typeof row.response_time_ms === 'number'
        ? Math.round(row.response_time_ms / 100) / 10
        : '',
      row.event_type === 'feedback'
        ? row.feedback_text || ''
        : row.content || '',
      row.checkpoint_answered ?? '',
      typeof row.duration_ms === 'number'
        ? Math.round(row.duration_ms / 100) / 10
        : '',
      row.view_mode || '',
      row.page_number ?? '',
      row.device_type || '',
      row.os_name || '',
      row.browser_name || '',
      row.ip_hash || '',
      row.user_agent || '',
      row.metadata ? JSON.stringify(row.metadata) : '',
    ]
      .map(csvCell)
      .join(',')
  )
  return `\uFEFF${[headers.map(csvCell).join(','), ...lines].join('\r\n')}`
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    | ActivityLogResponse
    | ActivityLogUsersResponse
    | ActivityLogErrorResponse
    | string
  >
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const session = requireSession(req, res)
  if (!session) return
  if (session.role !== 'admin') {
    return res.status(403).json({ message: 'Admin only' })
  }
  if (!isDatabaseConfigured()) {
    return res.status(503).json({ message: 'DATABASE_URL is not set' })
  }

  const view = readQueryValue(req.query.view)
  if (view && view !== 'users') {
    return res.status(400).json({ message: '表示種別を確認してください。' })
  }

  const requestId = randomUUID()
  try {
    const logQuery = <T extends QueryResultRow = QueryResultRow>(
      text: string,
      values: unknown[] = []
    ) => getPool().query<T>(text, values)

    if (view === 'users') {
      const usersResult = await logQuery<UserRow>(
        `SELECT id::text AS id, username::text AS username
         FROM profiles
         ORDER BY username ASC
         LIMIT 500`
      )
      return res.status(200).json({ users: usersResult.rows })
    }

    // ログ画面に必要な列とテーブルだけを先に整える。問題プールなど
    // 他機能のスキーマ更新に失敗しても、学習ログの閲覧を止めない。
    await ensureLearningLogSchema()

    const page = readPositiveInteger(req.query.page, 1, 100000)
    const pageSize = readPositiveInteger(req.query.pageSize, 25, 100)
    const lessonId = readQueryValue(req.query.lessonId)
    const userId = readQueryValue(req.query.userId)
    const type = readQueryValue(req.query.type)
    const search = readQueryValue(req.query.search).slice(0, 200)
    const from = readDate(req.query.from)
    const to = readDate(req.query.to, true)
    const format = readQueryValue(req.query.format)

    if (
      lessonId &&
      lessonId !== 'legacy' &&
      !enabledLessons.some((lesson) => lesson.id === lessonId)
    ) {
      return res.status(400).json({ message: '授業回を確認してください。' })
    }
    if (type && !['chat', 'quiz', 'feedback', 'activity'].includes(type)) {
      return res.status(400).json({ message: 'ログ種別を確認してください。' })
    }
    if (format && format !== 'csv') {
      return res.status(400).json({ message: '出力形式を確認してください。' })
    }

    const params: unknown[] = []
    const conditions: string[] = []
    const addCondition = (sql: string, value: unknown) => {
      params.push(value)
      conditions.push(sql.replace('?', `$${params.length}`))
    }
    if (lessonId) addCondition('lesson_id = ?', lessonId)
    if (userId) addCondition('user_id = ?', userId)
    if (type) addCondition('event_type = ?', type)
    if (from) addCondition('created_at >= ?', from)
    if (to) addCondition('created_at <= ?', to)
    if (search) {
      params.push(`%${search}%`)
      const index = params.length
      conditions.push(`(
      username ILIKE $${index}
      OR COALESCE(content, '') ILIKE $${index}
      OR COALESCE(question, '') ILIKE $${index}
      OR COALESCE(user_answer, '') ILIKE $${index}
      OR COALESCE(correct_answer, '') ILIKE $${index}
      OR COALESCE(feedback_text, '') ILIKE $${index}
      OR COALESCE(subtype, '') ILIKE $${index}
      OR COALESCE(device_type, '') ILIKE $${index}
      OR COALESCE(os_name, '') ILIKE $${index}
      OR COALESCE(browser_name, '') ILIKE $${index}
      OR COALESCE(ip_hash, '') ILIKE $${index}
      OR COALESCE(metadata::text, '') ILIKE $${index}
    )`)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const filterParams = [...params]

    if (format === 'csv') {
      const csvResult = await logQuery<ActivityEventRow>(
        `${eventsCte}
       SELECT * FROM events
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT 50000`,
        filterParams
      )
      const date = new Date().toISOString().slice(0, 10)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="learning-logs-${date}.csv"`
      )
      return res.status(200).send(toCsv(csvResult.rows))
    }

    params.push(pageSize, (page - 1) * pageSize)
    const limitIndex = params.length - 1
    const offsetIndex = params.length

    const logsSql = `${eventsCte}
      SELECT * FROM events
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`

    const summarySql = `${eventsCte}, filtered AS (
      SELECT * FROM events
      ${where}
    )
    SELECT
      COUNT(*)::text AS total_count,
      COUNT(*) FILTER (WHERE event_type = 'chat')::text AS chat_count,
      COUNT(*) FILTER (WHERE event_type = 'quiz')::text AS quiz_count,
      COUNT(*) FILTER (WHERE event_type = 'feedback')::text AS feedback_count,
      COUNT(*) FILTER (WHERE event_type = 'activity')::text AS activity_count,
      COALESCE(SUM(duration_ms) FILTER (WHERE event_type = 'activity' AND subtype = 'active_time'), 0)::text AS active_time_ms,
      COALESCE(SUM(duration_ms) FILTER (WHERE event_type = 'activity' AND subtype = 'active_time' AND view_mode = 'material'), 0)::text AS material_time_ms,
      COALESCE(SUM(duration_ms) FILTER (WHERE event_type = 'activity' AND subtype = 'active_time' AND view_mode = 'avatar'), 0)::text AS avatar_time_ms,
      COALESCE(SUM(duration_ms) FILTER (WHERE event_type = 'activity' AND subtype = 'active_time' AND metadata->>'isProblemMode' = 'true'), 0)::text AS quiz_time_ms,
      COALESCE(SUM(duration_ms) FILTER (WHERE event_type = 'activity' AND subtype = 'active_time' AND metadata->>'isProblemMode' = 'false'), 0)::text AS conversation_time_ms,
      COUNT(*) FILTER (WHERE event_type = 'activity' AND subtype = 'material_page_view')::text AS material_page_views,
      COUNT(*) FILTER (WHERE event_type = 'activity' AND subtype = 'material_page_view' AND metadata->>'consultedDuringQuiz' = 'true')::text AS material_consults_during_quiz,
      COUNT(*) FILTER (WHERE event_type = 'quiz' AND is_correct = TRUE)::text AS quiz_correct_count,
      COUNT(*) FILTER (WHERE event_type = 'quiz' AND assessment_level = 'partial')::text AS quiz_partial_count,
      COUNT(*) FILTER (
        WHERE event_type = 'quiz'
          AND (assessment_level = 'review' OR (assessment_level IS NULL AND is_correct = FALSE))
      )::text AS quiz_review_count,
      ROUND(AVG(response_time_ms) FILTER (WHERE event_type = 'quiz'))::text AS average_response_ms,
      COUNT(*) FILTER (WHERE event_type = 'quiz' AND subtype = 'multiple_choice')::text AS multiple_choice_count,
      COUNT(*) FILTER (WHERE event_type = 'quiz' AND subtype = 'multiple_choice' AND is_correct = TRUE)::text AS multiple_choice_correct_count,
      COUNT(*) FILTER (WHERE event_type = 'quiz' AND subtype = 'written')::text AS written_count,
      COUNT(*) FILTER (
        WHERE event_type = 'quiz' AND subtype = 'written'
          AND (assessment_level = 'understood' OR (assessment_level IS NULL AND is_correct = TRUE))
      )::text AS written_understood_count,
      COUNT(*) FILTER (WHERE event_type = 'quiz' AND subtype = 'written' AND assessment_level = 'partial')::text AS written_partial_count,
      COUNT(*) FILTER (
        WHERE event_type = 'quiz' AND subtype = 'written'
          AND (assessment_level = 'review' OR (assessment_level IS NULL AND is_correct = FALSE))
      )::text AS written_review_count
    FROM filtered`

    const [logsResult, summaryResult, usersResult] = await Promise.all([
      logQuery<ActivityEventRow>(logsSql, params),
      logQuery<ActivitySummaryRow>(summarySql, filterParams),
      logQuery<UserRow>(
        `SELECT id::text AS id, username::text AS username
         FROM profiles
         ORDER BY username ASC
         LIMIT 500`
      ),
    ])

    // 詳細分析の一部に問題があっても、基本ログと集計は表示する。
    const [skillsSettled, devicesSettled] = await Promise.allSettled([
      logQuery<SkillStatsRow>(
        `${eventsCte}
         SELECT
           understand_skill,
           COUNT(*)::text AS attempts,
           COUNT(*) FILTER (
             WHERE assessment_level = 'understood'
               OR (assessment_level IS NULL AND is_correct = TRUE)
           )::text AS understood,
           COUNT(*) FILTER (WHERE assessment_level = 'partial')::text AS partial,
           COUNT(*) FILTER (
             WHERE assessment_level = 'review'
               OR (assessment_level IS NULL AND is_correct = FALSE)
           )::text AS review,
           ROUND(AVG(response_time_ms))::text AS average_response_ms
         FROM events
         ${where ? `${where} AND` : 'WHERE'} event_type = 'quiz'
           AND subtype = 'written'
           AND NULLIF(understand_skill, '') IS NOT NULL
         GROUP BY understand_skill
         ORDER BY understand_skill`,
        filterParams
      ),
      logQuery<DeviceStatsRow>(
        `${eventsCte}
         SELECT
           COALESCE(device_type, '不明') AS device_type,
           COALESCE(os_name, '不明') AS os_name,
           COALESCE(browser_name, '不明') AS browser_name,
           COUNT(*)::text AS events,
           COALESCE(SUM(duration_ms) FILTER (WHERE subtype = 'active_time'), 0)::text AS active_time_ms
         FROM events
         ${where ? `${where} AND` : 'WHERE'} event_type = 'activity'
         GROUP BY device_type, os_name, browser_name
         ORDER BY SUM(duration_ms) FILTER (WHERE subtype = 'active_time') DESC NULLS LAST, COUNT(*) DESC
         LIMIT 20`,
        filterParams
      ),
    ])

    const skillsResult =
      skillsSettled.status === 'fulfilled' ? skillsSettled.value : null
    const devicesResult =
      devicesSettled.status === 'fulfilled' ? devicesSettled.value : null
    if (skillsSettled.status === 'rejected')
      console.error('Failed to load skill stats:', skillsSettled.reason)
    if (devicesSettled.status === 'rejected')
      console.error('Failed to load device stats:', devicesSettled.reason)

    const first = summaryResult.rows[0]
    const total = Number(first?.total_count || 0)
    const items: ActivityLogItem[] = logsResult.rows.map((row) => ({
      id: row.id,
      type: row.event_type,
      userId: row.user_id,
      username: row.username,
      lessonId: row.lesson_id,
      createdAt: row.created_at,
      subtype: row.subtype || '',
      content: row.content || '',
      question: row.question || '',
      userAnswer: row.user_answer || '',
      correctAnswer: row.correct_answer || '',
      isCorrect: row.is_correct,
      assessmentLevel: row.assessment_level || '',
      score: row.score,
      responseTimeMs: row.response_time_ms,
      understandSkill: row.understand_skill || '',
      difficultyLevel: row.difficulty_level,
      questionGroup: row.question_group || '',
      checkpointAnswered: row.checkpoint_answered,
      feedbackText: row.feedback_text || '',
      durationMs: row.duration_ms,
      viewMode: row.view_mode || '',
      pageNumber: row.page_number,
      pageCount: row.page_count,
      deviceType: row.device_type || '',
      osName: row.os_name || '',
      browserName: row.browser_name || '',
      userAgent: row.user_agent || '',
      ipHash: row.ip_hash || '',
      metadata: row.metadata || {},
    }))

    return res.status(200).json({
      items,
      users: usersResult.rows,
      stats: {
        total,
        chat: Number(first?.chat_count || 0),
        quiz: Number(first?.quiz_count || 0),
        feedback: Number(first?.feedback_count || 0),
        quizCorrect: Number(first?.quiz_correct_count || 0),
        quizPartial: Number(first?.quiz_partial_count || 0),
        quizReview: Number(first?.quiz_review_count || 0),
        averageResponseMs: first?.average_response_ms
          ? Number(first.average_response_ms)
          : null,
        multipleChoice: Number(first?.multiple_choice_count || 0),
        multipleChoiceCorrect: Number(
          first?.multiple_choice_correct_count || 0
        ),
        written: Number(first?.written_count || 0),
        writtenUnderstood: Number(first?.written_understood_count || 0),
        writtenPartial: Number(first?.written_partial_count || 0),
        writtenReview: Number(first?.written_review_count || 0),
        activity: Number(first?.activity_count || 0),
        activeTimeMs: Number(first?.active_time_ms || 0),
        materialTimeMs: Number(first?.material_time_ms || 0),
        avatarTimeMs: Number(first?.avatar_time_ms || 0),
        quizTimeMs: Number(first?.quiz_time_ms || 0),
        conversationTimeMs: Number(first?.conversation_time_ms || 0),
        materialPageViews: Number(first?.material_page_views || 0),
        materialConsultsDuringQuiz: Number(
          first?.material_consults_during_quiz || 0
        ),
      },
      skills: (skillsResult?.rows || []).map((row) => ({
        skill: row.understand_skill,
        attempts: Number(row.attempts || 0),
        understood: Number(row.understood || 0),
        partial: Number(row.partial || 0),
        review: Number(row.review || 0),
        averageResponseMs: row.average_response_ms
          ? Number(row.average_response_ms)
          : null,
      })),
      devices: (devicesResult?.rows || []).map((row) => ({
        deviceType: row.device_type,
        osName: row.os_name,
        browserName: row.browser_name,
        events: Number(row.events || 0),
        activeTimeMs: Number(row.active_time_ms || 0),
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  } catch (error) {
    console.error(`Failed to load activity logs [${requestId}]:`, error)
    return res.status(500).json({
      message:
        '学習ログを取得できませんでした。DBの更新状態を確認してください。',
      requestId,
    })
  }
}
