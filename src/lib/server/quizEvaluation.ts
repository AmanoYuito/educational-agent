import { randomUUID } from 'crypto'
import type { GeneratedQuizMemory } from '@/features/stores/home'
import type {
  QuizEvaluationRecord,
  QuizEvaluationSettings,
  QuizEvaluationUsage,
} from '@/features/quizEvaluation/types'
import { query } from './db'

export type QuizEvaluationCapture = {
  inputs?: Record<string, string>
  data?: any
  rawOutput?: string
  quiz?: GeneratedQuizMemory | null
  difyMs?: number
  attempts: number
}

export function evaluationSettings(
  value: any,
  ownerId: string
): QuizEvaluationSettings | null {
  if (!value || value.enabled !== true || value.ownerId !== ownerId) return null
  if (
    ![value.runLabel, value.modelLabel].every(
      (v) => typeof v === 'string' && v.trim() && v.length <= 200
    )
  )
    return null
  if (typeof value.notes !== 'string' || value.notes.length > 2000) return null
  return {
    ownerId,
    enabled: true,
    runLabel: value.runLabel.trim(),
    modelLabel: value.modelLabel.trim(),
    notes: value.notes,
  }
}

const numberOrNull = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function readEvaluationUsage(data: any): QuizEvaluationUsage {
  const usage = data?.metadata?.usage
  const latency = numberOrNull(usage?.latency)
  return {
    promptTokens: numberOrNull(usage?.prompt_tokens),
    completionTokens: numberOrNull(usage?.completion_tokens),
    totalTokens: numberOrNull(usage?.total_tokens),
    totalPrice: numberOrNull(usage?.total_price),
    currency:
      typeof usage?.currency === 'string' ? usage.currency.slice(0, 20) : null,
    latencyMs: latency === null ? null : latency * 1000,
    scope: 'dify_response_unverified',
  }
}

const INPUT_KEYS = [
  'mode',
  'topic',
  'difficulty',
  'difficulty_level',
  'conversation_context',
  'source_context',
  'source_dataset_id',
  'source_dataset_name',
  'source_document_id',
  'source_document_name',
  'source_segment_ids',
  'source_recycled',
  'reference_dataset_ids',
  'reference_dataset_names',
  'reference_document_names',
  'reference_segment_ids',
  'pool_draft_id',
  'question_number',
  'question_group',
  'learner_request',
  'allowed_question_types',
  'question_generation_policy',
  'latest_question',
  'question_type',
  'bloom_level',
  'understand_skill',
  'latest_choices',
  'latest_answer',
  'latest_explanation',
  'latest_user_answer',
  'latest_is_correct',
  'previous_questions',
]

export async function saveQuizEvaluation(params: {
  source?: 'realtime' | 'question_pool'
  ownerId: string
  settings: QuizEvaluationSettings
  capture: QuizEvaluationCapture
  queryText: unknown
  conversationId: unknown
  response: Response
  serverMs: number
}): Promise<string> {
  const { capture, settings, response } = params
  const body = await response
    .clone()
    .json()
    .catch(() => ({}))
  const text = (value: unknown, limit = 100000) =>
    typeof value === 'string' ? value.slice(0, limit) : ''
  const record: QuizEvaluationRecord = {
    source: params.source || 'realtime',
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    runLabel: settings.runLabel,
    modelLabel: settings.modelLabel,
    notes: settings.notes,
    status: response.ok && !!capture.quiz ? 'success' : 'error',
    httpStatus: response.status,
    error: response.ok ? '' : text(body.error, 1000),
    serverMs: params.serverMs,
    displayMs: null,
    requestMs: null,
    difyMs: capture.difyMs ?? null,
    attempts: capture.attempts,
    usage: readEvaluationUsage(capture.data),
    query: text(params.queryText),
    inputs: Object.fromEntries(
      INPUT_KEYS.filter((key) => typeof capture.inputs?.[key] === 'string').map(
        (key) => [key, text(capture.inputs![key])]
      )
    ),
    conversationId: text(
      capture.data?.conversation_id || params.conversationId,
      200
    ),
    messageId: text(capture.data?.message_id || capture.data?.id, 200),
    workflowRunId: text(capture.data?.workflow_run_id, 200),
    question: capture.quiz?.question || '',
    choices: capture.quiz?.choices || [],
    correctAnswer: capture.quiz?.answer || '',
    explanation: capture.quiz?.explanation || '',
    rawOutput: text(capture.rawOutput),
  }
  await query(
    'INSERT INTO quiz_evaluations (id, user_id, record) VALUES ($1, $2, $3::jsonb)',
    [record.id, params.ownerId, JSON.stringify(record)]
  )
  return record.id
}

// Escape quotes/newlines and spreadsheet formulas in untrusted model/user text.
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))
    text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function evaluationsCsv(records: QuizEvaluationRecord[]): string {
  const headers = [
    '記録ID',
    '日時',
    '試行名',
    'モデル構成（手入力・未検証）',
    '設定メモ',
    '生成結果（品質評価ではない）',
    'HTTP状態',
    'エラー',
    '表示までms',
    'API応答までms',
    'サーバー処理ms',
    'Dify通信ms',
    'Dify送信回数',
    '入力tokens',
    '出力tokens',
    '合計tokens',
    '報告費用',
    '通貨',
    '使用量の範囲',
    'Dify報告latency_ms',
    '依頼文',
    '入力条件JSON',
    '会話ID',
    'メッセージID',
    'ワークフロー実行ID',
    '問題文',
    '選択肢JSON',
    '選択肢A',
    '選択肢B',
    '選択肢C',
    '選択肢D',
    '正解',
    '解説',
    '生成原文',
    '正確さ_1から5',
    '会話との関連_1から5',
    '難易度の適切さ_1から5',
    '解説の質_1から5',
    '採用可否',
    '評価メモ',
    '生成元',
    '問題番号・下書きID',
    'ナレッジID',
    'ナレッジ名',
    '教材ドキュメントID',
    '教材ドキュメント名',
    '教材参照セグメントID',
    '教材参照箇所',
    '問題形式',
    '認知レベル（指定値）',
    '模範回答',
  ]
  const rows = records.map((r) => [
    r.id,
    r.createdAt,
    r.runLabel,
    r.modelLabel,
    r.notes,
    r.status,
    r.httpStatus,
    r.error,
    r.displayMs,
    r.requestMs,
    r.serverMs,
    r.difyMs,
    r.attempts,
    r.usage.promptTokens,
    r.usage.completionTokens,
    r.usage.totalTokens,
    r.usage.totalPrice,
    r.usage.currency,
    r.usage.scope,
    r.usage.latencyMs,
    r.query,
    JSON.stringify(r.inputs),
    r.conversationId,
    r.messageId,
    r.workflowRunId,
    r.question,
    JSON.stringify(r.choices),
    ...Array.from({ length: 4 }, (_, index) => r.choices?.[index] ?? ''),
    r.correctAnswer,
    r.explanation,
    r.rawOutput,
    '',
    '',
    '',
    '',
    '',
    '',
    r.source || 'realtime',
    r.inputs.question_number || r.inputs.pool_draft_id || '',
    r.inputs.source_dataset_id || '',
    r.inputs.source_dataset_name || '',
    r.inputs.source_document_id || '',
    r.inputs.source_document_name || '',
    r.inputs.source_segment_ids || '',
    r.inputs.source_context || '',
    r.inputs.question_type || '',
    r.inputs.bloom_level || '',
    r.inputs.question_type === 'written' ? r.correctAnswer : '',
  ])
  return (
    '\uFEFF' +
    [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') +
    '\r\n'
  )
}
