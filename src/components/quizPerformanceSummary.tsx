import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClockIcon, FireIcon, XMarkIcon } from '@heroicons/react/24/outline'

import homeStore from '@/features/stores/home'
import type { QuizHistoryItem } from '@/features/stores/home'

const PawIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <circle cx="6.2" cy="7.2" r="2.2" fill="currentColor" />
    <circle cx="11" cy="4.8" r="2.2" fill="currentColor" />
    <circle cx="15.9" cy="6.2" r="2.2" fill="currentColor" />
    <circle cx="19" cy="10.4" r="2" fill="currentColor" />
    <path
      fill="currentColor"
      d="M12.2 9.2c-3.8 0-7 3.6-7 6.8 0 2.2 1.6 3.3 3.5 3.3 1.3 0 2.1-.7 3.5-.7s2.2.7 3.5.7c1.9 0 3.5-1.1 3.5-3.3 0-3.2-3.2-6.8-7-6.8Z"
    />
  </svg>
)

const formatLearningTime = (milliseconds: number) => {
  if (milliseconds <= 0) return '0分'
  const minutes = Math.floor(milliseconds / 60000)
  if (minutes < 1) return '1分未満'
  if (minutes < 60) return `${minutes}分`
  return `${Math.floor(minutes / 60)}時間${minutes % 60}分`
}

const formatAccuracy = (
  correctCount: number,
  answeredCount: number
): string => {
  if (answeredCount === 0) return '--'
  return `${Math.round((correctCount / answeredCount) * 100)}%`
}

export const QuizAchievementBadges = ({
  className = '',
  vertical = false,
}: {
  className?: string
  vertical?: boolean
}) => {
  const quizHistory = homeStore((s) => s.quizHistory)
  const [selectedBadge, setSelectedBadge] = useState<
    'multiple_choice' | 'written' | null
  >(null)

  const achievementStats = useMemo(() => {
    const multipleChoice = quizHistory.filter(
      (item) => item.questionType !== 'written'
    )
    const written = quizHistory.filter(
      (item) => item.questionType === 'written'
    )
    return {
      multipleChoiceCount: multipleChoice.length,
      multipleChoiceCorrect: multipleChoice.filter(
        (item) => item.correct === true
      ).length,
      writtenCount: written.length,
      writtenCorrect: written.filter((item) => item.correct === true).length,
    }
  }, [quizHistory])

  const badges = [
    {
      id: 'multiple_choice' as const,
      name: '四択問題',
      earned: achievementStats.multipleChoiceCorrect >= 10,
      tone: 'text-[#24272D] bg-[#ECEEF2] border-[#C8CDD5]',
      correctCount: achievementStats.multipleChoiceCorrect,
      answeredCount: achievementStats.multipleChoiceCount,
      hint: '10問以上正解',
      progressLabel: `${Math.min(
        achievementStats.multipleChoiceCorrect,
        10
      )}/10問`,
      metricLabel: '正解',
      rateLabel: '正答率',
    },
    {
      id: 'written' as const,
      name: '記述問題',
      earned: achievementStats.writtenCorrect >= 10,
      tone: 'text-[#687180] bg-[#F1F3F6] border-[#BCC3CE]',
      correctCount: achievementStats.writtenCorrect,
      answeredCount: achievementStats.writtenCount,
      hint: '10問以上正解',
      progressLabel: `${Math.min(achievementStats.writtenCorrect, 10)}/10問`,
      metricLabel: '正解',
      rateLabel: '正答率',
    },
  ]

  return (
    <section
      className={`chat-achievements rounded-2xl border border-[#E3E8F1] bg-white/96 px-3 py-3 shadow-sm ${
        vertical ? 'chat-achievements-vertical' : 'mt-4'
      } ${className}`}
      aria-label="学習目標"
      data-orientation={vertical ? 'vertical' : 'horizontal'}
    >
      <div className="mb-2 text-xs font-black tracking-wider text-[#24324A]">
        目標
      </div>
      <div className={`grid gap-2 ${vertical ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {badges.map((badge) => {
          const isSelected = selectedBadge === badge.id
          const accuracy = formatAccuracy(
            badge.correctCount,
            badge.answeredCount
          )

          return (
            <button
              key={badge.id}
              type="button"
              onClick={() => setSelectedBadge(isSelected ? null : badge.id)}
              aria-expanded={isSelected}
              className={`rounded-xl border px-2 py-2 text-center ${
                badge.earned
                  ? badge.tone
                  : 'border-[#E1E6EE] bg-white text-[#A7B0BE]'
              } transition hover:border-[#AFC0DC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2D62B5] focus-visible:ring-offset-1`}
              title={badge.earned ? `${badge.name}バッジ獲得` : badge.hint}
            >
              <PawIcon
                className={`mx-auto h-6 w-6 ${badge.earned ? '' : 'opacity-35'}`}
              />
              <div className="mt-1 text-[10px] font-black leading-4">
                {badge.name}
              </div>
              {isSelected ? (
                <div className="mt-1 text-[9px] font-semibold leading-4">
                  <div>
                    {badge.metricLabel} {badge.correctCount}/
                    {badge.answeredCount}問
                  </div>
                  <div>
                    {badge.rateLabel} {accuracy}
                  </div>
                  {badge.earned && <div>獲得済み</div>}
                </div>
              ) : (
                <div className="mt-0.5 text-[9px] font-semibold leading-4">
                  {badge.progressLabel}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

export const QuizPerformanceSummary = ({
  className = '',
  compact = false,
  modern = false,
  showAchievements = true,
}: {
  className?: string
  compact?: boolean
  modern?: boolean
  showAchievements?: boolean
}) => {
  const quizHistory = homeStore((s) => s.quizHistory)
  const learningSetProgress = homeStore((s) => s.learningSetProgress)
  const learningActivitySummary = homeStore((s) => s.learningActivitySummary)
  const [activeHistoryPanel, setActiveHistoryPanel] = useState<
    'history' | 'review' | null
  >(null)
  const [openedAnswerIds, setOpenedAnswerIds] = useState<string[]>([])

  const stats = useMemo(() => {
    const answeredCount = quizHistory.length
    const quizCount = answeredCount
    const correctCount = quizHistory.filter(
      (item) => item.correct === true
    ).length
    const incorrectCount = quizHistory.filter(
      (item) => item.correct === false
    ).length

    let currentStreak = 0
    for (let index = quizHistory.length - 1; index >= 0; index -= 1) {
      if (quizHistory[index].correct === true) {
        currentStreak += 1
      } else {
        break
      }
    }

    return {
      quizCount,
      correctCount,
      incorrectCount,
      currentStreak,
      accuracy: formatAccuracy(correctCount, answeredCount),
    }
  }, [quizHistory])

  const reviewQuizHistory = useMemo(
    () =>
      quizHistory
        .filter((item) => {
          if (!item.correct) return true
          if (typeof item.responseTimeMs !== 'number') return false
          const limit = item.questionType === 'written' ? 180000 : 60000
          return item.responseTimeMs > limit
        })
        .slice()
        .reverse(),
    [quizHistory]
  )

  const quizHistoryLatestFirst = useMemo(
    () => quizHistory.slice().reverse(),
    [quizHistory]
  )

  const toggleAnswerVisibility = (id: string) => {
    setOpenedAnswerIds((prev) =>
      prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]
    )
  }

  useEffect(() => {
    if (!activeHistoryPanel) return
    const previousOverflow = document.body.style.overflow
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveHistoryPanel(null)
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeWithEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeWithEscape)
    }
  }, [activeHistoryPanel])

  const renderQuizHistoryList = (
    items: QuizHistoryItem[],
    labelPrefix: string,
    showResult: boolean
  ) => (
    <div className="chat-history-list mt-3 space-y-3 pr-1">
      {items.map((item, index) => (
        <div
          key={`${labelPrefix}-${item.id}`}
          className="rounded-2xl border border-[#D1DFF6] bg-[#F8FBFF] px-4 py-4 text-sm text-[#24324A]"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#DCE8FF] px-2.5 py-1 text-[11px] font-bold text-[#2D63C8]">
              {labelPrefix} {index + 1}
            </span>
            {showResult ? (
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                  item.correct
                    ? 'bg-[#E8F8EE] text-[#1B8A4A]'
                    : 'bg-[#F4ECFA] text-[#755D98]'
                }`}
              >
                {item.assessmentLevel === 'understood'
                  ? '理解できている'
                  : item.assessmentLevel === 'partial'
                    ? '一部理解'
                    : item.assessmentLevel === 'review'
                      ? '要復習'
                      : item.correct
                        ? '正解'
                        : '不正解'}
              </span>
            ) : null}
            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#5E79A8]">
              {item.questionType === 'written' ? '記述式' : '4択'}
            </span>
            {typeof item.responseTimeMs === 'number' ? (
              <span className="text-[11px] font-semibold text-[#7A8EAB]">
                回答時間 {Math.max(1, Math.round(item.responseTimeMs / 1000))}秒
              </span>
            ) : null}
            {typeof item.quizIndex === 'number' ? (
              <span className="text-[11px] font-semibold text-[#7A8EAB]">
                {item.quizIndex}問目
              </span>
            ) : null}
          </div>

          <div className="mt-3 font-bold leading-7">{item.question}</div>

          {Array.isArray(item.choices) && item.choices.length > 0 ? (
            <div className="mt-3 space-y-1 text-[13px] leading-6 text-[#4D5E77]">
              {item.choices.map((choice, choiceIndex) => (
                <div key={`${item.id}-${choiceIndex}`}>
                  {String.fromCharCode(65 + choiceIndex)}. {choice}
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => toggleAnswerVisibility(item.id)}
              className="rounded-full bg-[#DCE8FF] px-4 py-2 text-sm font-bold text-[#2D63C8] transition-colors hover:bg-[#CFDEFF]"
            >
              {openedAnswerIds.includes(item.id)
                ? '正解と解説を閉じる'
                : '正解と解説を見る'}
            </button>
          </div>

          {openedAnswerIds.includes(item.id) ? (
            <div className="mt-4 space-y-3">
              <div className="space-y-1 leading-7">
                <div>
                  <span className="font-bold">あなたの回答：</span>
                  <span>{item.userAnswer}</span>
                </div>
                <div>
                  <span className="font-bold">正解：</span>
                  <span>{item.correctAnswer || '未設定'}</span>
                </div>
              </div>

              {item.explanation ? (
                <div className="rounded-xl bg-[#EEF5FF] px-3 py-3 leading-7 text-[#4D5E77]">
                  <span className="font-bold text-[#2D63C8]">解説：</span>
                  {item.explanation}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )

  const cumulativeAnswered =
    learningSetProgress?.cumulativeAnswered ??
    learningSetProgress?.answered ??
    0
  const initialGoalActive = cumulativeAnswered < 10
  const progressTotal = initialGoalActive ? 10 : 5
  const progressAnswered = initialGoalActive
    ? cumulativeAnswered
    : cumulativeAnswered % 5
  const nextFeedbackAt = initialGoalActive
    ? 10
    : cumulativeAnswered - (cumulativeAnswered % 5) + 5

  return (
    <div
      className={`chat-score rounded-[28px] border border-[#BECFE3] bg-white/96 px-5 py-4 shadow-lg backdrop-blur-md ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold tracking-[0.24em] text-[#758BAA]">
            LEARNING PROGRESS
          </div>
          <div className="mt-1 text-base font-bold text-[#24324A]">
            学習状況
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-[#6B7F9C]">
            <ClockIcon className="h-4 w-4" aria-hidden="true" />
            学習時間{' '}
            {formatLearningTime(learningActivitySummary?.totalActiveMs || 0)}
          </div>
        </div>
        <div className="chat-accuracy text-right">
          <div className="text-xs text-[#758BAA]">正答率</div>
          <div className="text-3xl font-black text-[#2C79EE]">
            {stats.accuracy}
          </div>
        </div>
      </div>

      {modern && (
        <div className="chat-progress-track" aria-hidden="true">
          <div
            style={{
              width: stats.quizCount
                ? `${(stats.correctCount / stats.quizCount) * 100}%`
                : '0%',
            }}
          />
        </div>
      )}
      <div className="mt-4">
        <div
          data-modern={modern || undefined}
          className={`chat-metrics grid gap-2 text-sm ${
            compact ? 'grid-cols-2' : 'grid-cols-4'
          }`}
        >
          <div className="min-h-[78px] rounded-2xl bg-[#F7FAFE] px-3 py-3">
            <div className="text-[11px] text-[#758BAA]">出題数</div>
            <div className="mt-2 text-xl font-bold text-[#526682]">
              {stats.quizCount}
            </div>
          </div>
          <div className="min-h-[78px] rounded-2xl bg-[#F4F8FF] px-3 py-3">
            <div className="text-[11px] text-[#4B72C1]">正答数</div>
            <div className="mt-2 text-xl font-bold text-[#2C79EE]">
              {stats.correctCount}
            </div>
          </div>
          <div className="min-h-[78px] rounded-2xl bg-[#FAF8FC] px-3 py-3">
            <div className="text-[11px] text-[#856DA1]">誤答数</div>
            <div className="mt-2 text-xl font-bold text-[#755D98]">
              {stats.incorrectCount}
            </div>
          </div>
          {!modern && (
            <div className="min-h-[78px] rounded-2xl bg-[#F6FAFE] px-3 py-3">
              <div className="text-[11px] text-[#5C7DAD]">連続正答</div>
              <div className="mt-2 text-xl font-bold text-[#4B72C1]">
                {stats.currentStreak}
              </div>
            </div>
          )}
        </div>
      </div>

      {showAchievements ? <QuizAchievementBadges /> : null}

      <section
        className="mt-4 rounded-2xl border border-[#D8E5FA] bg-[#F7FAFF] px-4 py-3"
        aria-label="学習目標"
      >
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-bold text-[#2D63C8]">
            {initialGoalActive
              ? 'まずは10問解いてみよう'
              : `次は${nextFeedbackAt}問まで続けてみよう`}
          </span>
          <span className="font-bold text-[#526682]">
            {progressAnswered}/{progressTotal}問
          </span>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-[#DDE7F5]"
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full bg-[#2C79EE] transition-all"
            style={{
              width: `${Math.min(100, (progressAnswered / progressTotal) * 100)}%`,
            }}
          />
        </div>
        <p className="mt-2 text-xs text-[#6B7F9C]">
          {learningSetProgress?.feedbackUpdated
            ? `${cumulativeAnswered}問時点のフィードバックを更新しました。そのまま次の問題にも進めます。`
            : `あと${progressTotal - progressAnswered}問でフィードバックを更新します。`}
        </p>
      </section>

      {learningSetProgress?.feedback ? (
        <section className="mt-4 rounded-2xl border border-[#CFE2D8] bg-[#F5FBF7] px-4 py-4">
          <div className="text-sm font-bold text-[#22613B]">
            {learningSetProgress.feedback.checkpointAnswered || 10}
            問回答時点のフィードバック
          </div>
          {learningSetProgress.feedback.llmMessage ? (
            <div className="mt-3 rounded-xl border border-[#D8E9DE] bg-white px-3 py-3 text-sm leading-6 text-[#355548]">
              {learningSetProgress.feedback.llmMessage}
            </div>
          ) : null}
          <p className="mt-1 text-xs leading-5 text-[#5C806B]">
            {learningSetProgress.feedback.message}
          </p>
        </section>
      ) : null}

      {modern && (
        <div className="chat-streak">
          <FireIcon aria-hidden="true" />
          <span>
            連続正答 <strong>{stats.currentStreak}問</strong>
          </span>
        </div>
      )}
      {quizHistoryLatestFirst.length === 0 && (
        <p className="chat-score-empty">
          問題に答えると、ここに学習の記録がたまります。
        </p>
      )}
      {quizHistoryLatestFirst.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveHistoryPanel('history')}
            aria-haspopup="dialog"
            className="chat-history-card flex min-h-[86px] flex-col items-start justify-between rounded-xl border border-[#D6E2F5] bg-[#F7FAFF] p-3 text-left transition-colors hover:bg-[#EEF5FF]"
          >
            <span className="flex items-center gap-2 text-xs font-bold text-[#526682]">
              <ClockIcon className="h-4 w-4" aria-hidden="true" />
              出題履歴
            </span>
            <span className="text-lg font-black text-[#2D63C8]">
              {quizHistoryLatestFirst.length}問
            </span>
          </button>
          {reviewQuizHistory.length > 0 ? (
            <button
              type="button"
              onClick={() => setActiveHistoryPanel('review')}
              aria-haspopup="dialog"
              className="chat-history-card flex min-h-[86px] flex-col items-start justify-between rounded-xl border border-[#E3D9EC] bg-[#FAF8FC] p-3 text-left transition-colors hover:bg-[#F4ECFA]"
            >
              <span className="text-xs font-bold text-[#6D5A87]">復習候補</span>
              <span className="text-lg font-black text-[#755D98]">
                {reviewQuizHistory.length}問
              </span>
            </button>
          ) : (
            <div className="flex min-h-[86px] flex-col items-start justify-between rounded-xl border border-[#D9EADD] bg-[#F5FBF7] p-3">
              <span className="text-xs font-bold text-[#4F715C]">復習候補</span>
              <span className="text-sm font-bold text-[#1B8A4A]">0問</span>
            </div>
          )}
        </div>
      ) : null}

      {activeHistoryPanel && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="chat-history-modal fixed inset-0 z-[100] flex items-center justify-center bg-[#172033]/45 p-3 backdrop-blur-sm md:p-8"
              role="dialog"
              aria-modal="true"
              aria-labelledby="quiz-history-title"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target)
                  setActiveHistoryPanel(null)
              }}
            >
              <div className="flex max-h-[88svh] w-full max-w-4xl flex-col overflow-hidden rounded-[24px] border border-[#D6E2F5] bg-white shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-[#E4EAF3] px-5 py-4 md:px-7">
                  <div>
                    <h2
                      id="quiz-history-title"
                      className="text-lg font-black text-[#24324A]"
                    >
                      {activeHistoryPanel === 'history'
                        ? 'これまでに出題された問題'
                        : '復習候補を確認'}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-[#6B7F9C]">
                      {activeHistoryPanel === 'history'
                        ? `${quizHistoryLatestFirst.length}問の問題文・回答・解説を確認できます。`
                        : `${reviewQuizHistory.length}問あります。誤答または回答に時間がかかった問題を、もう一度整理してみよう。`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveHistoryPanel(null)}
                    className="rounded-full border border-[#D6E2F5] bg-white p-2 text-[#526682] hover:bg-[#F4F7FC]"
                    aria-label="閉じる"
                  >
                    <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
                <div className="overflow-y-auto px-4 pb-6 md:px-7">
                  {activeHistoryPanel === 'history'
                    ? renderQuizHistoryList(
                        quizHistoryLatestFirst,
                        '履歴',
                        true
                      )
                    : renderQuizHistoryList(reviewQuizHistory, '復習', false)}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
