import { NextApiRequest, NextApiResponse } from 'next'

import { requireSession } from '@/lib/server/auth'
import { isDatabaseConfigured, query } from '@/lib/server/db'
import {
  understandSkillLabels,
  type UnderstandSkill,
} from '@/features/questionPool/types'

type QuestionPoolManageRow = {
  id: string
  lesson_id: string
  topic: string | null
  question_group: string
  difficulty_level: number
  question_text: string
  question_type: 'multiple_choice' | 'written'
  bloom_level: 'remember' | 'understand' | null
  understand_skill: UnderstandSkill | null
  correct_answer: string
  correct_index: number | null
  wrong_answers: string[] | null
  choices: string[] | null
  explanation: string | null
  source_context: string | null
  question_number: number | null
  source_dataset_id: string | null
  source_dataset_name: string | null
  source_document_id: string | null
  source_document_name: string | null
  source_segment_ids: string[] | null
  variant_family_id: string | null
  variant_index: number
  ai_output: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

type PoolCountsRow = {
  total: string
  active: string
  multiple_choice: string
  written_remember: string
  written_understand: string
  written_unclassified: string
}

type UnderstandSkillCountRow = {
  understand_skill: UnderstandSkill
  count: string
}

type CoverageRow = {
  section: string
  registered: string
  asked_questions: string
  attempts: string
  correct: string
  partial: string
  learners: string
  average_response_ms: string | null
}

type ClassTypeRow = CoverageRow & {
  question_type: 'multiple_choice' | 'written'
  understand_skill: UnderstandSkill | null
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!['GET', 'PATCH', 'DELETE'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, PATCH, DELETE')
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

  if (req.method === 'PATCH') {
    const id = typeof req.body?.id === 'string' ? req.body.id.trim() : ''
    const bloomLevel = req.body?.bloomLevel
    if (!id || id.length > 200) {
      return res.status(400).json({ message: '問題の指定が正しくありません。' })
    }
    if (bloomLevel !== 'remember' && bloomLevel !== 'understand') {
      return res.status(400).json({ message: '認知レベルを選択してください。' })
    }

    const result = await query(
      `UPDATE question_pool
       SET bloom_level = $1, updated_at = now()
       WHERE id = $2
       RETURNING id`,
      [bloomLevel, id]
    )
    if (!result.rowCount) {
      return res.status(404).json({ message: '問題が見つかりません。' })
    }
    return res.status(200).json({ id, bloomLevel })
  }

  if (req.method === 'DELETE') {
    const id = typeof req.body?.id === 'string' ? req.body.id.trim() : ''
    if (!id || id.length > 200) {
      return res.status(400).json({ message: '問題の指定が正しくありません。' })
    }

    const result = await query<{ id: string }>(
      `DELETE FROM question_pool
       WHERE id = $1
       RETURNING id`,
      [id]
    )
    if (!result.rowCount) {
      return res.status(404).json({ message: '問題が見つかりません。' })
    }

    return res.status(200).json({ id, deleted: true })
  }

  const lessonId =
    typeof req.query.lessonId === 'string' &&
    req.query.lessonId.trim() &&
    req.query.lessonId !== 'all'
      ? req.query.lessonId.trim()
      : ''
  const params = lessonId ? [lessonId] : []
  const where = lessonId ? 'WHERE lesson_id = $1' : ''

  const [
    itemsResult,
    countsResult,
    understandSkillCountsResult,
    coverageResult,
    classTypeResult,
  ] = await Promise.all([
    query<QuestionPoolManageRow>(
      `
        SELECT
          id,
          lesson_id,
          topic,
          question_group,
          difficulty_level,
          question_text,
          question_type,
          bloom_level,
          understand_skill,
          correct_answer,
          correct_index,
          wrong_answers,
          choices,
          explanation,
          source_context,
          question_number,
          source_dataset_id,
          source_dataset_name,
          source_document_id,
          source_document_name,
          source_segment_ids,
          variant_family_id,
          variant_index,
          ai_output,
          is_active,
          created_at,
          updated_at
        FROM question_pool
        ${where}
        ORDER BY updated_at DESC
        LIMIT 100
      `,
      params
    ),
    query<PoolCountsRow>(
      `
        SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE is_active = TRUE)::text AS active,
          COUNT(*) FILTER (WHERE question_type = 'multiple_choice')::text AS multiple_choice,
          COUNT(*) FILTER (
            WHERE question_type = 'written' AND bloom_level = 'remember'
          )::text AS written_remember,
          COUNT(*) FILTER (
            WHERE question_type = 'written' AND bloom_level = 'understand'
          )::text AS written_understand,
          COUNT(*) FILTER (
            WHERE question_type = 'written'
              AND (bloom_level IS NULL OR bloom_level NOT IN ('remember', 'understand'))
          )::text AS written_unclassified
        FROM question_pool
        ${where}
      `,
      params
    ),
    query<UnderstandSkillCountRow>(
      `
        SELECT understand_skill, COUNT(*)::text AS count
        FROM question_pool
        ${where ? `${where} AND` : 'WHERE'} question_type = 'written'
          AND bloom_level = 'understand'
          AND understand_skill IN ('interpret', 'exemplify', 'classify', 'summarize', 'infer', 'compare', 'explain')
        GROUP BY understand_skill
      `,
      params
    ),
    query<CoverageRow>(
      `SELECT
           COALESCE(NULLIF(BTRIM(qp.question_group), ''), '全般') AS section,
           COUNT(DISTINCT qp.id)::text AS registered,
           COUNT(DISTINCT qa.question_pool_id)::text AS asked_questions,
           COUNT(qa.id)::text AS attempts,
           COUNT(qa.id) FILTER (WHERE qa.is_correct = TRUE)::text AS correct,
           COUNT(qa.id) FILTER (WHERE qa.assessment_level = 'partial')::text AS partial,
           COUNT(DISTINCT qa.user_id)::text AS learners,
           ROUND(AVG(qa.response_time_ms))::text AS average_response_ms
         FROM question_pool qp
         LEFT JOIN quiz_attempts qa
           ON qa.question_pool_id = qp.id AND qa.lesson_id = qp.lesson_id
         ${lessonId ? 'WHERE qp.lesson_id = $1' : ''}
         GROUP BY COALESCE(NULLIF(BTRIM(qp.question_group), ''), '全般')
         ORDER BY COUNT(DISTINCT qp.id) DESC, section ASC`,
      params
    ),
    query<ClassTypeRow>(
      `SELECT
           CASE
             WHEN qp.question_type = 'multiple_choice' THEN '4択・記憶'
             ELSE COALESCE(qp.understand_skill, '理解・未分類')
           END AS section,
           qp.question_type,
           qp.understand_skill,
           COUNT(DISTINCT qp.id)::text AS registered,
           COUNT(DISTINCT qa.question_pool_id)::text AS asked_questions,
           COUNT(qa.id)::text AS attempts,
           COUNT(qa.id) FILTER (WHERE qa.is_correct = TRUE)::text AS correct,
           COUNT(qa.id) FILTER (WHERE qa.assessment_level = 'partial')::text AS partial,
           COUNT(DISTINCT qa.user_id)::text AS learners,
           ROUND(AVG(qa.response_time_ms))::text AS average_response_ms
         FROM question_pool qp
         LEFT JOIN quiz_attempts qa
           ON qa.question_pool_id = qp.id AND qa.lesson_id = qp.lesson_id
         ${lessonId ? 'WHERE qp.lesson_id = $1' : ''}
         GROUP BY qp.question_type, qp.understand_skill
         ORDER BY qp.question_type, qp.understand_skill NULLS FIRST`,
      params
    ),
  ])

  const counts = countsResult.rows[0] || {
    total: '0',
    active: '0',
    multiple_choice: '0',
    written_remember: '0',
    written_understand: '0',
    written_unclassified: '0',
  }

  return res.status(200).json({
    stats: {
      total: Number(counts.total || 0),
      active: Number(counts.active || 0),
      multipleChoice: Number(counts.multiple_choice || 0),
      writtenRemember: Number(counts.written_remember || 0),
      writtenUnderstand: Number(counts.written_understand || 0),
      writtenUnclassified: Number(counts.written_unclassified || 0),
      understandBySkill: understandSkillCountsResult.rows.reduce<
        Partial<Record<UnderstandSkill, number>>
      >((result, row) => {
        result[row.understand_skill] = Number(row.count || 0)
        return result
      }, {}),
    },
    coverage: (coverageResult?.rows || []).map((row) => ({
      section: row.section,
      registered: Number(row.registered || 0),
      askedQuestions: Number(row.asked_questions || 0),
      attempts: Number(row.attempts || 0),
      correct: Number(row.correct || 0),
      partial: Number(row.partial || 0),
      learners: Number(row.learners || 0),
      averageResponseMs: row.average_response_ms
        ? Number(row.average_response_ms)
        : null,
    })),
    classSummary: (classTypeResult?.rows || []).map((row) => ({
      key:
        row.question_type === 'multiple_choice'
          ? 'multiple_choice'
          : row.understand_skill || 'written_unclassified',
      label:
        row.question_type === 'multiple_choice'
          ? '4択・記憶'
          : row.understand_skill
            ? understandSkillLabels[row.understand_skill]
            : '記述・未分類',
      registered: Number(row.registered || 0),
      attempts: Number(row.attempts || 0),
      correct: Number(row.correct || 0),
      partial: Number(row.partial || 0),
      learners: Number(row.learners || 0),
      averageResponseMs: row.average_response_ms
        ? Number(row.average_response_ms)
        : null,
    })),
    items: itemsResult.rows.map((row) => ({
      id: row.id,
      lessonId: row.lesson_id,
      topic: row.topic || '',
      questionGroup: row.question_group,
      difficultyLevel: row.difficulty_level,
      question: row.question_text,
      questionType: row.question_type,
      bloomLevel: row.bloom_level,
      understandSkill: row.understand_skill,
      correctAnswer: row.correct_answer,
      correctIndex: row.correct_index,
      wrongAnswers: row.wrong_answers || [],
      choices: row.choices || [],
      explanation: row.explanation || '',
      sourceContext: row.source_context || '',
      questionNumber: row.question_number,
      sourceDatasetId: row.source_dataset_id || '',
      sourceDatasetName: row.source_dataset_name || '',
      sourceDocumentId: row.source_document_id || '',
      sourceDocumentName: row.source_document_name || '',
      sourceSegmentIds: row.source_segment_ids || [],
      variantFamilyId: row.variant_family_id || '',
      variantIndex: row.variant_index,
      aiOutput: row.ai_output || '',
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  })
}
