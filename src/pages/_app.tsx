import '@charcoal-ui/icons'
import type { AppProps } from 'next/app'
import React, { useEffect, useRef } from 'react'
import { Analytics } from '@vercel/analytics/react'

import { isLanguageSupported } from '@/features/constants/settings'
import homeStore, { restoreServerHomeState } from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import '@/styles/globals.css'
import '@/styles/themes.css'
import { withBasePath } from '@/utils/basePath'
import migrateStore from '@/utils/migrateStore'
import i18n from '../lib/i18n'

export default function App({ Component, pageProps }: AppProps) {
  const initializedRef = useRef(false)
  const authenticatedRef = useRef(false)
  const lastSavedLearningStateRef = useRef('')
  const initialLessonIdRef = useRef(
    typeof pageProps?.lesson?.id === 'string' ? pageProps.lesson.id : ''
  )

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    const waitForHydration = async (store: any) => {
      const persistApi = store?.persist
      if (!persistApi) return
      if (persistApi.hasHydrated?.()) return
      if (!persistApi.onFinishHydration) return
      await new Promise<void>((resolve) => {
        const unsubscribe = persistApi.onFinishHydration?.(() => {
          unsubscribe?.()
          resolve()
        })
      })
    }

    const initializeApp = async () => {
      const activeLessonId = initialLessonIdRef.current
      await waitForHydration(settingsStore)
      await waitForHydration(homeStore)

      if (typeof window !== 'undefined') {
        ;(window as any).homeStore = homeStore
      }

      if ((homeStore as any).persist?.clearStorage) {
        ;(homeStore as any).persist.clearStorage()
      }
      restoreServerHomeState({
        chatLog: [],
        latestGeneratedQuizMemory: null,
        quizHistory: [],
      })
      homeStore.setState({
        showIntroduction: false,
        selectedLessonId: activeLessonId || undefined,
        activeLessonQuestionCount: null,
        activeLessonMasteredQuestionIds: [],
      })
      settingsStore.setState({ difyConversationId: '' })

      const hs = homeStore.getState()
      const ss = settingsStore.getState()

      if (!hs.userOnboarded) {
        migrateStore()

        const browserLanguage = navigator.language
        const languageCode = browserLanguage.match(/^zh/i)
          ? 'zh'
          : browserLanguage.split('-')[0].toLowerCase()

        let language = ss.selectLanguage
        if (!language) {
          language = isLanguageSupported(languageCode) ? languageCode : 'ja'
        }
        i18n.changeLanguage(language)
        settingsStore.setState({ selectLanguage: language })
        homeStore.setState({ userOnboarded: true })
      } else {
        i18n.changeLanguage(ss.selectLanguage)
      }

      document.documentElement.setAttribute('data-theme', ss.colorTheme)
      try {
        const response = await fetch(withBasePath('/api/auth/me/'), {
          credentials: 'include',
        })
        if (!response.ok) {
          authenticatedRef.current = false
          return
        }

        authenticatedRef.current = true

        if (!activeLessonId) return

        const historyResponse = await fetch(
          withBasePath(
            `/api/user-history/?lesson=${encodeURIComponent(activeLessonId)}`
          ),
          {
            credentials: 'include',
          }
        )
        if (historyResponse.ok) {
          const data = await historyResponse.json()
          restoreServerHomeState({
            chatLog: Array.isArray(data.chatMessages) ? data.chatMessages : [],
            quizHistory: Array.isArray(data.quizHistory)
              ? data.quizHistory
              : [],
            latestGeneratedQuizMemory: data.latestGeneratedQuizMemory || null,
            learningSetProgress: data.learningSetProgress || null,
          })
          homeStore.setState({
            activeLessonQuestionCount:
              typeof data.activeLessonQuestionCount === 'number'
                ? data.activeLessonQuestionCount
                : null,
            activeLessonMasteredQuestionIds: Array.isArray(
              data.activeLessonMasteredQuestionIds
            )
              ? data.activeLessonMasteredQuestionIds.filter(
                  (id: unknown): id is string => typeof id === 'string'
                )
              : [],
          })

          settingsStore.setState({
            difyConversationId: data.difyConversationId || '',
          })

          lastSavedLearningStateRef.current = JSON.stringify({
            lessonId: activeLessonId,
            latestGeneratedQuizMemory: data.latestGeneratedQuizMemory || null,
            difyConversationId: data.difyConversationId || '',
          })
        }
      } catch {
        authenticatedRef.current = false
        // Authentication display is handled by each page.
      }
    }

    void initializeApp()
  }, [])

  useEffect(() => {
    let saveTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleSave = () => {
      if (!authenticatedRef.current) return

      if (saveTimer) {
        clearTimeout(saveTimer)
      }

      saveTimer = setTimeout(() => {
        const lessonId = homeStore.getState().selectedLessonId
        if (!lessonId) return
        const payload = {
          lessonId,
          latestGeneratedQuizMemory:
            homeStore.getState().latestGeneratedQuizMemory || null,
          difyConversationId: settingsStore.getState().difyConversationId || '',
        }
        const serialized = JSON.stringify(payload)

        if (serialized === lastSavedLearningStateRef.current) {
          return
        }

        void fetch(withBasePath('/api/user-state/'), {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: serialized,
        })
          .then((response) => {
            if (response.ok) {
              lastSavedLearningStateRef.current = serialized
            }
          })
          .catch(() => {
            // Ignore temporary persistence failures in the UI.
          })
      }, 500)
    }

    const unsubscribeHome = homeStore.subscribe((state, prevState) => {
      if (
        state.latestGeneratedQuizMemory !== prevState.latestGeneratedQuizMemory
      ) {
        scheduleSave()
      }
    })

    const unsubscribeSettings = settingsStore.subscribe((state, prevState) => {
      if (state.difyConversationId !== prevState.difyConversationId) {
        scheduleSave()
      }
    })

    return () => {
      unsubscribeHome()
      unsubscribeSettings()
      if (saveTimer) {
        clearTimeout(saveTimer)
      }
    }
  }, [])

  return (
    <>
      <Component {...pageProps} />
      <Analytics />
    </>
  )
}
