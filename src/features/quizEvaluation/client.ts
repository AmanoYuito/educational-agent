import type { QuizEvaluationSettings } from './types'
import { saveQuizEvaluationTiming } from '../../../app/lib/api/client'
import toastStore from '@/features/stores/toast'

const SETTINGS_KEY = 'aituber-quiz-evaluation-v1'
const pending = new Map<string, number>()

export function loadEvaluationSettings(): QuizEvaluationSettings | null {
  if (typeof window === 'undefined') return null
  try {
    const value = JSON.parse(sessionStorage.getItem(SETTINGS_KEY) || 'null')
    return value &&
      typeof value.ownerId === 'string' &&
      typeof value.runLabel === 'string' &&
      typeof value.modelLabel === 'string' &&
      typeof value.notes === 'string'
      ? value
      : null
  } catch {
    return null
  }
}

export function saveEvaluationSettings(settings: QuizEvaluationSettings) {
  sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function clearEvaluationSettings() {
  try {
    sessionStorage.removeItem(SETTINGS_KEY)
  } catch {}
  pending.clear()
}

export function evaluationWarning(message: string) {
  toastStore
    .getState()
    .addToast({ message, type: 'error', tag: 'quiz-evaluation-error' })
}

export function registerEvaluationResponse(
  id: string,
  startedAt: number,
  requestMs: number,
  success: boolean
) {
  if (success) {
    // Bound memory even if the chat panel never renders a particular response.
    if (pending.size >= 100)
      pending.delete(pending.keys().next().value as string)
    pending.set(id, startedAt)
  }
  void saveQuizEvaluationTiming(id, { requestMs }).catch(() =>
    evaluationWarning('計測の応答時間を保存できませんでした。')
  )
}

export function markEvaluationDisplayed(id: string) {
  const startedAt = pending.get(id)
  if (startedAt === undefined || document.visibilityState !== 'visible') return
  const displayMs = performance.now() - startedAt
  pending.delete(id)
  void saveQuizEvaluationTiming(id, { displayMs }).catch(() =>
    evaluationWarning(
      '問題は生成されましたが、表示時間を保存できませんでした。'
    )
  )
}

// Two animation frames give React's committed question a chance to be painted.
// Hidden tabs and restored history do not create fabricated display measurements.
export function observeEvaluationDisplay(id: string): () => void {
  if (!pending.has(id) || document.visibilityState !== 'visible')
    return () => {}
  let second = 0
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(() => markEvaluationDisplayed(id))
  })
  return () => {
    cancelAnimationFrame(first)
    cancelAnimationFrame(second)
  }
}
