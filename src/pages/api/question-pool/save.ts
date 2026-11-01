import { NextApiRequest, NextApiResponse } from 'next'

import type { QuestionPoolItem } from '@/features/stores/home'
import { getLessonByDatasetId } from '@/config/lessons'
import type { UnderstandSkill } from '@/features/questionPool/types'
import { getSessionFromRequest } from '@/lib/server/auth'
import { isDatabaseConfigured, query } from '@/lib/server/db'

type SaveQuestionPoolItem = QuestionPoolItem & {
  lessonId?: string
  questionNumber?: number
  topic?: string
  sourceContext?: string
  sourceDatasetId?: string
  sourceDatasetName?: string
  sourceDocumentId?: string
  sourceDocumentName?: string
  sourceSegmentIds?: string[]
  aiOutput?: unknown
  isActive?: boolean
  variantFamilyId?: string
  variantIndex?: number
}

type SaveQuestionPoolRequest = {
  username?: string
  topic?: string
  sourceContext?: string
  item?: SaveQuestionPoolItem
  items?: SaveQuestionPoolItem[]
}

const getBearerToken = (req: NextApiRequest) => {
  const header = req.headers.authorization || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

const isQuestionPoolTokenAuthorized = (req: NextApiRequest) => {
  const configuredToken = process.env.QUESTION_POOL_API_TOKEN || ''
  if (!configuredToken) return false
  return getBearerToken(req) === configuredToken
}

const normalizeQuestionType = (raw: unknown): 'multiple_choice' | 'written' => {
  return raw === 'written' ? 'written' : 'multiple_choice'
}

const normalizeBloomLevel = (raw: unknown) => {
  return raw === 'remember' || raw === 'understand' ? raw : null
}

const normalizeUnderstandSkill = (raw: unknown): UnderstandSkill | null => {
  const value = String(raw || '').trim()
  return [
    'interpret',
    'exemplify',
    'classify',
    'summarize',
    'infer',
    'compare',
    'explain',
  ].includes(value)
    ? (value as UnderstandSkill)
    : null
}

const normalizeDifficultyLevel = (raw: unknown) => {
  const value = Number(raw)
  if (!Number.isFinite(value)) return 3
  return Math.max(1, Math.min(6, Math.round(value)))
}

const normalizeChoices = (raw: unknown) => {
  if (!Array.isArray(raw)) return []
  return raw
    .map((choice) => String(choice || '').trim())
    .filter((choice) => choice.length > 0)
}

const normalizeWrongAnswers = (raw: unknown) => {
  if (!Array.isArray(raw)) return []
  return raw
    .map((answer) => String(answer || '').trim())
    .filter((answer) => answer.length > 0)
}

const normalizeItem = (
  raw: SaveQuestionPoolItem,
  inherited: {
    topic?: string
    sourceContext?: string
    sourceDatasetId?: string
    sourceDatasetName?: string
    sourceDocumentId?: string
    sourceDocumentName?: string
    sourceSegmentIds?: string[]
  }
) => {
  const question = String(raw.question || '').trim()
  const questionType = normalizeQuestionType(raw.questionType)
  const bloomLevel =
    questionType === 'written'
      ? normalizeBloomLevel(raw.bloomLevel) === 'understand'
        ? 'understand'
        : null
      : 'remember'
  const understandSkill =
    bloomLevel === 'understand'
      ? normalizeUnderstandSkill(raw.understandSkill)
      : null
  const choices = normalizeChoices(raw.choices)
  const correctIndex =
    typeof raw.correctIndex === 'number' && raw.correctIndex >= 0
      ? raw.correctIndex
      : null
  const correctAnswer = String(raw.correctAnswer || '').trim()
  const explanation = String(raw.explanation || '').trim()
  const difficultyLevel = normalizeDifficultyLevel(raw.difficultyLevel)
  const questionGroup = String(raw.questionGroup || '').trim() || 'general'
  const topic = String(raw.topic || inherited.topic || '').trim()
  const sourceContext = String(
    raw.sourceContext || inherited.sourceContext || ''
  ).trim()
  const sourceDatasetId = String(
    raw.sourceDatasetId || inherited.sourceDatasetId || ''
  ).trim()
  const sourceDatasetName = String(
    raw.sourceDatasetName || inherited.sourceDatasetName || ''
  ).trim()
  const lessonId = getLessonByDatasetId(sourceDatasetId)?.id || 'legacy'
  const sourceDocumentId = String(
    raw.sourceDocumentId || inherited.sourceDocumentId || ''
  ).trim()
  const sourceDocumentName = String(
    raw.sourceDocumentName || inherited.sourceDocumentName || ''
  ).trim()
  const sourceSegmentIds = Array.isArray(
    raw.sourceSegmentIds || inherited.sourceSegmentIds
  )
    ? (raw.sourceSegmentIds || inherited.sourceSegmentIds || [])
        .map((id) => String(id).trim())
        .filter(Boolean)
    : []
  const aiOutput =
    raw.aiOutput === undefined ? null : JSON.stringify(raw.aiOutput)
  const wrongAnswers =
    normalizeWrongAnswers(raw.wrongAnswers).length > 0
      ? normalizeWrongAnswers(raw.wrongAnswers)
      : choices.filter((_, index) => index !== correctIndex)
  const variantFamilyId = String(raw.variantFamilyId || '').trim()
  const variantIndex = Number.isInteger(raw.variantIndex)
    ? Math.max(0, Number(raw.variantIndex))
    : 0

  if (!raw.id || !String(raw.id).trim()) {
    throw new Error('item.id is required')
  }
  if (!question) {
    throw new Error('item.question is required')
  }
  if (questionType === 'multiple_choice' && choices.length < 2) {
    throw new Error('multiple choice item requires at least 2 choices')
  }
  if (
    questionType === 'multiple_choice' &&
    (correctIndex === null || correctIndex >= choices.length)
  ) {
    throw new Error('multiple choice item requires a valid correctIndex')
  }
  if (
    questionType === 'multiple_choice' &&
    !correctAnswer &&
    correctIndex !== null &&
    !choices[correctIndex]
  ) {
    throw new Error('multiple choice item requires correctAnswer')
  }

  return {
    id: String(raw.id).trim(),
    questionType,
    bloomLevel,
    understandSkill,
    question,
    choices,
    correctIndex,
    correctAnswer:
      correctAnswer ||
      (correctIndex !== null && questionType === 'multiple_choice'
        ? choices[correctIndex]
        : ''),
    wrongAnswers,
    explanation: explanation || null,
    difficultyLevel,
    questionGroup,
    topic: topic || null,
    lessonId,
    sourceContext: sourceContext || null,
    sourceDatasetId: sourceDatasetId || null,
    sourceDatasetName: sourceDatasetName || null,
    sourceDocumentId: sourceDocumentId || null,
    sourceDocumentName: sourceDocumentName || null,
    sourceSegmentIds,
    questionNumber:
      typeof raw.questionNumber === 'number' &&
      Number.isInteger(raw.questionNumber) &&
      raw.questionNumber > 0
        ? raw.questionNumber
        : null,
    aiOutput,
    isActive: raw.isActive !== false,
    variantFamilyId: variantFamilyId || null,
    variantIndex,
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  if (!isDatabaseConfigured()) {
    return res.status(503).json({ message: 'DATABASE_URL is not set' })
  }

  const session = getSessionFromRequest(req)
  const tokenAuthorized = isQuestionPoolTokenAuthorized(req)

  if (!session && !tokenAuthorized) {
    return res.status(401).json({ message: 'Unauthorized' })
  }

  if (session && session.role !== 'admin' && !tokenAuthorized) {
    return res.status(403).json({ message: 'Admin only' })
  }

  const body = (req.body || {}) as SaveQuestionPoolRequest
  const rawItems = Array.isArray(body.items)
    ? body.items
    : body.item
      ? [body.item]
      : []

  if (rawItems.length === 0) {
    return res.status(400).json({ message: 'item or items is required' })
  }

  let userId = session?.userId || ''
  let username = session?.username || ''

  if (!userId) {
    const requestedUsername = String(body.username || '').trim()
    if (!requestedUsername) {
      return res
        .status(400)
        .json({ message: 'username is required for token-based requests' })
    }

    const userResult = await query<{ id: string; username: string }>(
      `
        SELECT id, username
        FROM profiles
        WHERE username = $1
        LIMIT 1
      `,
      [requestedUsername]
    )

    const user = userResult.rows[0]
    if (!user) {
      return res.status(404).json({ message: 'user not found' })
    }

    userId = user.id
    username = user.username
  }

  const normalizedItems = rawItems.map((item) =>
    normalizeItem(item, {
      topic: body.topic,
      sourceContext: body.sourceContext,
      sourceDatasetId: item.sourceDatasetId,
      sourceDatasetName: item.sourceDatasetName,
      sourceDocumentId: item.sourceDocumentId,
      sourceDocumentName: item.sourceDocumentName,
      sourceSegmentIds: item.sourceSegmentIds,
    })
  )

  const numberResult = await query<{ max: string }>(
    'SELECT COALESCE(MAX(question_number), 0)::text AS max FROM question_pool WHERE created_by_user_id = $1',
    [userId]
  )
  let nextQuestionNumber = Number(numberResult.rows[0]?.max || 0) + 1

  for (const item of normalizedItems) {
    const questionNumber = item.questionNumber || nextQuestionNumber++
    await query(
      `
        INSERT INTO question_pool (
          id,
          created_by_user_id,
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
          ai_output,
          source_context,
          question_number,
          source_dataset_id,
          source_dataset_name,
          source_document_id,
          source_document_name,
          source_segment_ids,
          variant_family_id,
          variant_index,
          is_active,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
          now(), now()
        )
        ON CONFLICT (id) DO UPDATE SET
          lesson_id = EXCLUDED.lesson_id,
          topic = EXCLUDED.topic,
          question_group = EXCLUDED.question_group,
          difficulty_level = EXCLUDED.difficulty_level,
          question_text = EXCLUDED.question_text,
          question_type = EXCLUDED.question_type,
          bloom_level = EXCLUDED.bloom_level,
          understand_skill = EXCLUDED.understand_skill,
          correct_answer = EXCLUDED.correct_answer,
          correct_index = EXCLUDED.correct_index,
          wrong_answers = EXCLUDED.wrong_answers,
          choices = EXCLUDED.choices,
          explanation = EXCLUDED.explanation,
          ai_output = EXCLUDED.ai_output,
          source_context = EXCLUDED.source_context,
          question_number = COALESCE(EXCLUDED.question_number, question_pool.question_number),
          source_dataset_id = EXCLUDED.source_dataset_id,
          source_dataset_name = EXCLUDED.source_dataset_name,
          source_document_id = EXCLUDED.source_document_id,
          source_document_name = EXCLUDED.source_document_name,
          source_segment_ids = EXCLUDED.source_segment_ids,
          variant_family_id = EXCLUDED.variant_family_id,
          variant_index = EXCLUDED.variant_index,
          is_active = EXCLUDED.is_active,
          updated_at = now()
      `,
      [
        item.id,
        userId,
        item.lessonId,
        item.topic,
        item.questionGroup,
        item.difficultyLevel,
        item.question,
        item.questionType,
        item.bloomLevel,
        item.understandSkill,
        item.correctAnswer,
        item.correctIndex,
        JSON.stringify(item.wrongAnswers),
        JSON.stringify(item.choices),
        item.explanation,
        item.aiOutput,
        item.sourceContext,
        questionNumber,
        item.sourceDatasetId,
        item.sourceDatasetName,
        item.sourceDocumentId,
        item.sourceDocumentName,
        JSON.stringify(item.sourceSegmentIds),
        item.variantFamilyId,
        item.variantIndex,
        item.isActive,
      ]
    )
  }

  return res.status(200).json({
    message: 'Question pool items saved',
    username,
    savedCount: normalizedItems.length,
    ids: normalizedItems.map((item) => item.id),
  })
}
