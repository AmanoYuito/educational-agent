export type QuizEvaluationSettings = {
  ownerId: string
  enabled: boolean
  runLabel: string
  modelLabel: string
  notes: string
}

export type QuizEvaluationUsage = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  totalPrice: number | null
  currency: string | null
  latencyMs: number | null
  // The blocking API does not identify which workflow nodes this covers.
  scope: 'dify_response_unverified'
}

export type QuizEvaluationRecord = {
  source?: 'realtime' | 'question_pool'
  id: string
  createdAt: string
  runLabel: string
  modelLabel: string
  notes: string
  status: 'success' | 'error'
  httpStatus: number
  error: string
  serverMs: number
  displayMs: number | null
  requestMs: number | null
  difyMs: number | null
  attempts: number
  usage: QuizEvaluationUsage
  query: string
  inputs: Record<string, string>
  conversationId: string
  messageId: string
  workflowRunId: string
  question: string
  choices: string[]
  correctAnswer: string
  explanation: string
  rawOutput: string
}
