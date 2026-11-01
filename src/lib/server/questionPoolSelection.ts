import type { QuestionPoolItem } from '@/features/stores/home'
import { query } from '@/lib/server/db'
import { issueQuiz } from '@/lib/server/quizGrading'
import { savedMaterialSource } from '@/lib/server/quizSources'
import type { UnderstandSkill } from '@/features/questionPool/types'

export type QuestionPoolRow = {
  lesson_id: string
  source_context: string | null
  id: string
  question_type: 'multiple_choice' | 'written'
  question_text: string
  choices: string[] | null
  correct_index: number | null
  correct_answer: string | null
  wrong_answers: string[] | null
  explanation: string | null
  difficulty_level: number
  question_group: string
  topic: string | null
  source_dataset_id: string | null
  source_dataset_name: string | null
  /** Difyの親チャンクを含む、作問時に参照した教材区切り。 */
  source_segment_ids?: string[] | null
  understand_skill?: UnderstandSkill | null
}

export type QuestionPoolSelection = {
  learnerId: string
  lessonId: string
  datasetId: string
  topic?: string
  difficulty?: number | null
  questionType?: 'multiple_choice' | 'written'
  excludeQuestionPoolIds?: string[]
  excludeUnderstandSkills?: UnderstandSkill[]
}

type RecentAttemptRow = {
  difficulty_level: number | null
  question_type: 'multiple_choice' | 'written'
  is_correct: boolean
  assessment_level: 'understood' | 'partial' | 'review' | null
  response_time_ms: number | null
}

const isFluentAttempt = (attempt: RecentAttemptRow) => {
  const limit = attempt.question_type === 'written' ? 3 * 60 * 1000 : 60 * 1000
  return (
    attempt.is_correct &&
    attempt.assessment_level !== 'partial' &&
    attempt.assessment_level !== 'review' &&
    (attempt.response_time_ms === null || attempt.response_time_ms <= limit)
  )
}

export async function getAdaptiveDifficulty(
  learnerId: string,
  lessonId: string,
  questionType: 'multiple_choice' | 'written'
) {
  const recent = await query<RecentAttemptRow>(
    `SELECT difficulty_level, question_type, is_correct, assessment_level, response_time_ms
     FROM quiz_attempts
     WHERE user_id = $1 AND lesson_id = $2 AND question_type = $3
     ORDER BY created_at DESC
     LIMIT 5`,
    [learnerId, lessonId, questionType]
  )
  if (!recent.rows.length) return 3
  const latest = recent.rows[0]
  const current = Math.max(1, Math.min(6, latest.difficulty_level || 3))
  const latestThree = recent.rows.slice(0, 3)
  if (latestThree.length === 3 && latestThree.every(isFluentAttempt)) {
    return Math.min(6, current + 1)
  }
  const latestTwo = recent.rows.slice(0, 2)
  if (
    latestTwo.length === 2 &&
    latestTwo.every(
      (attempt) =>
        !attempt.is_correct ||
        attempt.assessment_level === 'partial' ||
        attempt.assessment_level === 'review'
    )
  ) {
    return Math.max(1, current - 1)
  }
  return current
}

export const toQuestionPoolItem = (row: QuestionPoolRow): QuestionPoolItem => ({
  id: row.id,
  lessonId: row.lesson_id,
  questionType: row.question_type,
  question: row.question_text,
  choices: row.choices || undefined,
  correctIndex: row.correct_index ?? undefined,
  correctAnswer: row.correct_answer || undefined,
  wrongAnswers: row.wrong_answers || undefined,
  explanation: row.explanation || undefined,
  difficultyLevel: row.difficulty_level,
  questionGroup: row.question_group,
  topic: row.topic || undefined,
  sourceDatasetId: row.source_dataset_id || undefined,
  sourceDatasetName: row.source_dataset_name || undefined,
  understandSkill: row.understand_skill || undefined,
})

export async function selectQuestionPoolRow({
  learnerId,
  lessonId,
  datasetId,
  topic,
  difficulty,
  questionType,
  excludeQuestionPoolIds = [],
  excludeUnderstandSkills = [],
}: QuestionPoolSelection): Promise<QuestionPoolRow | null> {
  const params: unknown[] = [datasetId, lessonId, learnerId]
  let optionalFilters = ''

  if (topic?.trim()) {
    params.push(`%${topic.trim()}%`)
    optionalFilters += `
      AND (
        qp.question_group ILIKE $${params.length}
        OR COALESCE(qp.topic, '') ILIKE $${params.length}
        OR qp.question_text ILIKE $${params.length}
      )
    `
  }

  let difficultyPlaceholder = ''
  if (Number.isFinite(difficulty)) {
    params.push(difficulty)
    difficultyPlaceholder = `$${params.length}`
  }

  if (questionType) {
    params.push(questionType)
    optionalFilters += ` AND qp.question_type = $${params.length}`
  }

  if (excludeQuestionPoolIds.length > 0) {
    params.push(excludeQuestionPoolIds)
    optionalFilters += ` AND NOT (qp.id = ANY($${params.length}::text[]))`
  }

  if (questionType === 'written' && excludeUnderstandSkills.length > 0) {
    params.push(excludeUnderstandSkills)
    optionalFilters += ` AND NOT (qp.understand_skill = ANY($${params.length}::text[]))`
  }

  const result = await query<QuestionPoolRow>(
    `
      WITH candidate_pool AS (
        SELECT
          qp.id,
          qp.lesson_id,
          qp.question_type,
          qp.question_text,
          qp.choices,
          qp.correct_index,
          qp.correct_answer,
          qp.wrong_answers,
          qp.explanation,
          qp.source_context,
          qp.difficulty_level,
          qp.question_group,
          qp.topic,
          qp.source_dataset_id,
          qp.source_dataset_name,
          CASE
            WHEN jsonb_typeof(qp.source_segment_ids) = 'array'
              THEN qp.source_segment_ids
            ELSE '[]'::jsonb
          END AS source_segment_ids
          ,qp.understand_skill
        FROM question_pool qp
        WHERE qp.is_active = TRUE
          AND qp.source_dataset_id = $1
          AND qp.lesson_id = $2
          AND (
            (
              qp.question_type = 'multiple_choice'
              AND jsonb_typeof(qp.choices) = 'array'
              AND jsonb_array_length(qp.choices) = 4
              AND qp.correct_index BETWEEN 0 AND 3
              AND COALESCE(qp.bloom_level, 'remember') = 'remember'
            )
            OR (
              qp.question_type = 'written'
              AND qp.bloom_level = 'understand'
              AND NULLIF(BTRIM(qp.correct_answer), '') IS NOT NULL
            )
          )
          ${optionalFilters}
      ),
      chosen_type AS (
        SELECT question_type
        FROM candidate_pool
        GROUP BY question_type
        ORDER BY random()
        LIMIT 1
      ),
      last_attempt_source AS (
        SELECT
          CASE
            WHEN jsonb_typeof(previous_pool.source_segment_ids) = 'array'
              THEN previous_pool.source_segment_ids
            ELSE '[]'::jsonb
          END AS source_segment_ids,
          COALESCE(
            previous_attempt.question_group,
            previous_pool.question_group,
            'general'
          ) AS question_group
        FROM quiz_attempts previous_attempt
        LEFT JOIN question_pool previous_pool
          ON previous_pool.id = previous_attempt.question_pool_id
        WHERE previous_attempt.user_id = $3
          AND previous_attempt.lesson_id = $2
        ORDER BY previous_attempt.created_at DESC, previous_attempt.id DESC
        LIMIT 1
      )
      SELECT
        id,
        lesson_id,
        question_type,
        question_text,
        choices,
        correct_index,
        correct_answer,
        wrong_answers,
        explanation,
        source_context,
        difficulty_level,
        question_group,
        topic,
        source_dataset_id,
        source_dataset_name,
        source_segment_ids
        ,understand_skill
      FROM candidate_pool
      INNER JOIN chosen_type USING (question_type)
      ORDER BY
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM last_attempt_source previous_source
            WHERE
              EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                  candidate_pool.source_segment_ids
                ) current_segment(value)
                INNER JOIN jsonb_array_elements_text(
                  previous_source.source_segment_ids
                ) previous_segment(value)
                  ON previous_segment.value = current_segment.value
              )
              OR (
                (
                  jsonb_array_length(candidate_pool.source_segment_ids) = 0
                  OR jsonb_array_length(previous_source.source_segment_ids) = 0
                )
                AND COALESCE(candidate_pool.question_group, 'general') =
                  previous_source.question_group
              )
          ) THEN 1
          ELSE 0
        END ASC,
        COALESCE((
          SELECT COUNT(*)
          FROM quiz_attempts source_attempt
          LEFT JOIN question_pool attempted_pool
            ON attempted_pool.id = source_attempt.question_pool_id
          WHERE source_attempt.user_id = $3
            AND source_attempt.lesson_id = $2
            AND (
              EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                  candidate_pool.source_segment_ids
                ) current_segment(value)
                INNER JOIN jsonb_array_elements_text(
                  CASE
                    WHEN jsonb_typeof(attempted_pool.source_segment_ids) = 'array'
                      THEN attempted_pool.source_segment_ids
                    ELSE '[]'::jsonb
                  END
                ) attempted_segment(value)
                  ON attempted_segment.value = current_segment.value
              )
              OR (
                (
                  jsonb_array_length(candidate_pool.source_segment_ids) = 0
                  OR jsonb_array_length(
                    CASE
                      WHEN jsonb_typeof(attempted_pool.source_segment_ids) = 'array'
                        THEN attempted_pool.source_segment_ids
                      ELSE '[]'::jsonb
                    END
                  ) = 0
                )
                AND COALESCE(
                  source_attempt.question_group,
                  attempted_pool.question_group,
                  'general'
                ) = COALESCE(candidate_pool.question_group, 'general')
              )
            )
        ), 0) ASC,
        COALESCE((
          SELECT COUNT(*)
          FROM quiz_attempts group_attempt
          WHERE group_attempt.user_id = $3
            AND group_attempt.lesson_id = $2
            AND COALESCE(group_attempt.question_group, 'general') = candidate_pool.question_group
        ), 0) ASC,
        ${difficultyPlaceholder ? `ABS(candidate_pool.difficulty_level - ${difficultyPlaceholder}) ASC,` : ''}
        EXISTS (
          SELECT 1
          FROM quiz_attempts qa
          WHERE qa.user_id = $3
            AND qa.question_pool_id = candidate_pool.id
            AND qa.is_correct = TRUE
            AND COALESCE(
              qa.response_time_ms <= CASE
                WHEN candidate_pool.question_type = 'written' THEN 180000
                ELSE 60000
              END,
              TRUE
            )
        ) ASC,
        (SELECT COUNT(*) FROM quiz_attempts qa_count
         WHERE qa_count.user_id = $3
           AND qa_count.question_pool_id = candidate_pool.id) ASC,
        random()
      LIMIT 1
    `,
    params
  )

  return result.rows[0] || null
}

/**
 * Keep questions unique inside the current 10-question goal when possible.
 * If the selected type has too few questions, progressively relax only the
 * within-goal exclusions. The learner's mastered questions remain lower
 * priority in every pass and become eligible again after the pool is mastered.
 */
export async function selectLearningSetQuestionPoolRow(
  selection: QuestionPoolSelection
): Promise<QuestionPoolRow | null> {
  const attempts: QuestionPoolSelection[] = [selection]
  const hasQuestionExclusions = Boolean(
    selection.excludeQuestionPoolIds?.length
  )
  const hasSkillExclusions = Boolean(selection.excludeUnderstandSkills?.length)

  if (selection.questionType === 'written' && hasSkillExclusions) {
    attempts.push({ ...selection, excludeUnderstandSkills: [] })
  }
  if (hasQuestionExclusions) {
    attempts.push({ ...selection, excludeQuestionPoolIds: [] })
  }
  if (hasQuestionExclusions || hasSkillExclusions) {
    attempts.push({
      ...selection,
      excludeQuestionPoolIds: [],
      excludeUnderstandSkills: [],
    })
  }

  const seen = new Set<string>()
  for (const attempt of attempts) {
    const key = JSON.stringify({
      questionIds: attempt.excludeQuestionPoolIds || [],
      skills: attempt.excludeUnderstandSkills || [],
    })
    if (seen.has(key)) continue
    seen.add(key)
    const row = await selectQuestionPoolRow(attempt)
    if (row) return row
  }

  return null
}

export async function issueQuestionPoolItem(
  learnerId: string,
  row: QuestionPoolRow,
  session?: { sessionId: string; quizIndex: number; total: number }
) {
  const item = toQuestionPoolItem(row)
  const memory = await issueQuiz(learnerId, {
    rawText: item.question,
    sources: savedMaterialSource(row.source_context),
    question: item.question,
    questionPoolId: item.id,
    learningSessionId: session?.sessionId,
    lessonId: item.lessonId,
    questionType: item.questionType,
    understandSkill: item.understandSkill,
    choices: item.choices,
    answerIndex: item.correctIndex,
    answer: item.correctAnswer,
    explanation: item.explanation,
    difficultyLevel: item.difficultyLevel,
    questionGroup: item.questionGroup,
    sourceDatasetId: item.sourceDatasetId,
    sourceDatasetName: item.sourceDatasetName,
    updatedAt: new Date().toISOString(),
    quizIndex: session?.quizIndex,
    total: session?.total,
  })

  return {
    id: item.id,
    serverQuizId: memory.serverQuizId,
    questionType: item.questionType,
    understandSkill: item.understandSkill,
    question: memory.question!,
    choices: memory.choices || [],
    difficultyLevel: item.difficultyLevel,
    questionGroup: item.questionGroup,
    topic: item.topic,
    sourceDatasetId: item.sourceDatasetId,
    sourceDatasetName: item.sourceDatasetName,
    learningSessionId: session?.sessionId,
    quizIndex: session?.quizIndex,
    total: session?.total,
  }
}
