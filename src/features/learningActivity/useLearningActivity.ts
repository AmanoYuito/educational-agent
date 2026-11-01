import { useCallback, useEffect, useRef } from 'react'

import {
  loadLearningActivitySummary,
  saveLearningActivity,
  type LearningActivityEventInput,
} from '../../../app/lib/api/client'
import homeStore from '@/features/stores/home'

type ViewMode = 'material' | 'avatar'

export type LearningActivityReporter = (
  input: Omit<LearningActivityEventInput, 'id' | 'lessonId' | 'viewMode'> & {
    viewMode?: ViewMode
  }
) => void

const newEventId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `activity-${Date.now()}-${Math.random().toString(36).slice(2)}`

export const useLearningActivity = ({
  lessonId,
  viewMode,
  isProblemMode,
}: {
  lessonId: string
  viewMode: ViewMode
  isProblemMode: boolean
}) => {
  const contextRef = useRef({ lessonId, viewMode, isProblemMode })
  const lastInteractionAtRef = useRef(Date.now())
  const lastTickAtRef = useRef(Date.now())

  useEffect(() => {
    contextRef.current = { lessonId, viewMode, isProblemMode }
  }, [isProblemMode, lessonId, viewMode])

  const recordActivity: LearningActivityReporter = useCallback(
    (
      input: Omit<
        LearningActivityEventInput,
        'id' | 'lessonId' | 'viewMode'
      > & { viewMode?: ViewMode }
    ) => {
      const context = contextRef.current
      const event: LearningActivityEventInput = {
        id: newEventId(),
        lessonId: context.lessonId,
        viewMode: input.viewMode || context.viewMode,
        ...input,
        metadata: {
          isProblemMode: context.isProblemMode,
          ...(input.metadata || {}),
        },
      }
      void saveLearningActivity([event]).catch((error) =>
        console.error('学習行動ログを保存できませんでした:', error)
      )
    },
    []
  )

  useEffect(() => {
    homeStore.setState({ learningActivitySummary: null })
    void loadLearningActivitySummary(lessonId)
      .then((summary) =>
        homeStore.setState({ learningActivitySummary: summary })
      )
      .catch((error) => console.error('学習時間を取得できませんでした:', error))
    recordActivity({
      eventType: 'page_enter',
      metadata: {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        touchEnabled: navigator.maxTouchPoints > 0,
      },
    })
  }, [lessonId, recordActivity])

  useEffect(() => {
    recordActivity({ eventType: 'workspace_view', viewMode })
  }, [recordActivity, viewMode])

  useEffect(() => {
    const markInteraction = () => {
      lastInteractionAtRef.current = Date.now()
    }
    const events: Array<keyof WindowEventMap> = [
      'pointerdown',
      'keydown',
      'wheel',
      'touchstart',
      'focus',
    ]
    events.forEach((name) =>
      window.addEventListener(name, markInteraction, { passive: true })
    )

    const flushActiveTime = () => {
      const now = Date.now()
      const elapsed = Math.min(35000, now - lastTickAtRef.current)
      lastTickAtRef.current = now
      const recentlyActive = now - lastInteractionAtRef.current <= 120000
      if (
        document.visibilityState !== 'visible' ||
        !recentlyActive ||
        elapsed < 1000
      )
        return

      const context = contextRef.current
      recordActivity({
        eventType: 'active_time',
        viewMode: context.viewMode,
        durationMs: elapsed,
      })
      const current = homeStore.getState().learningActivitySummary
      if (!current) return
      homeStore.setState({
        learningActivitySummary: {
          ...current,
          totalActiveMs: current.totalActiveMs + elapsed,
          materialActiveMs:
            current.materialActiveMs +
            (context.viewMode === 'material' ? elapsed : 0),
          avatarActiveMs:
            current.avatarActiveMs +
            (context.viewMode === 'avatar' ? elapsed : 0),
          quizActiveMs:
            current.quizActiveMs + (context.isProblemMode ? elapsed : 0),
          conversationActiveMs:
            current.conversationActiveMs +
            (!context.isProblemMode ? elapsed : 0),
        },
      })
    }

    const interval = window.setInterval(flushActiveTime, 30000)
    const handlePageHide = () => flushActiveTime()
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      flushActiveTime()
      window.clearInterval(interval)
      window.removeEventListener('pagehide', handlePageHide)
      events.forEach((name) =>
        window.removeEventListener(name, markInteraction)
      )
    }
  }, [recordActivity])

  return { recordActivity }
}
