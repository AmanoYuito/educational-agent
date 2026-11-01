import { useCallback, useEffect, useRef, useState } from 'react'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import { getQuizExplanation } from '../../app/lib/api/client'
import type {
  QuizExplanationKind,
  QuizExplanationResponse,
} from '@/features/messages/quizLearning'
import styles from '@/styles/quizLearningSupport.module.css'

const labels: Record<QuizExplanationKind, string> = {
  mistake: 'この選択肢はなぜ違う？',
  simple: 'もっと簡単に',
  example: '具体例で教えて',
}

const writtenMistakeLabel = '回答のどこを直せばよい？'

export function QuizLearningSupport({
  quizId,
  graded = false,
  incorrect = false,
  autoExplain = false,
  userLabel,
  questionType = 'multiple_choice',
}: {
  quizId?: string
  graded?: boolean
  incorrect?: boolean
  autoExplain?: boolean
  userLabel?: string
  questionType?: 'multiple_choice' | 'written'
}) {
  const isWritten = questionType === 'written'
  const [active, setActive] = useState<QuizExplanationKind | null>(null)
  const [answers, setAnswers] = useState<
    Partial<Record<QuizExplanationKind, QuizExplanationResponse>>
  >({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const autoStarted = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const explain = useCallback(
    async (kind: QuizExplanationKind) => {
      if (!quizId || inFlight.current) return
      setActive(kind)
      setError('')
      if (answers[kind]) return
      inFlight.current = true
      setBusy(true)
      try {
        const result = await getQuizExplanation(quizId, kind)
        if (alive.current) setAnswers((prev) => ({ ...prev, [kind]: result }))
      } catch {
        if (alive.current)
          setError(
            '追加の解説を取得できませんでした。採点結果は保存されています。もう一度お試しください。'
          )
      } finally {
        inFlight.current = false
        if (alive.current) setBusy(false)
      }
    },
    [quizId, answers]
  )

  useEffect(() => {
    if (graded && incorrect && autoExplain && quizId && !autoStarted.current) {
      autoStarted.current = true
      void explain('mistake')
    }
  }, [graded, incorrect, autoExplain, quizId, explain])

  return (
    <section className={styles.support} aria-label="追加の解説">
      {graded && quizId && (
        <div className={styles.explanations}>
          <div className={styles.actions}>
            {(['mistake', 'simple', 'example'] as const)
              .filter((kind) => kind !== 'mistake' || incorrect)
              .map((kind) => (
                <button
                  type="button"
                  key={kind}
                  disabled={busy}
                  aria-pressed={active === kind}
                  onClick={() => void explain(kind)}
                >
                  <ChatBubbleLeftRightIcon aria-hidden="true" />
                  {kind === 'mistake'
                    ? isWritten
                      ? writtenMistakeLabel
                      : userLabel
                        ? `なぜ${userLabel}は違う？`
                        : labels[kind]
                    : labels[kind]}
                </button>
              ))}
          </div>
          {active && (
            <div className={styles.answer} aria-live="polite">
              <strong>
                {active === 'mistake'
                  ? isWritten
                    ? '回答を見直そう'
                    : userLabel
                      ? `選んだ${userLabel}について`
                      : labels[active]
                  : labels[active]}
              </strong>
              {busy ? (
                <p role="status">
                  {isWritten
                    ? '回答と教材を確認しています…'
                    : '選択肢と教材を確認して解説しています…'}
                </p>
              ) : error ? (
                <div role="alert">
                  <p>{error}</p>
                  <button type="button" onClick={() => void explain(active)}>
                    解説を再取得
                  </button>
                </div>
              ) : (
                answers[active] && (
                  <>
                    <p>{answers[active]!.text}</p>
                    <small>
                      {answers[active]!.basedOn === 'material'
                        ? '出題時の教材と採点結果を参照したAI解説'
                        : '教材本文の記録がないため、保存済みの問題・解説を参照したAI解説'}
                    </small>
                  </>
                )
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
