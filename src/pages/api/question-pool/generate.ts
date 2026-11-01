import type { NextApiRequest, NextApiResponse } from 'next'
import { randomUUID } from 'crypto'
import { getLessonByDatasetId } from '@/config/lessons'
import { getQuestionKnowledge } from '@/lib/server/questionKnowledge'
import {
  selectQuestionMaterial,
  selectQuestionMaterialBundle,
  QuestionMaterialError,
} from '@/lib/server/questionMaterial'
import { z } from 'zod'
import { requireSession } from '@/lib/server/auth'
import type {
  GeneratedPoolDraft,
  UnderstandSkill,
} from '@/features/questionPool/types'
import { requestDifyPoolGeneration } from '../../../../app/lib/api/client'
import {
  saveQuizEvaluation,
  type QuizEvaluationCapture,
} from '@/lib/server/quizEvaluation'

const sourceIdsSchema = z.array(z.string().max(100)).max(1000).default([])
const bloomSchema = z.enum(['remember', 'understand'])
const understandSkillSchema = z.enum([
  'interpret',
  'exemplify',
  'classify',
  'summarize',
  'infer',
  'compare',
  'explain',
])
const requestSchema = z
  .object({
    datasetId: z.string().uuid().optional(),
    questionType: z
      .enum(['multiple_choice', 'written'])
      .default('multiple_choice'),
    bloomLevel: bloomSchema.optional(),
    understandSkill: understandSkillSchema.optional(),
    difficultyLevel: z.number().int().min(1).max(6).default(3),
    variantBase: z
      .object({
        familyId: z.string().trim().min(1).max(100),
        question: z.string().trim().min(1).max(4000),
        correctAnswer: z.string().trim().min(1).max(4000),
        wrongAnswers: z.array(z.string().trim().min(1).max(2000)).max(3),
        sourceContext: z.string().trim().min(1).max(12000),
        sourceDatasetId: z.string().uuid(),
        sourceDatasetName: z.string().max(300).optional(),
        sourceDocumentId: z.string().max(100).optional(),
        sourceDocumentName: z.string().max(300).optional(),
        sourceSegmentIds: sourceIdsSchema,
        sourceSlideNumbers: z
          .array(z.number().int().min(1).max(999))
          .max(5)
          .optional(),
        questionType: z.enum(['multiple_choice', 'written']),
        understandSkill: understandSkillSchema.optional(),
        variantIndex: z.number().int().min(1).max(10),
      })
      .optional(),
    excludedSourceIds: sourceIdsSchema,
    rejectedSourceIds: sourceIdsSchema,
    evaluation: z.object({
      runLabel: z.string().trim().min(1).max(200),
      modelLabel: z.string().trim().min(1).max(200),
      notes: z.string().max(2000).default(''),
    }),
  })
  .refine(
    (input) =>
      input.questionType !== 'written' || input.bloomLevel === 'understand',
    {
      message: '記述問題は理解（Understand）として生成してください。',
      path: ['bloomLevel'],
    }
  )

const quizSchema = z.object({
  type: z.literal('quiz'),
  questionType: z.literal('multiple_choice'),
  public: z.object({
    question: z.string().trim().min(1).max(4000),
    choices: z.array(z.string().trim().min(1).max(2000)).length(4),
  }),
  answerIndex: z.number().int().min(0).max(3),
  answer: z.string().trim().min(1),
  explanation: z.string().trim().min(1).max(8000),
})
const writtenSchema = z
  .object({
    type: z.literal('written'),
    questionType: z.literal('written'),
    bloomLevel: bloomSchema,
    public: z.object({ question: z.string().trim().min(1).max(4000) }).strict(),
    modelAnswer: z.string().trim().min(1).max(8000),
    explanation: z.string().trim().min(1).max(8000),
  })
  .strict()
const outputSchema = z.discriminatedUnion('type', [quizSchema, writtenSchema])

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ message: 'Method not allowed' })
  }
  const session = requireSession(req, res)
  if (!session) return
  if (session.role !== 'admin')
    return res.status(403).json({ message: '管理者専用です。' })
  const request = requestSchema.safeParse(req.body)
  if (!request.success)
    return res.status(400).json({
      message:
        '問題形式・試行名・使用LLMを確認してください。記述問題は理解（Understand）として生成します。',
    })
  const input = request.data
  const bloomInputs: Record<string, string> =
    input.questionType === 'written'
      ? {
          bloom_level: 'understand',
          ...(input.understandSkill
            ? { understand_skill: input.understandSkill }
            : {}),
        }
      : { bloom_level: 'remember' }
  const knowledge = getQuestionKnowledge(input.datasetId)
  if (!knowledge)
    return res
      .status(400)
      .json({ message: '登録されているナレッジを選択してください。' })
  const startedAt = performance.now()
  const queryText = input.variantBase
    ? '指定した元問題と同じ知識点・同じ正答を使い、聞き方と誤答を変えた類題を1問生成してください。'
    : '問題を1問生成してください。'
  const capture: QuizEvaluationCapture = {
    attempts: 0,
    inputs: {
      mode: 'generate_question_pool',
      question_type: input.questionType,
      ...bloomInputs,
      source_dataset_id: knowledge.id,
      source_dataset_name: knowledge.name,
      difficulty_level: String(input.difficultyLevel),
      variant_mode: String(Boolean(input.variantBase)),
    },
  }
  let sourceIds: string[] = []
  const send = async (
    status: number,
    body: { message?: string; item?: GeneratedPoolDraft; retryable?: boolean }
  ) => {
    let evaluationId: string | undefined
    let warning: string | undefined
    try {
      evaluationId = await saveQuizEvaluation({
        source: 'question_pool',
        ownerId: session.userId,
        settings: {
          ...input.evaluation,
          enabled: true,
          ownerId: session.userId,
        },
        capture,
        queryText,
        conversationId: '',
        response: new Response(JSON.stringify({ error: body.message }), {
          status,
        }),
        serverMs: performance.now() - startedAt,
      })
    } catch {
      warning = '今回の生成記録を保存できませんでした。CSVには含まれません。'
    }
    return res
      .status(status)
      .json({ ...body, evaluationId, warning, sourceIds })
  }

  // Never fall back to the live-chat key or accept credentials from the browser.
  const key = process.env.DIFY_QUESTION_POOL_API_KEY?.trim()
  if (!key)
    return send(503, {
      message:
        '問題プール用のDify APIキーが未設定です。DIFY_QUESTION_POOL_API_KEYを設定してください。',
    })
  const rawUrl = (
    process.env.DIFY_QUESTION_POOL_URL?.trim() || 'https://api.dify.ai/v1'
  ).replace(/\/+$/, '')
  const url = rawUrl.endsWith('/chat-messages')
    ? rawUrl
    : `${rawUrl}/chat-messages`
  let material: Awaited<ReturnType<typeof selectQuestionMaterial>>
  let references: Awaited<
    ReturnType<typeof selectQuestionMaterialBundle>
  >['references'] = []
  let sourceContext = ''
  try {
    const lesson = getLessonByDatasetId(knowledge.id)
    if (input.variantBase) {
      if (
        input.variantBase.sourceDatasetId !== knowledge.id ||
        input.variantBase.questionType !== input.questionType
      ) {
        return send(400, {
          message: '類題の元問題と生成条件が一致しません。',
        })
      }
      material = {
        text: input.variantBase.sourceContext,
        sourceIds: input.variantBase.sourceSegmentIds,
        slideNumbers: input.variantBase.sourceSlideNumbers || [],
        datasetId: input.variantBase.sourceDatasetId,
        documentId: input.variantBase.sourceDocumentId || '',
        documentName: input.variantBase.sourceDocumentName || '',
        recycled: false,
      }
      sourceContext = [
        input.variantBase.sourceContext,
        '【類題生成の追加条件（教材本文ではなく作問条件）】',
        `元問題: ${input.variantBase.question}`,
        `固定する正答: ${input.variantBase.correctAnswer}`,
        `使用しない元の誤答: ${input.variantBase.wrongAnswers.join(' / ')}`,
        '元問題と同じ知識点を扱い、問題文は別の聞き方にする。正答本文は一字も変えない。3つの誤答はすべて元の誤答と異なる内容にする。',
      ].join('\n\n')
    } else if (lesson?.referenceDatasetIds?.length) {
      const bundle = await selectQuestionMaterialBundle(
        input.excludedSourceIds,
        input.rejectedSourceIds,
        knowledge.id,
        lesson.referenceDatasetIds
      )
      material = bundle.material
      references = bundle.references
      sourceContext = bundle.sourceContext
    } else {
      material = await selectQuestionMaterial(
        input.excludedSourceIds,
        input.rejectedSourceIds,
        knowledge.id
      )
      sourceContext = material.text
    }
    sourceIds = material.sourceIds
    capture.inputs = {
      ...capture.inputs,
      source_context: sourceContext,
      source_dataset_id: material.datasetId,
      source_document_id: material.documentId,
      source_document_name: material.documentName,
      source_segment_ids: JSON.stringify(material.sourceIds),
      source_recycled: String(material.recycled),
      reference_dataset_ids: JSON.stringify(
        references.map((reference) => reference.datasetId)
      ),
      reference_dataset_names: JSON.stringify(
        references.map(
          (reference) => getQuestionKnowledge(reference.datasetId)?.name || ''
        )
      ),
      reference_document_names: JSON.stringify(
        references.map((reference) => reference.documentName)
      ),
      reference_segment_ids: JSON.stringify(
        references.flatMap((reference) => reference.sourceIds)
      ),
    }
  } catch (error) {
    return send(error instanceof QuestionMaterialError ? error.status : 502, {
      message:
        error instanceof QuestionMaterialError
          ? error.message
          : 'ナレッジ本文を取得できませんでした。ナレッジ用APIキー・ID・接続先と教材の公開状態を確認してください。',
    })
  }
  const difyStartedAt = performance.now()
  try {
    capture.attempts = 1
    const response = await requestDifyPoolGeneration(
      url,
      key,
      {
        source_context: sourceContext,
        question_type: input.questionType,
        ...bloomInputs,
      },
      queryText,
      `question-pool-${session.userId}`
    )
    capture.difyMs = performance.now() - difyStartedAt
    if (!response.ok) {
      // Upstream bodies can contain provider details; do not expose them to clients.
      const message = [401, 403].includes(response.status)
        ? '問題プール用Difyの認証に失敗しました。専用APIキーを確認してください。'
        : response.status === 429
          ? 'Difyの利用上限に達しました。時間をおいて再度お試しください。'
          : `問題プール用Difyでエラーが発生しました（HTTP ${response.status}）。公開したフローの実行ログを確認してください。`
      return send(502, { message })
    }
    const data = await response.json()
    capture.difyMs = performance.now() - difyStartedAt
    capture.data = data
    if (typeof data.answer !== 'string')
      return send(502, {
        message:
          'Difyの回答を取得できませんでした。問題プール用Chatflowを指定してください。',
      })
    capture.rawOutput = data.answer
    const rawText = data.answer
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
    let parsed: unknown
    try {
      parsed = JSON.parse(rawText)
    } catch {
      return send(502, {
        message:
          '生成された問題がJSON形式ではありません。Difyの問題整形ノードを確認してください。',
      })
    }
    if (
      (parsed as { type?: unknown } | null)?.type === 'insufficient_material'
    ) {
      return send(422, {
        message: '選ばれた教材本文だけでは問題を作れませんでした。',
        retryable: true,
      })
    }
    const result = outputSchema.safeParse(parsed)
    if (!result.success)
      return send(502, {
        message:
          '問題形式・認知レベル・正答または模範回答・解説の形式を確認できませんでした。新しい教材ランダム出題フローが公開されているか確認してください。',
      })
    const quiz = result.data
    if (
      quiz.questionType !== input.questionType ||
      (quiz.type === 'written' && quiz.bloomLevel !== 'understand')
    )
      return send(502, {
        message:
          '指定した問題形式または認知レベルと生成結果が一致しません。Difyのフローを確認してください。',
      })
    const normalize = (text: string) => text.normalize('NFKC').trim()
    if (
      quiz.type === 'quiz' &&
      (new Set(quiz.public.choices.map(normalize)).size !== 4 ||
        quiz.public.choices[quiz.answerIndex] !== quiz.answer)
    ) {
      return send(502, {
        message:
          '選択肢の重複、または正答の不一致がありました。再生成してください。',
      })
    }
    if (input.variantBase) {
      const sameQuestion =
        normalize(quiz.public.question) ===
        normalize(input.variantBase.question)
      const sameAnswer =
        quiz.type === 'quiz'
          ? normalize(quiz.answer) ===
            normalize(input.variantBase.correctAnswer)
          : normalize(quiz.modelAnswer) ===
            normalize(input.variantBase.correctAnswer)
      const oldWrongAnswers = new Set(
        input.variantBase.wrongAnswers.map(normalize)
      )
      const repeatsWrongAnswer =
        quiz.type === 'quiz' &&
        quiz.public.choices.some(
          (choice, index) =>
            index !== quiz.answerIndex && oldWrongAnswers.has(normalize(choice))
        )
      if (sameQuestion || !sameAnswer || repeatsWrongAnswer) {
        return send(422, {
          message:
            '類題が元問題と十分に変わっていないか、正答が変わりました。もう一度生成してください。',
          retryable: true,
        })
      }
    }
    const inferQuestionGroup = () => {
      const primary = sourceContext.split('【補足根拠')[0]
      const headings = [...primary.matchAll(/【\s*([^】\n]{2,60})\s*】/g)]
        .map((match) => match[1].trim())
        .filter(
          (value) =>
            !value.includes('出題範囲') && !value.includes('類題生成の追加条件')
        )
      const numbered = primary.match(
        /(?:^|\n)\s*(\d+(?:\.\d+)+\s*[^\n]{1,60})/m
      )?.[1]
      return (
        headings.at(-1) ||
        numbered ||
        material.documentName ||
        '全般'
      ).slice(0, 100)
    }
    const questionGroup = inferQuestionGroup()
    const item: GeneratedPoolDraft = {
      id: randomUUID(),
      lessonId: getLessonByDatasetId(material.datasetId)?.id,
      sourceContext: input.variantBase?.sourceContext || sourceContext,
      sourceDatasetId: material.datasetId,
      sourceDatasetName: knowledge.name,
      sourceDocumentId: material.documentId,
      sourceDocumentName: material.documentName,
      sourceSegmentIds: material.sourceIds,
      sourceSlideNumbers: material.slideNumbers,
      question: quiz.public.question,
      difficultyLevel: input.difficultyLevel,
      questionGroup,
      topic: questionGroup,
      variantFamilyId: input.variantBase?.familyId,
      variantIndex: input.variantBase?.variantIndex || 0,
      ...(quiz.type === 'quiz'
        ? {
            questionType: 'multiple_choice' as const,
            bloomLevel: 'remember' as const,
            choices: quiz.public.choices,
            correctIndex: quiz.answerIndex,
            correctAnswer: quiz.answer,
            wrongAnswers: quiz.public.choices.filter(
              (_, index) => index !== quiz.answerIndex
            ),
          }
        : {
            questionType: 'written' as const,
            bloomLevel: 'understand' as const,
            ...(input.understandSkill
              ? { understandSkill: input.understandSkill as UnderstandSkill }
              : {}),
            choices: [] as [],
            correctIndex: null,
            correctAnswer: quiz.modelAnswer,
            wrongAnswers: [] as [],
          }),
      explanation: quiz.explanation,
      aiOutput: JSON.stringify(quiz),
    }
    capture.quiz = {
      rawText: data.answer,
      question: item.question,
      questionType: item.questionType,
      choices: item.choices,
      answer: item.correctAnswer,
      answerIndex: item.correctIndex ?? undefined,
      explanation: item.explanation,
      updatedAt: new Date().toISOString(),
    }
    capture.inputs = {
      ...capture.inputs,
      pool_draft_id: item.id,
    }
    // Only preview data is returned. The existing save endpoint persists reviewed drafts.
    return send(200, { item })
  } catch (error) {
    capture.difyMs = performance.now() - difyStartedAt
    const timeout =
      error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name)
    return send(timeout ? 504 : 502, {
      message: timeout
        ? '問題生成が時間内に完了しませんでした。Difyの実行状況を確認してください。'
        : '問題プール用Difyへの接続または応答の読み取りに失敗しました。',
    })
  }
}
