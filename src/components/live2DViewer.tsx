'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Script from 'next/script'
import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import {
  QuizAchievementBadges,
  QuizPerformanceSummary,
} from './quizPerformanceSummary'
import { useViewportLayout } from '@/hooks/useViewportLayout'
import { withBasePath } from '@/utils/basePath'
import { getChatPaneWidth } from '@/utils/responsiveLayout'

const Live2DComponent = dynamic(
  () => {
    console.log('Loading Live2DComponent...')
    return import('./Live2DComponent')
      .then((mod) => mod.default)
      .then((mod) => {
        console.log('Live2DComponent loaded successfully')
        return mod
      })
      .catch((err) => {
        console.error('Failed to load Live2DComponent:', err)
        throw err
      })
  },
  {
    ssr: false,
    loading: () => {
      console.log('Live2DComponent is loading...')
      return null
    },
  }
)

const isLive2DEmotionDisabled = () =>
  typeof window !== 'undefined' &&
  (window as any).__disableLive2DEmotion === true

const PERSISTENT_AVATAR_MIN_RIGHT_SPACE = 280

const getCurrentViewportWidth = () => {
  if (typeof window === 'undefined') return 0
  return Math.round(
    Math.max(
      window.innerWidth,
      document.documentElement.clientWidth || 0,
      window.visualViewport?.width || 0
    )
  )
}

const hasPersistentAvatarSpace = (
  viewportWidth: number,
  chatLogWidth: number
) => {
  if (viewportWidth <= 0) return false
  const chatPaneWidth = getChatPaneWidth(viewportWidth, chatLogWidth)
  const rightSpaceWidth = viewportWidth - chatPaneWidth
  return rightSpaceWidth >= PERSISTENT_AVATAR_MIN_RIGHT_SPACE
}

const AUTO_RESTORE_MOTION_GROUPS = new Set([
  'excited1',
  'bored1',
  'glad1',
  'relax_1',
  'sad1',
  'frustrated1',
  'frustrated2',
  'frustrated3',
])

const isViewerMotionReady = (viewer: any) => {
  return !!(
    viewer &&
    typeof viewer.motion === 'function' &&
    viewer.internalModel &&
    viewer.internalModel.motionManager
  )
}

export default function Live2DViewer({
  modern = false,
  workspaceView = 'avatar',
  onAvatarSelect,
  // Kept optional for compatibility with older server bundles that still pass
  // the mode flag. The viewer derives the visible mode from the chat state.
  isProblemMode: _isProblemMode,
}: {
  modern?: boolean
  workspaceView?: 'material' | 'avatar'
  onAvatarSelect?: () => void
  isProblemMode?: boolean
}) {
  const MOTION_AUTO_RESTORE_MS = 3330
  const AVATAR_BURST_DEFAULT_MS = 3000
  const sadnessEyeLockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const autoRestoreMotionTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null)
  const avatarBurstTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const clearSadnessEyeLockTimeout = useCallback(() => {
    if (!sadnessEyeLockTimeoutRef.current) return
    clearTimeout(sadnessEyeLockTimeoutRef.current)
    sadnessEyeLockTimeoutRef.current = null
  }, [])
  const clearAutoRestoreMotionTimeout = useCallback(() => {
    if (!autoRestoreMotionTimeoutRef.current) return
    clearTimeout(autoRestoreMotionTimeoutRef.current)
    autoRestoreMotionTimeoutRef.current = null
  }, [])

  // Emits events that Live2DComponent listens to.
  const emitEmotion = useCallback((params: Record<string, number>) => {
    if (typeof window === 'undefined') return
    if (isLive2DEmotionDisabled()) return

    // Prefer same-tab direct API if Live2DComponent exposed it
    // NOTE: to be robust across implementations, pass BOTH {rage/sweat} and {PARAM_RAGE/PARAM_SWEAT}
    const fn = (window as any).__live2dApplyEmotion as
      | ((v: {
          rage?: number
          sweat?: number
          PARAM_RAGE?: number
          PARAM_SWEAT?: number
        }) => void)
      | undefined

    const rage =
      typeof params.PARAM_RAGE === 'number' ? params.PARAM_RAGE : undefined
    const sweat =
      typeof params.PARAM_SWEAT === 'number' ? params.PARAM_SWEAT : undefined

    const payload: {
      rage?: number
      sweat?: number
      PARAM_RAGE?: number
      PARAM_SWEAT?: number
    } = {}
    if (typeof rage === 'number') {
      payload.rage = rage
      payload.PARAM_RAGE = rage
    }
    if (typeof sweat === 'number') {
      payload.sweat = sweat
      payload.PARAM_SWEAT = sweat
    }

    if (typeof fn === 'function') {
      console.log('[Live2DViewer] using window.__live2dApplyEmotion', payload)
      try {
        fn(payload)
      } catch (e) {
        console.warn(
          '[Live2DViewer] __live2dApplyEmotion failed, will fallback to event',
          e
        )
      }
    }

    console.log('[Live2DViewer] dispatching CustomEvent live2d:emotion', params)
    window.dispatchEvent(
      new CustomEvent('live2d:emotion', {
        detail: { params, ...payload },
      })
    )
  }, [])

  const emitHappy = useCallback((on: boolean) => {
    if (typeof window === 'undefined') return
    if (isLive2DEmotionDisabled()) return

    const fn = (window as any).__live2dSetHappy as
      | ((v: boolean | { on: boolean }) => void)
      | undefined
    if (typeof fn === 'function') {
      console.log('[Live2DViewer] using window.__live2dSetHappy', !!on)
      try {
        // Try boolean first (older implementation)
        fn(!!on)
      } catch (e1) {
        try {
          // Fallback to object form
          fn({ on: !!on })
        } catch (e2) {
          console.warn(
            '[Live2DViewer] __live2dSetHappy failed, will fallback to event',
            e2
          )
        }
      }
    }

    console.log('[Live2DViewer] dispatching CustomEvent live2d:happy', {
      on: !!on,
    })
    window.dispatchEvent(
      new CustomEvent('live2d:happy', {
        detail: { on: !!on },
      })
    )
  }, [])

  const setSadVisual = useCallback((mode: 'off' | 'rain' | 'haze' | 'wind') => {
    if (typeof window === 'undefined') return
    if (isLive2DEmotionDisabled()) return

    const setRain = (window as any).__live2dSetSadRain as
      | ((on: boolean) => void)
      | undefined
    const setHaze = (window as any).__live2dSetSadHaze as
      | ((on: boolean) => void)
      | undefined
    const setWind = (window as any).__live2dSetSadWind as
      | ((on: boolean) => void)
      | undefined

    const rainOn = mode === 'rain'
    const hazeOn = mode === 'haze'
    const windOn = mode === 'wind'

    try {
      setRain?.(rainOn)
      setHaze?.(hazeOn)
      setWind?.(windOn)
    } catch (e) {
      console.warn('[Live2DViewer] failed to update sad visual:', e)
    }
  }, [])

  const { idleMotionGroup } = settingsStore((s) => ({
    idleMotionGroup: s.idleMotionGroup,
  }))
  const chatLogWidth = settingsStore((s) => s.chatLogWidth)
  const { layoutStage, rightRailWidth, viewportWidth } = useViewportLayout()
  const [isMobileSummaryOpen, setIsMobileSummaryOpen] = useState(false)
  const [isAvatarBurstVisible, setIsAvatarBurstVisible] = useState(false)
  const isMaterialWorkspace = modern && workspaceView === 'material'
  const shouldShowPersistentAvatar = modern
    ? viewportWidth >= (isMaterialWorkspace ? 720 : 960)
    : hasPersistentAvatarSpace(viewportWidth, chatLogWidth)
  const shouldShowAvatar = shouldShowPersistentAvatar || isAvatarBurstVisible
  const chatPaneWidth =
    viewportWidth > 0 ? getChatPaneWidth(viewportWidth, chatLogWidth) : 0
  const persistentAvatarLeft = Math.min(viewportWidth, chatPaneWidth + 12)

  const isPersistentAvatarLayoutNow = useCallback(() => {
    if (typeof window === 'undefined') return shouldShowPersistentAvatar
    if (modern) return getCurrentViewportWidth() >= 960
    return hasPersistentAvatarSpace(
      getCurrentViewportWidth(),
      settingsStore.getState().chatLogWidth
    )
  }, [shouldShowPersistentAvatar, modern])

  const showAvatarBurst = useCallback(
    (durationMs = AVATAR_BURST_DEFAULT_MS) => {
      setIsAvatarBurstVisible(true)
      if (avatarBurstTimeoutRef.current) {
        clearTimeout(avatarBurstTimeoutRef.current)
      }
      avatarBurstTimeoutRef.current = setTimeout(() => {
        setIsAvatarBurstVisible(false)
        avatarBurstTimeoutRef.current = null
      }, durationMs)
    },
    []
  )

  const resolveMotionGroup = (
    group: string,
    available?: Record<string, unknown>
  ) => {
    if (!available) return group
    if (available[group]) return group

    const target = group.toLowerCase()
    const match = Object.keys(available).find(
      (key) => key.toLowerCase() === target
    )
    return match || group
  }

  const playMotionGroup = useCallback(
    (group?: string) => {
      if (!group) return
      clearSadnessEyeLockTimeout()
      clearAutoRestoreMotionTimeout()
      const live2dViewer = homeStore.getState().live2dViewer
      const fallbackViewer =
        typeof window !== 'undefined' ? (window as any).__live2d : undefined
      const targetViewer = isViewerMotionReady(live2dViewer)
        ? live2dViewer
        : isViewerMotionReady(fallbackViewer)
          ? fallbackViewer
          : null
      if (!targetViewer) return
      if (!targetViewer || typeof targetViewer.motion !== 'function') return
      try {
        const clearLocks = (window as any).__live2dClearParamLocks as
          | (() => void)
          | undefined
        if (typeof clearLocks === 'function') {
          clearLocks()
        }
        const available =
          targetViewer?.internalModel?.motionManager?.motionGroups
        const resolved = resolveMotionGroup(group, available)
        targetViewer.motion(resolved, undefined, 3)
        const setLocks = (window as any).__live2dSetParamLocks as
          | ((params: Record<string, number>, replace?: boolean) => void)
          | undefined
        if (
          resolved.toLowerCase() === 'sad1' &&
          typeof setLocks === 'function'
        ) {
          setLocks(
            {
              PARAM_EYE_L_OPEN: 0,
              PARAM_EYE_R_OPEN: 0,
            },
            false
          )
          sadnessEyeLockTimeoutRef.current = setTimeout(() => {
            try {
              const releaseLocks = (window as any).__live2dClearParamLocks as
                | (() => void)
                | undefined
              if (typeof releaseLocks === 'function') {
                releaseLocks()
              }
            } finally {
              sadnessEyeLockTimeoutRef.current = null
            }
          }, MOTION_AUTO_RESTORE_MS)
        }

        if (AUTO_RESTORE_MOTION_GROUPS.has(resolved.toLowerCase())) {
          autoRestoreMotionTimeoutRef.current = setTimeout(() => {
            try {
              try {
                targetViewer?.stopMotions?.()
                targetViewer?.internalModel?.motionManager?.stopAllMotions?.()
              } catch {}

              const releaseLocks = (window as any).__live2dClearParamLocks as
                | (() => void)
                | undefined
              const setLocks = (window as any).__live2dSetParamLocks as
                | ((params: Record<string, number>, replace?: boolean) => void)
                | undefined
              const core = targetViewer?.internalModel?.coreModel
              const resetParams: Record<string, number> = {
                PARAM_TEAR: 0,
                PARAM_RAGE: 0,
                PARAM_SWEAT: 0,
                PARAM_FACE_01: 0,
              }
              if (core?.setParameterValueById) {
                for (const [paramId, value] of Object.entries(resetParams)) {
                  core.setParameterValueById(paramId, value)
                }
              }
              if (typeof setLocks === 'function') {
                setLocks(resetParams, false)
              }
              const idleResolved = resolveMotionGroup(
                idleMotionGroup,
                available
              )
              targetViewer.motion(idleResolved, undefined, 3)
              if (typeof releaseLocks === 'function') {
                setTimeout(() => {
                  releaseLocks()
                }, 200)
              }
            } finally {
              autoRestoreMotionTimeoutRef.current = null
            }
          }, MOTION_AUTO_RESTORE_MS)
        }
      } catch (e) {
        console.warn('[Live2DViewer] motion failed:', e)
      }
    },
    [clearAutoRestoreMotionTimeout, clearSadnessEyeLockTimeout, idleMotionGroup]
  )

  // Public API: allow other components to trigger emotions by name
  const applyEmotionByName = useCallback(
    (
      emotion:
        | 'happy'
        | 'excited'
        | 'bored'
        | 'relaxed'
        | 'sad'
        | 'sweat'
        | 'rage'
        | 'neutral'
        | 'frustrated1'
        | 'frustrated2',
      _opts?: { durationMs?: number }
    ) => {
      if (isLive2DEmotionDisabled()) return
      clearSadnessEyeLockTimeout()
      clearAutoRestoreMotionTimeout()

      const live2dViewer = homeStore.getState().live2dViewer
      const fallbackViewer =
        typeof window !== 'undefined' ? (window as any).__live2d : undefined
      const targetViewer = isViewerMotionReady(live2dViewer)
        ? live2dViewer
        : isViewerMotionReady(fallbackViewer)
          ? fallbackViewer
          : null
      if (!targetViewer) return

      const clearLocks = (window as any).__live2dClearParamLocks as
        | (() => void)
        | undefined
      const setLocks = (window as any).__live2dSetParamLocks as
        | ((params: Record<string, number>, replace?: boolean) => void)
        | undefined
      if (typeof clearLocks === 'function') {
        clearLocks()
      }

      try {
        targetViewer?.stopMotions?.()
        targetViewer?.internalModel?.motionManager?.stopAllMotions?.()
      } catch {}

      const core = targetViewer?.internalModel?.coreModel
      const resetParams: Record<string, number> = {
        PARAM_TEAR: 0,
        PARAM_FACE_01: 0,
        PARAM_RAGE: 0,
        PARAM_SWEAT: 0,
        PARAM_EYE_L_OPEN: 1,
        PARAM_EYE_R_OPEN: 1,
      }
      if (core?.setParameterValueById) {
        for (const [paramId, value] of Object.entries(resetParams)) {
          core.setParameterValueById(paramId, value)
        }
      }
      if (typeof setLocks === 'function') {
        setLocks(resetParams, false)
      }

      // Always clear first to avoid stuck states
      emitHappy(false)
      emitEmotion({ PARAM_RAGE: 0, PARAM_SWEAT: 0 })
      setSadVisual('off')

      if (emotion === 'happy') {
        emitHappy(true)
        return
      }

      if (emotion === 'excited') {
        emitHappy(true)
        playMotionGroup('excited1')
        return
      }

      if (emotion === 'bored') {
        playMotionGroup('bored1')
        return
      }

      if (emotion === 'relaxed') {
        playMotionGroup('relax_1')
        return
      }

      if (emotion === 'sad') {
        setSadVisual('rain')
        playMotionGroup('sad1')
        return
      }

      if (emotion === 'rage') {
        emitEmotion({ PARAM_RAGE: 1, PARAM_SWEAT: 0 })
        playMotionGroup('frustrated2')
        return
      }

      if (emotion === 'sweat') {
        // Some models do not provide a dedicated "sweat" motion group.
        // Always apply the sweat parameter so wrong-answer feedback is visible.
        emitEmotion({ PARAM_RAGE: 0, PARAM_SWEAT: 1 })
        playMotionGroup('sweat')
        return
      }

      if (emotion === 'frustrated1') {
        playMotionGroup('frustrated1')
        return
      }

      if (emotion === 'frustrated2') {
        playMotionGroup('frustrated2')
        return
      }

      // neutral
      emitHappy(false)
      emitEmotion({ PARAM_RAGE: 0, PARAM_SWEAT: 0 })
    },
    [
      clearAutoRestoreMotionTimeout,
      clearSadnessEyeLockTimeout,
      emitEmotion,
      emitHappy,
      playMotionGroup,
      setSadVisual,
    ]
  )

  useEffect(
    () => () => {
      clearSadnessEyeLockTimeout()
      clearAutoRestoreMotionTimeout()
      if (avatarBurstTimeoutRef.current) {
        clearTimeout(avatarBurstTimeoutRef.current)
        avatarBurstTimeoutRef.current = null
      }
    },
    [clearAutoRestoreMotionTimeout, clearSadnessEyeLockTimeout]
  )

  // Bridge: listen to a simple event and also expose a global function
  useEffect(() => {
    if (typeof window === 'undefined') return

    const onAvatarBurst = (e: Event) => {
      if (isPersistentAvatarLayoutNow()) return
      const detail = (e as CustomEvent).detail || {}
      const durationMs =
        typeof detail.durationMs === 'number'
          ? detail.durationMs
          : AVATAR_BURST_DEFAULT_MS
      showAvatarBurst(durationMs)
    }

    window.addEventListener('quiz:avatar-burst', onAvatarBurst)
    return () => {
      window.removeEventListener('quiz:avatar-burst', onAvatarBurst)
    }
  }, [isPersistentAvatarLayoutNow, showAvatarBurst])

  useEffect(() => {
    if (typeof window === 'undefined') return
    ;(window as any).__setQuizEmotion = (
      emotion:
        | 'happy'
        | 'excited'
        | 'bored'
        | 'relaxed'
        | 'sad'
        | 'sweat'
        | 'rage'
        | 'neutral'
        | 'frustrated1'
        | 'frustrated2',
      opts?: { durationMs?: number }
    ) => {
      if (!isPersistentAvatarLayoutNow() && emotion !== 'neutral') {
        const durationMs = opts?.durationMs ?? AVATAR_BURST_DEFAULT_MS
        showAvatarBurst(durationMs)
        window.setTimeout(() => {
          applyEmotionByName(emotion, opts)
        }, 250)
        return
      }
      applyEmotionByName(emotion, opts)
    }

    const onQuizEmotion = (e: Event) => {
      const detail = (e as CustomEvent).detail || {}
      const emotion = detail.emotion as
        | 'happy'
        | 'excited'
        | 'bored'
        | 'relaxed'
        | 'sad'
        | 'sweat'
        | 'rage'
        | 'neutral'
        | 'frustrated1'
        | 'frustrated2'
        | undefined
      const durationMs =
        typeof detail.durationMs === 'number' ? detail.durationMs : undefined
      if (!emotion) return
      if (!isPersistentAvatarLayoutNow()) {
        showAvatarBurst(durationMs ?? AVATAR_BURST_DEFAULT_MS)
        window.setTimeout(() => {
          applyEmotionByName(emotion, { durationMs })
        }, 250)
        return
      }
      applyEmotionByName(emotion, { durationMs })
    }

    window.addEventListener('quiz:emotion', onQuizEmotion)
    return () => {
      window.removeEventListener('quiz:emotion', onQuizEmotion)
      // keep the global on purpose (useful for debugging), but you can delete if you want
    }
  }, [applyEmotionByName, isPersistentAvatarLayoutNow, showAvatarBurst])

  const [isMounted, setIsMounted] = useState(false)
  const [scriptLoadRetries, setScriptLoadRetries] = useState({
    cubismcore: 0,
    live2d: 0,
  })
  const MAX_RETRIES = 3

  const isCubismCoreLoaded = homeStore((s) => s.isCubismCoreLoaded)
  const setIsCubismCoreLoaded = homeStore((s) => s.setIsCubismCoreLoaded)
  const isLive2dLoaded = homeStore((s) => s.isLive2dLoaded)
  const setIsLive2dLoaded = homeStore((s) => s.setIsLive2dLoaded)

  // スクリプトの再読み込み処理
  const retryLoadScript = (scriptName: 'cubismcore' | 'live2d') => {
    if (scriptLoadRetries[scriptName] < MAX_RETRIES) {
      setScriptLoadRetries((prev) => ({
        ...prev,
        [scriptName]: prev[scriptName] + 1,
      }))
      // 強制的に再読み込みするためにキーを変更
      return true
    }
    return false
  }

  useEffect(() => {
    console.log('Live2DViewer mounted')
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('live2d:layout-mode', {
          detail: { shouldShowPersistentAvatar },
        })
      )
    }

    const clearAvatarBurst = () => {
      setIsAvatarBurstVisible(false)
      if (avatarBurstTimeoutRef.current) {
        clearTimeout(avatarBurstTimeoutRef.current)
        avatarBurstTimeoutRef.current = null
      }
    }

    if (shouldShowPersistentAvatar) {
      setIsMobileSummaryOpen(false)
      clearAvatarBurst()
      if (typeof window !== 'undefined') {
        const dispatchPersistentLayout = () => {
          window.dispatchEvent(
            new CustomEvent('live2d:layout-mode', {
              detail: { shouldShowPersistentAvatar: true },
            })
          )
        }

        dispatchPersistentLayout()
        const resetTimer = window.setTimeout(dispatchPersistentLayout, 320)
        return () => {
          window.clearTimeout(resetTimer)
        }
      }
    } else {
      clearAvatarBurst()
    }
  }, [isMaterialWorkspace, shouldShowPersistentAvatar])

  if (!isMounted) {
    console.log('Live2DViewer not mounted yet')
    return null
  }

  console.log('Rendering Live2DViewer')
  return (
    <div
      className={`pointer-events-none fixed inset-0 ${
        isAvatarBurstVisible || isMobileSummaryOpen ? 'z-30' : 'z-15'
      }`}
    >
      <Script
        key={`cubismcore-${scriptLoadRetries.cubismcore}`}
        src={withBasePath('/scripts/live2dcubismcore.min.js')}
        strategy="afterInteractive"
        onLoad={() => {
          console.log('cubismcore loaded')
          setIsCubismCoreLoaded(true)
        }}
        onError={() => {
          console.error('Failed to load cubism core')
          if (retryLoadScript('cubismcore')) {
            console.log('Retrying cubismcore load...')
          } else {
            console.error('Max retries reached for cubismcore')
          }
        }}
      />
      <div
        className={
          modern && shouldShowPersistentAvatar
            ? `chat-study-rail${isMaterialWorkspace ? ' chat-study-rail-material' : ''}`
            : undefined
        }
      >
        <div className="chat-companion-row">
          <button
            type="button"
            onClick={isMaterialWorkspace ? onAvatarSelect : undefined}
            aria-label={
              isMaterialWorkspace ? 'アバター中心の画面に切り替える' : undefined
            }
            disabled={!isMaterialWorkspace}
            className={
              modern && shouldShowPersistentAvatar
                ? `chat-companion${isMaterialWorkspace ? ' chat-companion-compact pointer-events-auto' : ''}`
                : undefined
            }
          >
            <div
              data-persistent={shouldShowPersistentAvatar}
              data-bounded-avatar={
                modern && shouldShowPersistentAvatar ? 'true' : undefined
              }
              data-compact-avatar={isMaterialWorkspace ? 'true' : undefined}
              className={`chat-avatar-stage pointer-events-none absolute bottom-0 right-0 top-0 transition-all duration-300 ${
                shouldShowAvatar
                  ? 'scale-100 opacity-100'
                  : 'scale-[0.98] opacity-0'
              }`}
              style={{
                left: shouldShowPersistentAvatar ? persistentAvatarLeft : 0,
              }}
            >
              {isCubismCoreLoaded ? (
                <Live2DComponent
                  layoutStageKey={layoutStage}
                  shouldShowPersistentAvatar={shouldShowPersistentAvatar}
                />
              ) : null}
            </div>
          </button>
          {!isMaterialWorkspace && (
            <QuizAchievementBadges vertical className="pointer-events-auto" />
          )}
        </div>
        {shouldShowPersistentAvatar && !isMaterialWorkspace && (
          <div
            className="pointer-events-none absolute right-2 top-3 z-20 xl:right-3 xl:top-4"
            style={{ width: `${rightRailWidth}px` }}
            data-right-panel
          >
            <QuizPerformanceSummary
              modern={modern}
              compact={layoutStage !== 'desktop' || rightRailWidth < 480}
              showAchievements={false}
              className="pointer-events-auto bg-white/92"
            />
          </div>
        )}
      </div>

      {!shouldShowPersistentAvatar && !isMaterialWorkspace ? (
        <>
          <div className="chat-mobile-summary pointer-events-none absolute right-3 top-3 z-20">
            <button
              type="button"
              onClick={() => setIsMobileSummaryOpen((prev) => !prev)}
              aria-expanded={isMobileSummaryOpen}
              className="pointer-events-auto rounded-full border border-[#BFD0E4] bg-white/96 px-4 py-2 text-sm font-bold text-[#416DBB] shadow-md backdrop-blur-md"
            >
              学習状況
            </button>
          </div>
          {isMobileSummaryOpen ? (
            <div className="chat-mobile-summary-panel pointer-events-auto absolute inset-0 z-30 bg-[#24324A]/10 px-4 pt-16 backdrop-blur-[2px]">
              <div className="ml-auto w-[min(20rem,calc(100vw-2rem))]">
                <div className="mb-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setIsMobileSummaryOpen(false)}
                    className="rounded-full bg-white/96 px-3 py-1 text-xs font-bold text-[#5C6E8E] shadow-sm"
                  >
                    閉じる
                  </button>
                </div>
                <QuizPerformanceSummary
                  modern={modern}
                  compact
                  className="bg-white/98 shadow-xl"
                />
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
