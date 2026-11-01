import type {
  LearningSetProgress,
  QuizHistoryItem,
  WrittenAssessmentLevel,
} from '@/features/stores/home'
import type { QuestionPoolItem } from '@/features/stores/home'
import { withBasePath } from '@/utils/basePath'
import type { QuizEvaluationRecord } from '@/features/quizEvaluation/types'
import type {
  GeneratedPoolDraft,
  PoolGenerationRequest,
  PoolQuestionType,
  PoolBloomLevel,
  UnderstandSkill,
} from '@/features/questionPool/types'
import { PoolGenerationError } from '@/features/questionPool/types'
import type { LearningActivitySummary } from '@/features/stores/home'

export type LearningActivityEventInput = {
  id: string
  lessonId: string
  eventType:
    | 'page_enter'
    | 'workspace_view'
    | 'active_time'
    | 'material_page_view'
    | 'material_scroll'
    | 'material_open_external'
  viewMode?: 'material' | 'avatar'
  durationMs?: number
  pageNumber?: number
  pageCount?: number
  metadata?: Record<string, string | number | boolean | null>
}

export async function saveLearningActivity(
  events: LearningActivityEventInput[]
): Promise<void> {
  if (!events.length) return
  const response = await fetch(withBasePath('/api/learning-activity/'), {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  })
  if (!response.ok) throw new Error('学習行動ログを保存できませんでした。')
}

export async function loadLearningActivitySummary(
  lessonId: string
): Promise<LearningActivitySummary> {
  const response = await fetch(
    withBasePath(
      `/api/learning-activity/?lessonId=${encodeURIComponent(lessonId)}`
    ),
    { credentials: 'include', cache: 'no-store' }
  )
  const data = await response.json()
  if (!response.ok)
    throw new Error(data.message || '学習時間を取得できませんでした。')
  return data.summary as LearningActivitySummary
}

// Server-only credentials; each comparison draft starts a fresh conversation.
export async function requestDifyPoolGeneration(
  url: string,
  key: string,
  inputs: {
    source_context: string
    question_type: PoolQuestionType
    bloom_level?: PoolBloomLevel
    understand_skill?: UnderstandSkill
  },
  query: string,
  user: string
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs, query, response_mode: 'blocking', user }),
    signal: AbortSignal.timeout(120000),
    redirect: 'error',
  })
}

// Only the server calls this with a server-side Knowledge API key.
export async function fetchDifyKnowledgePage(
  url: string,
  key: string,
  signal: AbortSignal
): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    signal,
    cache: 'no-store',
    redirect: 'error',
  })
  if (!response.ok)
    throw new Error(
      `ナレッジ本文を取得できませんでした（HTTP ${response.status}）。ナレッジ用APIキーと対象IDを確認してください。`
    )
  return response.json()
}

export async function generatePoolQuestion(
  input: PoolGenerationRequest
): Promise<{
  item: GeneratedPoolDraft
  evaluationId?: string
  warning?: string
  sourceIds?: string[]
}> {
  const response = await fetch(withBasePath('/api/question-pool/generate/'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(160000),
  })
  const data = await response.json()
  if (!response.ok)
    throw new PoolGenerationError(
      [data.message || '問題の生成に失敗しました。', data.warning]
        .filter(Boolean)
        .join(' '),
      data.retryable === true,
      data.sourceIds || []
    )
  return data
}

export async function saveQuestionPoolItems(
  items: Array<
    | GeneratedPoolDraft
    | (QuestionPoolItem & { aiOutput?: unknown; isActive?: boolean })
  >
): Promise<{ savedCount: number; ids: string[] }> {
  const response = await fetch(withBasePath('/api/question-pool/save/'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: items.map((item) => ({
        ...item,
        isActive: true,
      })),
    }),
    signal: AbortSignal.timeout(30000),
  })
  const data = await response.json()
  if (!response.ok)
    throw new Error(data.message || '問題プールへの保存に失敗しました。')
  return data
}

export type GradeQuizResponse = {
  grade: {
    type: 'grade'
    correct: boolean
    score?: number
    assessmentLevel?: WrittenAssessmentLevel
    responseTimeMs?: number
    correctIndex: number | null
    userIndex: number | null
    emotion: 'happy' | 'sweat' | 'neutral'
    message: string
    explanation: string
    correctAnswer: string
    userAnswer: string
  }
  attempt: QuizHistoryItem
  learningSet?: LearningSetProgress | null
}

export async function submitWrittenQuizAnswer(
  quizId: string,
  userAnswer: string
): Promise<GradeQuizResponse> {
  const response = await fetch(withBasePath('/api/grade-written-quiz/'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quizId, userAnswer }),
    signal: AbortSignal.timeout(130000),
  })
  const data = await response.json()
  if (!response.ok)
    throw new Error(
      data.message || '記述問題の採点に失敗しました。もう一度回答してください。'
    )
  return data
}

export async function submitQuizAnswer(
  quizId: string,
  userIndex: number,
  userAnswer: string
): Promise<GradeQuizResponse> {
  const response = await fetch(withBasePath('/api/grade-quiz/'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quizId, userIndex, userAnswer }),
    signal: AbortSignal.timeout(30000),
  })
  const data = await response.json()
  if (!response.ok)
    throw new Error(
      data.message || '採点に失敗しました。もう一度回答してください。'
    )
  return data
}

export async function saveQuizEvaluationTiming(
  id: string,
  timing: { displayMs?: number; requestMs?: number }
): Promise<void> {
  const response = await fetch(withBasePath('/api/quiz-evaluations/'), {
    method: 'PATCH',
    credentials: 'include',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...timing }),
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('表示時間の保存に失敗しました。')
}

export async function loadQuizEvaluations(
  run: string,
  source: 'realtime' | 'question_pool' = 'realtime',
  datasetId?: string
): Promise<QuizEvaluationRecord[]> {
  const response = await fetch(
    withBasePath(
      `/api/quiz-evaluations/?run=${encodeURIComponent(run)}&source=${source}${datasetId ? `&dataset=${encodeURIComponent(datasetId)}` : ''}`
    ),
    { credentials: 'include', cache: 'no-store' }
  )
  const data = await response.json()
  if (!response.ok)
    throw new Error(data.message || '計測記録を取得できません。')
  return data.items
}

export async function downloadQuizEvaluations(
  run: string,
  source: 'realtime' | 'question_pool' = 'realtime',
  datasetId?: string
): Promise<void> {
  const response = await fetch(
    withBasePath(
      `/api/quiz-evaluations/?format=csv&run=${encodeURIComponent(run)}&source=${source}${datasetId ? `&dataset=${encodeURIComponent(datasetId)}` : ''}`
    ),
    { credentials: 'include', cache: 'no-store' }
  )
  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.message || 'CSVを取得できません。')
  }
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = `${source}${datasetId ? `-${datasetId}` : ''}-evaluations-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function getQuizSources(quizId: string) {
  const response = await fetch(
    withBasePath(`/api/quiz-learning/?quizId=${encodeURIComponent(quizId)}`),
    { credentials: 'include', cache: 'no-store' }
  )
  const data = await response.json()
  if (!response.ok)
    throw new Error(data.message || '教材を取得できませんでした。')
  return data as import('@/features/messages/quizLearning').QuizSourceResponse
}

export async function getQuizExplanation(
  quizId: string,
  kind: import('@/features/messages/quizLearning').QuizExplanationKind
) {
  const response = await fetch(withBasePath('/api/quiz-learning/'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quizId, kind }),
    signal: AbortSignal.timeout(95000),
  })
  const data = await response.json()
  if (!response.ok)
    throw new Error(data.message || '追加の解説を取得できませんでした。')
  return data as import('@/features/messages/quizLearning').QuizExplanationResponse
}

/** Server-only call; credentials are read by the API route, never sent to the browser. */
export async function requestDifyLearningExplanation(
  url: string,
  key: string,
  body: Record<string, unknown>
): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
    redirect: 'error',
  })
  if (!response.ok)
    throw new Error(
      `解説の生成に失敗しました（HTTP ${response.status}）。時間をおいて再度お試しください。`
    )
  const data = await response.json()
  if (typeof data.answer !== 'string' || !data.answer.trim())
    throw new Error('解説の回答を取得できませんでした。')
  let text = data.answer
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  // Some existing chatflows return a structured explanation.
  if (text.startsWith('{')) {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('解説の形式を確認できませんでした。')
    }
    if (parsed.type === 'quiz' || parsed.type === 'insufficient_material')
      throw new Error(
        '解説を取得できませんでした。Difyの会話・解説用フローを確認してください。'
      )
    const explanation =
      parsed.explanation || parsed.text || parsed.reply || parsed.message
    if (typeof explanation !== 'string' || !explanation.trim())
      throw new Error('解説の形式を確認できませんでした。')
    text = explanation
  }
  return text.slice(0, 12000)
}
