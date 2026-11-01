import {
  Application,
  Ticker,
  DisplayObject,
  Graphics,
  Container,
} from 'pixi.js'
import '@pixi/ticker'
import { useEffect, useRef, useState, useCallback } from 'react'
import { Live2DModel } from 'pixi-live2d-display-lipsyncpatch/cubism4'
import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import { Live2DHandler } from '@/features/messages/live2dHandler'
import { debounce } from 'lodash'
import { buildUrl } from '@/utils/buildUrl'
import { getChatPaneWidth, getLayoutStage } from '@/utils/responsiveLayout'
import { WankoQuizHat } from '@/features/live2d/wankoQuizHat'
import { fitHappyAuraToStage } from '@/features/live2d/happyAuraLayout'
import { isQuizAvatarMode } from '@/features/live2d/quizAvatarMode'

console.log('Live2DComponent module loaded')

const resolvePublicAssetPath = (path: string) => {
  if (!path.startsWith('/')) return path
  return buildUrl(path)
}

const safeDestroyLive2DModel = (
  m: InstanceType<typeof Live2DModel> | null | undefined
) => {
  if (!m) return

  // Remove any custom ticker callbacks we attached
  try {
    const anyM = m as any

    // Legacy: older builds attached to Ticker.shared
    if (anyM.__rageTicker) {
      try {
        Ticker.shared.remove(anyM.__rageTicker)
      } catch {}
      anyM.__rageTicker = null
    }

    // Current: emotion override ticker attached to the app-scoped ticker
    if (anyM.__emotionTicker && anyM.__emotionTickerHost?.remove) {
      try {
        anyM.__emotionTickerHost.remove(anyM.__emotionTicker)
      } catch {}
    }
    anyM.__emotionTicker = null
    anyM.__emotionTickerHost = null
  } catch {}

  // pixi display objects commonly expose a `destroyed` flag
  if ((m as any).destroyed) return
  try {
    // Remove PIXI/EventEmitter listeners to avoid callbacks after destroy
    ;(m as any).removeAllListeners?.()
  } catch {}
  try {
    m.destroy()
  } catch (e) {
    console.warn('Live2D model destroy failed (ignored):', e)
  }
}

const safeDestroyPixiApp = (a: Application | null | undefined) => {
  if (!a) return
  if ((a as any).destroyed) return
  try {
    // Stop ticking first to avoid Live2D update callbacks firing after model destroy
    a.ticker?.stop()
  } catch {}
  try {
    a.destroy(true)
  } catch (e) {
    console.warn('PIXI app destroy failed (ignored):', e)
  }
}

const getLive2DRendererResolution = () => {
  if (typeof window === 'undefined') return 1
  const dpr = window.devicePixelRatio || 1
  return Math.min(Math.max(dpr * 1.25, 1.5), 2.5)
}

const getCurrentViewportSize = (app: Application) => {
  // PIXI's screen is resized from the actual canvas client size immediately
  // before positioning. Safari can briefly retain an old visualViewport value
  // while a window is being resized, which would otherwise move the model
  // outside the canvas.
  const rendererWidth = Math.round(app.renderer.screen.width || 0)
  const rendererHeight = Math.round(app.renderer.screen.height || 0)
  if (rendererWidth > 0 && rendererHeight > 0) {
    return { width: rendererWidth, height: rendererHeight }
  }

  if (typeof window === 'undefined') {
    return { width: app.screen.width, height: app.screen.height }
  }

  const visualViewportWidth = window.visualViewport?.width || 0
  const visualViewportHeight = window.visualViewport?.height || 0

  return {
    width: Math.round(
      Math.max(
        window.innerWidth,
        document.documentElement.clientWidth || 0,
        visualViewportWidth
      )
    ),
    height: Math.round(
      Math.max(
        window.innerHeight,
        document.documentElement.clientHeight || 0,
        visualViewportHeight
      )
    ),
  }
}

const syncRendererToViewport = (
  app: Application,
  canvas: HTMLCanvasElement | null
) => {
  const viewportSize = getCurrentViewportSize(app)
  const container = canvas?.parentElement
  const width =
    container?.clientWidth ||
    canvas?.clientWidth ||
    viewportSize.width ||
    app.renderer.screen.width
  const height =
    container?.clientHeight ||
    canvas?.clientHeight ||
    viewportSize.height ||
    app.renderer.screen.height

  if (!width || !height) return

  const resolution = getLive2DRendererResolution()
  const screenWidth = Math.round(app.renderer.screen.width)
  const screenHeight = Math.round(app.renderer.screen.height)
  const shouldResize =
    screenWidth !== Math.round(width) ||
    screenHeight !== Math.round(height) ||
    app.renderer.resolution !== resolution

  if (!shouldResize) return

  app.renderer.resolution = resolution
  app.renderer.resize(width, height)
}

const setModelPosition = (
  app: Application,
  model: InstanceType<typeof Live2DModel>,
  chatLogWidth: number,
  shouldShowPersistentAvatar: boolean,
  options: { ignoreFixedPosition?: boolean } = {}
) => {
  const settings = settingsStore.getState()
  const { width: viewportWidth, height: viewportHeight } =
    getCurrentViewportSize(app)
  const layoutStage = getLayoutStage(viewportWidth)
  const safeChatLogWidth = getChatPaneWidth(viewportWidth, chatLogWidth)

  // This canvas has its own bounded space in the rail, including effects.
  const boundedStage = (app.view as HTMLCanvasElement).closest?.(
    '[data-bounded-avatar="true"]'
  )
  if (boundedStage) {
    // Keep the bundled character's visual scale stable: animated effects can
    // enlarge getLocalBounds(), so they must not shrink the character itself.
    const scale = 1.2 * Math.min(1, viewportWidth / 720, viewportHeight / 900)
    model.scale.set(scale)
    model.x = viewportWidth / 2
    model.y = viewportHeight * 0.36
    return
  }

  // If position is fixed and saved, restore it
  if (
    !options.ignoreFixedPosition &&
    settings.fixedCharacterPosition &&
    (settings.characterPosition.x !== 0 ||
      settings.characterPosition.y !== 0 ||
      settings.characterPosition.scale !== 1)
  ) {
    model.scale.set(settings.characterPosition.scale)
    model.x = settings.characterPosition.x
    model.y = settings.characterPosition.y
  } else {
    // Default positioning
    const bottomUiHeight =
      typeof window !== 'undefined'
        ? ((
            document.querySelector('[data-bottom-ui]') as HTMLElement | null
          )?.getBoundingClientRect().height ?? 0)
        : 0
    const bottomUiMargin = 32
    const rightPanelHeight =
      typeof window !== 'undefined' && layoutStage !== 'mobile'
        ? ((
            document.querySelector('[data-right-panel]') as HTMLElement | null
          )?.getBoundingClientRect().height ?? 0)
        : 0
    const usePersistentLayout = shouldShowPersistentAvatar

    if (!usePersistentLayout) {
      const overlayScale =
        layoutStage === 'mobile'
          ? 0.72 * Math.max(0.72, Math.min(1, viewportWidth / 860))
          : 0.82 *
            Math.max(
              0.64,
              Math.min(0.92, viewportWidth / 1320, viewportHeight / 980)
            )
      const overlayX =
        layoutStage === 'mobile'
          ? viewportWidth / 2
          : Math.min(viewportWidth / 2, safeChatLogWidth / 2 + 36)
      const overlayY = Math.max(260, viewportHeight - bottomUiHeight - 156)

      model.scale.set(overlayScale)
      model.x = overlayX
      model.y = overlayY
      return
    }

    if (layoutStage === 'mobile') {
      const mobileScale =
        0.72 * Math.max(0.72, Math.min(1, viewportWidth / 860))
      model.scale.set(mobileScale)
      model.x = viewportWidth / 2
      model.y = Math.max(260, viewportHeight - bottomUiHeight - 168)
      return
    }

    // In persistent mode the canvas itself occupies only the right-side rail,
    // so its own center is always the correct horizontal anchor.
    const availableWidth = viewportWidth
    const rightSpaceCenterX = availableWidth / 2
    // The bundled Wanko textures top out at 1024px, so keep scaling tighter
    // and fit the model into the actual right-side space as it appears.
    const baseScale = 0.82
    const heightScale = Math.min(1, viewportHeight / 900)
    const widthScale = Math.max(0.46, Math.min(1, availableWidth / 560))
    const scale = baseScale * Math.min(heightScale, widthScale)
    const topReservedHeight = rightPanelHeight > 0 ? rightPanelHeight + 180 : 0
    const topPadding = rightPanelHeight > 0 ? 120 : 0
    const availableHeight = Math.max(
      0,
      viewportHeight -
        bottomUiHeight -
        bottomUiMargin -
        topReservedHeight -
        topPadding
    )
    const defaultVerticalOffset = 128
    model.scale.set(scale)
    model.x = rightSpaceCenterX
    model.y = topPadding + availableHeight / 2 + defaultVerticalOffset
  }
}

// Emotion control helper (rage / sweat)
export const setLive2DEmotion = ({
  rage = 0,
  sweat = 0,
}: {
  rage?: number
  sweat?: number
}) => {
  if (typeof window === 'undefined') return
  const m = (window as any).__live2d
  if (!m) return

  try {
    const core = m.internalModel?.coreModel
    core?.setParameterValueById?.('PARAM_RAGE', rage)
    core?.setParameterValueById?.('PARAM_SWEAT', sweat)
  } catch (e) {
    console.warn('Failed to set emotion params:', e)
  }
}

const Live2DComponent = ({
  layoutStageKey,
  shouldShowPersistentAvatar,
}: {
  layoutStageKey: 'mobile' | 'tablet' | 'desktop'
  shouldShowPersistentAvatar: boolean
}): JSX.Element => {
  console.log('Live2DComponent rendering')

  const canvasContainerRef = useRef<HTMLCanvasElement | null>(null)
  const [app, setApp] = useState<Application | null>(null)
  const [model, setModel] = useState<InstanceType<typeof Live2DModel> | null>(
    null
  )
  const modelRef = useRef<InstanceType<typeof Live2DModel> | null>(null)
  const layoutModeRunIdRef = useRef(0)
  const quizHatRef = useRef<WankoQuizHat | null>(null)
  const showQuizHat = homeStore((state) => isQuizAvatarMode(state.chatLog))
  // Parameters we want to keep overriding every frame (to beat lipSync / motions)
  const lockedParamsRef = useRef<Record<string, number>>({})
  const idleParamsRef = useRef<Record<string, number> | null>(null)
  const paramIdsRef = useRef<string[]>([])
  // Remember mouth open values so we can restore after temporarily forcing the mouth closed
  const defaultMouthOpenYRef = useRef<number>(0)
  const lastMouthOpenYRef = useRef<number | null>(null)
  // Remember mouth open value before forcing it to 1.0 for Happy aura
  const lastHappyMouthOpenYRef = useRef<number | null>(null)

  // Happy aura effect (PIXI.Container)
  const auraRef = useRef<Container | null>(null)
  const auraTickRef = useRef<(() => void) | null>(null)
  // Sad aura effects (PIXI.Container)
  const sadRainRef = useRef<Container | null>(null)
  const sadRainTickRef = useRef<(() => void) | null>(null)
  const sadHazeRef = useRef<Container | null>(null)
  const sadHazeTickRef = useRef<(() => void) | null>(null)
  const sadWindRef = useRef<Container | null>(null)
  const sadWindTickRef = useRef<(() => void) | null>(null)
  const [happyAuraUI, setHappyAuraUI] = useState(0) // 0=OFF, 1=ON
  const [sadRainUI, setSadRainUI] = useState(0)
  const [sadHazeUI, setSadHazeUI] = useState(0)
  const [sadWindUI, setSadWindUI] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const selectedLive2DPath = settingsStore((state) => state.selectedLive2DPath)
  const chatLogWidth = settingsStore((state) => state.chatLogWidth)
  // ピンチジェスチャー用の状態
  const [pinchDistance, setPinchDistance] = useState<number | null>(null)
  const [initialScale, setInitialScale] = useState<number | null>(null)

  // Simple on-screen controls (debug / MVP)
  const [rageUI, setRageUI] = useState(0)
  const [sweatUI, setSweatUI] = useState(0)
  const emotionPresetsRef = useRef<Record<
    string,
    Record<string, number>
  > | null>(null)

  const isLive2DEmotionDisabled = useCallback(
    () =>
      typeof window !== 'undefined' &&
      (window as any).__disableLive2DEmotion === true,
    []
  )

  // --- Helpers: core model + mouth lock/restore (avoid duplicated logic) ---
  const getCoreModel = useCallback(() => {
    const m: any =
      modelRef.current ||
      (typeof window !== 'undefined' ? (window as any).__live2d : null)
    return m?.internalModel?.coreModel
  }, [])

  const computeRestoreMouthOpen = useCallback(() => {
    // Restore mouth-open to the last known value (or default).
    // IMPORTANT: Do NOT depend on happyAuraUI here.
    // Happy mouth-open (=1) is handled by the `happyOn` branch in applyMouthForEmotionState.
    return (
      lastHappyMouthOpenYRef.current ??
      lastMouthOpenYRef.current ??
      defaultMouthOpenYRef.current ??
      0.5
    )
  }, [])

  const getAllParameterIds = useCallback((core: any): string[] => {
    if (!core) return []
    if (typeof core.getParameterIds === 'function') {
      return core.getParameterIds() || []
    }
    if (
      typeof core.getParameterCount === 'function' &&
      typeof core.getParameterId === 'function'
    ) {
      const count = core.getParameterCount()
      const ids: string[] = []
      for (let i = 0; i < count; i++) {
        const id = core.getParameterId(i)
        if (typeof id === 'string') ids.push(id)
      }
      return ids
    }
    return []
  }, [])

  const loadParamIdsFromDisplayInfo = useCallback(async (modelPath: string) => {
    try {
      const modelRes = await fetch(modelPath, { cache: 'no-store' })
      if (!modelRes.ok) return
      const modelJson = await modelRes.json()
      const displayInfo = modelJson?.FileReferences?.DisplayInfo
      if (!displayInfo) return

      const baseUrl = new URL(modelPath, window.location.origin)
      const displayUrl = new URL(displayInfo, baseUrl).toString()
      const displayRes = await fetch(displayUrl, { cache: 'no-store' })
      if (!displayRes.ok) return
      const displayJson = await displayRes.json()
      const ids = (displayJson?.Parameters || [])
        .map((p: any) => p?.Id)
        .filter((id: any) => typeof id === 'string') as string[]
      if (ids.length > 0) paramIdsRef.current = ids
    } catch (e) {
      console.warn('Failed to load Live2D parameter IDs:', e)
    }
  }, [])

  const lockMouthOpen = useCallback((core: any, value: number) => {
    if (!core?.setParameterValueById) return
    core.setParameterValueById('PARAM_MOUTH_OPEN_Y', value)
    lockedParamsRef.current = {
      ...lockedParamsRef.current,
      PARAM_MOUTH_OPEN_Y: value,
    }
  }, [])

  const unlockMouthOpen = useCallback(() => {
    const { PARAM_MOUTH_OPEN_Y, ...rest } = lockedParamsRef.current
    lockedParamsRef.current = rest
  }, [])

  const captureMouthOpenOnce = useCallback(
    (core: any, ref: { current: number | null }) => {
      if (lockedParamsRef.current.PARAM_MOUTH_OPEN_Y !== undefined) return
      const current = core?.getParameterValueById?.('PARAM_MOUTH_OPEN_Y')
      if (typeof current === 'number') ref.current = current
    },
    []
  )

  const loadIdleMotionParams = useCallback(async (modelPath: string) => {
    try {
      const idleGroup = settingsStore.getState().idleMotionGroup || 'idle'
      const modelRes = await fetch(modelPath, { cache: 'no-store' })
      if (!modelRes.ok) return
      const modelJson = await modelRes.json()
      const motions = modelJson?.FileReferences?.Motions || {}
      const groupKey =
        motions[idleGroup] ||
        Object.keys(motions).find(
          (k) => k.toLowerCase() === String(idleGroup).toLowerCase()
        )
      const motionEntry = motions[groupKey as any]?.[0]
      const motionFile = motionEntry?.File
      if (!motionFile) return

      const baseUrl = new URL(modelPath, window.location.origin)
      const motionUrl = new URL(motionFile, baseUrl).toString()
      const motionRes = await fetch(motionUrl, { cache: 'no-store' })
      if (!motionRes.ok) return
      const motionJson = await motionRes.json()
      const params: Record<string, number> = {}
      for (const curve of motionJson?.Curves || []) {
        if (curve?.Target !== 'Parameter') continue
        const seg = curve?.Segments || []
        if (seg.length >= 2) params[curve.Id] = seg[1]
      }
      if (Object.keys(params).length > 0) {
        idleParamsRef.current = params
      }
    } catch (e) {
      console.warn('Failed to load idle motion params:', e)
    }
  }, [])

  const applyMouthForEmotionState = useCallback(
    (core: any, rage: number, sweat: number, happyOn: boolean) => {
      if (!core?.setParameterValueById) return
      const shouldClose = rage > 0 || sweat > 0

      if (shouldClose) {
        // Capture current mouth-open once for later restore
        captureMouthOpenOnce(core, lastMouthOpenYRef)
        lockMouthOpen(core, 0)
        return
      }

      // Rage/Sweat are OFF
      if (happyOn) {
        // Capture once so we can restore when Happy turns off
        captureMouthOpenOnce(core, lastHappyMouthOpenYRef)
        lockMouthOpen(core, 1)
        return
      }

      // Normal restore
      const restore = computeRestoreMouthOpen()
      core.setParameterValueById('PARAM_MOUTH_OPEN_Y', restore)
      lastMouthOpenYRef.current = null
      lastHappyMouthOpenYRef.current = null
      unlockMouthOpen()
    },
    [
      captureMouthOpenOnce,
      computeRestoreMouthOpen,
      lockMouthOpen,
      unlockMouthOpen,
    ]
  )

  const ensureHappyAura = useCallback(
    (
      currentApp: Application,
      targetModel: InstanceType<typeof Live2DModel>
    ) => {
      if (!auraRef.current) {
        const container = new Container()

        // --- Flowers-only Happy Aura (flowers in yellow/orange/green) ---
        const flowersContainer = new Container()
        container.addChild(flowersContainer as unknown as DisplayObject)

        const flowerCount = 30
        const flowers: Array<{
          g: Graphics
          baseAngle: number
          baseRadius: number
          size: number
          speed: number
          phase: number
        }> = []

        const drawFlower = (
          g: Graphics,
          size: number,
          petalColor: number,
          centerColor: number,
          outlineColor: number
        ) => {
          // Simple 5-petal flower using circles + center (restore center circle)
          const petalR = size * 0.55
          const petalDist = size * 0.78
          const centerR = size * 0.34

          g.clear()

          // petals (add thicker outline around each petal)
          for (let i = 0; i < 5; i++) {
            const a = (Math.PI * 2 * i) / 5 - Math.PI / 2
            const x = Math.cos(a) * petalDist
            const y = Math.sin(a) * petalDist

            g.lineStyle(3, outlineColor, 0.95)
            g.beginFill(petalColor, 1.0)
            g.drawCircle(x, y, petalR)
            g.endFill()
          }

          // center (bring back the inner circle)
          g.lineStyle(3, outlineColor, 0.95)
          g.beginFill(centerColor, 1.0)
          g.drawCircle(0, 0, centerR)
          g.endFill()
        }

        const palette = [
          // yellow
          { petal: 0xfff2a8, center: 0xffd24a, outline: 0xffc400 },
          // orange
          { petal: 0xffc48a, center: 0xff8a2b, outline: 0xff7a00 },
          // green
          { petal: 0xb9ffbf, center: 0x37d26a, outline: 0x1bbf52 },
        ]

        for (let i = 0; i < flowerCount; i++) {
          const g = new Graphics()
          const baseAngle = (Math.PI * 2 * i) / flowerCount + 0.12
          // Slightly wider horizontal spread (we'll render flowers on an ellipse in the ticker)
          const baseRadius = 45 + (i % 4) * 12
          const size = 10 + (i % 5) * 4
          const speed = 0.4 + (i % 5) * 0.16
          const phase = i * 0.95

          const c = palette[i % palette.length]
          drawFlower(g, size, c.petal, c.center, c.outline)
          g.alpha = 0.0
          g.rotation = baseAngle

          flowersContainer.addChild(g as unknown as DisplayObject)
          flowers.push({ g, baseAngle, baseRadius, size, speed, phase })
        }

        container.visible = false
        container.alpha = 1
        container.scale.set(1)
        auraRef.current = container

        // Add BEHIND the model
        try {
          const modelIndex = currentApp.stage.getChildIndex(
            targetModel as unknown as DisplayObject
          )
          const backIndex = Math.max(0, modelIndex)
          currentApp.stage.addChildAt(
            container as unknown as DisplayObject,
            backIndex
          )
        } catch {
          currentApp.stage.addChildAt(container as unknown as DisplayObject, 0)
        }

        // Store flowers array on the container for the ticker to use
        ;(container as any).__flowers = flowers
      }

      // Attach ticker to follow + pulse + twinkle
      try {
        if (auraTickRef.current) {
          currentApp.ticker.remove(auraTickRef.current)
          auraTickRef.current = null
        }

        const tick = () => {
          const container = auraRef.current
          if (!container) return

          container.x = targetModel.x
          const s = targetModel.scale?.x ?? 1
          // Follow model position (aim around the face area)
          // Smaller negative offset => aura moves DOWN (closer to the face)
          container.y = targetModel.y - 50 * s

          if (container.visible) {
            const t = currentApp.ticker.lastTime / 1000

            // Gentle pulse for the whole aura
            const pulse = 1 + 0.03 * Math.sin(t * 2.8)
            if (
              (currentApp.view as HTMLCanvasElement).closest(
                '[data-bounded-avatar="true"]'
              )
            ) {
              const fitted = fitHappyAuraToStage(
                currentApp.screen.width,
                currentApp.screen.height,
                container.x,
                container.y,
                pulse
              )
              container.position.set(fitted.x, fitted.y)
              container.scale.set(fitted.scale)
            } else {
              container.scale.set(pulse * 1.4)
            }
            container.alpha = 0.9 + 0.1 * Math.sin(t * 2.1)

            // Float flowers (gentle movement + fade in)
            const flowers = ((container as any).__flowers || []) as Array<{
              g: Graphics
              baseAngle: number
              baseRadius: number
              size: number
              speed: number
              phase: number
            }>

            for (const f of flowers) {
              const a = f.baseAngle + 0.18 * Math.sin(t * 0.55 + f.phase)
              const r = f.baseRadius + 7 * Math.sin(t * 0.9 + f.phase)
              // Ellipse spread: wider on X than Y
              f.g.x = Math.cos(a) * r * 1.45
              f.g.y = Math.sin(a) * r * 0.95

              // gentle rotation
              f.g.rotation += 0.006 * f.speed

              // more subtle, lively
              f.g.alpha =
                0.35 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2.4 * f.speed + f.phase))
            }
          }
        }

        auraTickRef.current = tick
        currentApp.ticker.add(tick)
      } catch (e) {
        console.warn('Failed to attach aura ticker:', e)
      }
    },
    []
  )

  const ensureSadRain = useCallback(
    (
      currentApp: Application,
      targetModel: InstanceType<typeof Live2DModel>
    ) => {
      if (!sadRainRef.current) {
        const container = new Container()
        const gloom = new Graphics()
        const drops: Array<{
          g: Graphics
          x: number
          y: number
          speed: number
          alpha: number
        }> = []

        container.visible = false
        sadRainRef.current = container

        container.addChild(gloom as unknown as DisplayObject)

        try {
          const modelIndex = currentApp.stage.getChildIndex(
            targetModel as unknown as DisplayObject
          )
          const frontIndex = Math.min(
            currentApp.stage.children.length,
            modelIndex + 1
          )
          currentApp.stage.addChildAt(
            container as unknown as DisplayObject,
            frontIndex
          )
        } catch {
          currentApp.stage.addChild(container as unknown as DisplayObject)
        }

        ;(container as any).__drops = drops
        ;(container as any).__gloom = gloom
      }

      try {
        if (sadRainTickRef.current) {
          currentApp.ticker.remove(sadRainTickRef.current)
          sadRainTickRef.current = null
        }

        const tick = () => {
          const container = sadRainRef.current
          if (!container) return

          container.x = targetModel.x
          const s = targetModel.scale?.x ?? 1
          container.y = targetModel.y - 50 * s

          if (container.visible) {
            const gloom = (container as any).__gloom as Graphics | undefined
            if (gloom) {
              gloom.clear()
              const lineCount = 28
              const width = 140 * s
              const startY = -20 * s
              const maxLen = 52 * s
              gloom.lineStyle(2 * s, 0x0b0b0f, 0.85)
              for (let i = 0; i < lineCount; i++) {
                const x = -width / 2 + (i / (lineCount - 1)) * width
                const jitter = Math.sin(i * 1.7) * 3 * s
                const len = maxLen * (0.35 + (i % 5) * 0.12)
                gloom.moveTo(x + jitter, startY)
                gloom.lineTo(x + jitter, startY + len)
              }
            }
            container.alpha = 0.85
          }
        }

        sadRainTickRef.current = tick
        currentApp.ticker.add(tick)
      } catch (e) {
        console.warn('Failed to attach sad rain ticker:', e)
      }
    },
    []
  )

  const ensureSadHaze = useCallback(
    (
      currentApp: Application,
      targetModel: InstanceType<typeof Live2DModel>
    ) => {
      if (!sadHazeRef.current) {
        const container = new Container()
        const haze: Array<{
          g: Graphics
          x: number
          y: number
          scale: number
          phase: number
        }> = []

        for (let i = 0; i < 4; i++) {
          const g = new Graphics()
          g.beginFill(0x8fb0ff, 0.18)
          g.drawCircle(0, 0, 60 + i * 10)
          g.endFill()
          g.alpha = 0
          container.addChild(g as unknown as DisplayObject)
          haze.push({
            g,
            x: (i - 1.5) * 40,
            y: -10 + i * 18,
            scale: 0.9 + i * 0.1,
            phase: i * 0.8,
          })
        }

        container.visible = false
        sadHazeRef.current = container

        try {
          const modelIndex = currentApp.stage.getChildIndex(
            targetModel as unknown as DisplayObject
          )
          const backIndex = Math.max(0, modelIndex)
          currentApp.stage.addChildAt(
            container as unknown as DisplayObject,
            backIndex
          )
        } catch {
          currentApp.stage.addChildAt(container as unknown as DisplayObject, 0)
        }

        ;(container as any).__haze = haze
      }

      try {
        if (sadHazeTickRef.current) {
          currentApp.ticker.remove(sadHazeTickRef.current)
          sadHazeTickRef.current = null
        }

        const tick = () => {
          const container = sadHazeRef.current
          if (!container) return

          container.x = targetModel.x
          const s = targetModel.scale?.x ?? 1
          container.y = targetModel.y - 40 * s

          if (container.visible) {
            const t = currentApp.ticker.lastTime / 1000
            const haze = ((container as any).__haze || []) as Array<{
              g: Graphics
              x: number
              y: number
              scale: number
              phase: number
            }>

            for (const h of haze) {
              const wobble = 6 * Math.sin(t * 0.6 + h.phase)
              h.g.x = (h.x + wobble) * s
              h.g.y = h.y * s
              h.g.scale.set(h.scale * (1 + 0.03 * Math.sin(t + h.phase)))
              h.g.alpha = 0.18 + 0.06 * Math.sin(t * 0.8 + h.phase)
            }
            container.alpha = 0.9
          }
        }

        sadHazeTickRef.current = tick
        currentApp.ticker.add(tick)
      } catch (e) {
        console.warn('Failed to attach sad haze ticker:', e)
      }
    },
    []
  )

  const ensureSadWind = useCallback(
    (
      currentApp: Application,
      targetModel: InstanceType<typeof Live2DModel>
    ) => {
      if (!sadWindRef.current) {
        const container = new Container()
        const lines: Array<{
          g: Graphics
          x: number
          y: number
          speed: number
        }> = []

        for (let i = 0; i < 6; i++) {
          const g = new Graphics()
          g.lineStyle(2, 0x7fb6ff, 0.35)
          g.moveTo(0, 0)
          g.bezierCurveTo(20, -6, 40, 6, 70, 0)
          g.alpha = 0
          container.addChild(g as unknown as DisplayObject)
          lines.push({
            g,
            x: -120 - i * 30,
            y: -20 + i * 12,
            speed: 24 + i * 6,
          })
        }

        container.visible = false
        sadWindRef.current = container

        try {
          const modelIndex = currentApp.stage.getChildIndex(
            targetModel as unknown as DisplayObject
          )
          const backIndex = Math.max(0, modelIndex)
          currentApp.stage.addChildAt(
            container as unknown as DisplayObject,
            backIndex
          )
        } catch {
          currentApp.stage.addChildAt(container as unknown as DisplayObject, 0)
        }

        ;(container as any).__lines = lines
      }

      try {
        if (sadWindTickRef.current) {
          currentApp.ticker.remove(sadWindTickRef.current)
          sadWindTickRef.current = null
        }

        const tick = () => {
          const container = sadWindRef.current
          if (!container) return

          container.x = targetModel.x
          const s = targetModel.scale?.x ?? 1
          container.y = targetModel.y - 70 * s

          if (container.visible) {
            const lines = ((container as any).__lines || []) as Array<{
              g: Graphics
              x: number
              y: number
              speed: number
            }>
            const width = 260 * s

            for (const l of lines) {
              l.x += (l.speed * currentApp.ticker.deltaMS) / 1000
              if (l.x > width) l.x = -140 * s
              l.g.x = l.x
              l.g.y = l.y * s
              l.g.alpha = 0.2 + 0.15 * Math.sin(l.x * 0.02)
            }
            container.alpha = 0.8
          }
        }

        sadWindTickRef.current = tick
        currentApp.ticker.add(tick)
      } catch (e) {
        console.warn('Failed to attach sad wind ticker:', e)
      }
    },
    []
  )

  const setHappyAura = useCallback(
    (on: boolean) => {
      if (isLive2DEmotionDisabled()) return
      setHappyAuraUI(on ? 1 : 0)
      if (auraRef.current) {
        auraRef.current.visible = on
        auraRef.current.alpha = 1
        auraRef.current.scale.set(1.4)
      }

      // Mouth control for Happy is preset-driven via emotion-presets.json.
      try {
        const core = getCoreModel()
        if (!core?.setParameterValueById) return

        const rageOrSweatOn = rageUI > 0 || sweatUI > 0
        if (on) {
          if (!rageOrSweatOn) {
            const happyMouth =
              emotionPresetsRef.current?.happy?.PARAM_MOUTH_OPEN_Y
            if (typeof happyMouth === 'number') {
              captureMouthOpenOnce(core, lastHappyMouthOpenYRef)
              lockMouthOpen(core, happyMouth)
            } else {
              applyMouthForEmotionState(core, 0, 0, true)
            }
          }
        } else {
          if (!rageOrSweatOn) {
            // Happy OFF: restore and unlock
            applyMouthForEmotionState(core, 0, 0, false)
          }
        }
      } catch (e) {
        console.warn('Failed to apply happy mouth control:', e)
      }
    },
    [
      rageUI,
      sweatUI,
      getCoreModel,
      captureMouthOpenOnce,
      applyMouthForEmotionState,
      lockMouthOpen,
      isLive2DEmotionDisabled,
    ]
  )

  const setSadRain = useCallback((on: boolean) => {
    setSadRainUI(on ? 1 : 0)
    if (sadRainRef.current) {
      sadRainRef.current.visible = on
      sadRainRef.current.alpha = 1
    }
  }, [])

  const setSadHaze = useCallback((on: boolean) => {
    setSadHazeUI(on ? 1 : 0)
    if (sadHazeRef.current) {
      sadHazeRef.current.visible = on
      sadHazeRef.current.alpha = 1
    }
  }, [])

  const setSadWind = useCallback((on: boolean) => {
    setSadWindUI(on ? 1 : 0)
    if (sadWindRef.current) {
      sadWindRef.current.visible = on
      sadWindRef.current.alpha = 1
    }
  }, [])

  const applyEmotionUI = useCallback(
    (next: { rage?: number; sweat?: number }) => {
      if (isLive2DEmotionDisabled()) return
      const r = next.rage ?? rageUI
      const s = next.sweat ?? sweatUI

      // Keep local UI state in sync
      setRageUI(r)
      setSweatUI(s)

      // Apply to current model immediately
      try {
        const m: any = modelRef.current || (window as any).__live2d
        const core = m?.internalModel?.coreModel
        if (core?.setParameterValueById) {
          const presetName = r > 0 ? 'rage' : s > 0 ? 'sweat' : 'neutral'
          const presetParams = emotionPresetsRef.current?.[presetName]
          const presetMouth =
            typeof presetParams?.PARAM_MOUTH_OPEN_Y === 'number'
              ? presetParams.PARAM_MOUTH_OPEN_Y
              : null

          if (presetParams) {
            for (const [paramId, value] of Object.entries(presetParams)) {
              core.setParameterValueById(paramId, value)
            }
          } else {
            // Fallback if preset JSON is unavailable
            core.setParameterValueById('PARAM_RAGE', r)
            core.setParameterValueById('PARAM_SWEAT', s)
            core.setParameterValueById('PARAM_EYE_L_OPEN', s > 0 ? 0 : 1)
            core.setParameterValueById('PARAM_EYE_R_OPEN', s > 0 ? 0 : 1)
          }

          // Mouth shape is also preset-driven (rage/sweat/neutral).
          if (presetMouth !== null) {
            if (presetName === 'neutral') {
              core.setParameterValueById('PARAM_MOUTH_OPEN_Y', presetMouth)
              unlockMouthOpen()
            } else {
              lockMouthOpen(core, presetMouth)
            }
          } else {
            applyMouthForEmotionState(core, r, s, happyAuraUI > 0)
          }

          if (s > 0) {
            lockedParamsRef.current = {
              ...lockedParamsRef.current,
              PARAM_EYE_L_OPEN: 0,
              PARAM_EYE_R_OPEN: 0,
            }
          } else {
            const { PARAM_EYE_L_OPEN, PARAM_EYE_R_OPEN, ...rest } =
              lockedParamsRef.current
            lockedParamsRef.current = rest
          }
          // Clear captured restore values when switching to a locked state
          if (r > 0 || s > 0) {
            lastHappyMouthOpenYRef.current = null
          }
        }
      } catch (e) {
        console.warn('Failed to apply emotion UI params:', e)
      }

      // Also broadcast so other parts can listen if needed
      try {
        window.dispatchEvent(
          new CustomEvent('live2d:emotion', {
            detail: {
              emotion: 'ui',
              params: { PARAM_RAGE: r, PARAM_SWEAT: s },
            },
          })
        )
      } catch {}
    },
    [
      rageUI,
      sweatUI,
      happyAuraUI,
      applyMouthForEmotionState,
      lockMouthOpen,
      unlockMouthOpen,
      isLive2DEmotionDisabled,
    ]
  )

  useEffect(() => {
    let cancelled = false

    const loadEmotionPresets = async () => {
      try {
        const res = await fetch(
          resolvePublicAssetPath('/live2d/wanko/emotion-presets.json'),
          {
            cache: 'no-store',
          }
        )
        if (!res.ok) return
        const json = await res.json()
        const presets = json?.presets
        if (cancelled || !presets || typeof presets !== 'object') return
        emotionPresetsRef.current = presets as Record<
          string,
          Record<string, number>
        >
        console.log('[Live2DComponent] emotion presets loaded')
      } catch (e) {
        console.warn('[Live2DComponent] failed to load emotion presets:', e)
      }
    }

    loadEmotionPresets()
    return () => {
      cancelled = true
    }
  }, [])

  const resetPose = useCallback(() => {
    const m: any = modelRef.current || (window as any).__live2d
    const core = m?.internalModel?.coreModel
    if (!core?.setParameterValueById) return

    try {
      m?.stopMotions?.()
      m?.stopMotions?.()
      m?.internalModel?.motionManager?.stopAllMotions?.()
      m?.internalModel?.motionManager?.state?.reset?.()
    } catch {}

    const idleParams = idleParamsRef.current
    const paramIds =
      paramIdsRef.current.length > 0
        ? paramIdsRef.current
        : getAllParameterIds(core)

    const applyZeroParams = () => {
      const keepParams: Record<string, number> = {
        PARAM_BOWL_LID: 50,
      }
      const locked: Record<string, number> = {}
      for (const id of paramIds) {
        const value = Object.prototype.hasOwnProperty.call(keepParams, id)
          ? keepParams[id]
          : 0
        core.setParameterValueById(id, value)
        locked[id] = value
      }
      lockedParamsRef.current = locked
    }

    setRageUI(0)
    setSweatUI(0)
    setHappyAuraUI(0)
    setSadRainUI(0)
    setSadHazeUI(0)
    setSadWindUI(0)
    if (auraRef.current) auraRef.current.visible = false
    if (sadRainRef.current) sadRainRef.current.visible = false
    if (sadHazeRef.current) sadHazeRef.current.visible = false
    if (sadWindRef.current) sadWindRef.current.visible = false
    applyMouthForEmotionState(core, 0, 0, false)

    applyZeroParams()
    setTimeout(() => {
      try {
        applyZeroParams()
      } catch {}
    }, 120)
  }, [applyMouthForEmotionState])

  const clearParamLocks = useCallback(() => {
    lockedParamsRef.current = {}
  }, [])

  const setParamLocks = useCallback(
    (params: Record<string, number>, replace: boolean = false) => {
      const next = Object.fromEntries(
        Object.entries(params || {}).filter(
          ([paramId, value]) =>
            typeof paramId === 'string' && typeof value === 'number'
        )
      ) as Record<string, number>
      if (replace) {
        lockedParamsRef.current = next
        return
      }
      lockedParamsRef.current = {
        ...lockedParamsRef.current,
        ...next,
      }
    },
    []
  )

  // Allow other UI (e.g., chat) to control Live2D emotions without direct imports.
  // Usage from anywhere: (window as any).__live2dSetHappy(true/false)
  //                   : (window as any).__live2dApplyEmotion({ rage?: number; sweat?: number })
  useEffect(() => {
    if (typeof window === 'undefined') return
    ;(window as any).__live2dSetHappy = (on: boolean) => {
      try {
        setHappyAura(!!on)
      } catch (e) {
        console.warn('Failed to call __live2dSetHappy:', e)
      }
    }
    ;(window as any).__live2dApplyEmotion = (next: {
      rage?: number
      sweat?: number
    }) => {
      try {
        applyEmotionUI(next)
      } catch (e) {
        console.warn('Failed to call __live2dApplyEmotion:', e)
      }
    }
    ;(window as any).__live2dSetSadRain = (on: boolean) => {
      try {
        setSadRain(!!on)
      } catch (e) {
        console.warn('Failed to call __live2dSetSadRain:', e)
      }
    }
    ;(window as any).__live2dSetSadHaze = (on: boolean) => {
      try {
        setSadHaze(!!on)
      } catch (e) {
        console.warn('Failed to call __live2dSetSadHaze:', e)
      }
    }
    ;(window as any).__live2dSetSadWind = (on: boolean) => {
      try {
        setSadWind(!!on)
      } catch (e) {
        console.warn('Failed to call __live2dSetSadWind:', e)
      }
    }
    ;(window as any).__live2dResetPose = () => {
      try {
        resetPose()
      } catch (e) {
        console.warn('Failed to call __live2dResetPose:', e)
      }
    }
    ;(window as any).__live2dClearParamLocks = () => {
      try {
        clearParamLocks()
      } catch (e) {
        console.warn('Failed to call __live2dClearParamLocks:', e)
      }
    }
    ;(window as any).__live2dSetParamLocks = (
      params: Record<string, number>,
      replace?: boolean
    ) => {
      try {
        setParamLocks(params, !!replace)
      } catch (e) {
        console.warn('Failed to call __live2dSetParamLocks:', e)
      }
    }

    return () => {
      try {
        delete (window as any).__live2dSetHappy
        delete (window as any).__live2dApplyEmotion
        delete (window as any).__live2dSetSadRain
        delete (window as any).__live2dSetSadHaze
        delete (window as any).__live2dSetSadWind
        delete (window as any).__live2dResetPose
        delete (window as any).__live2dClearParamLocks
        delete (window as any).__live2dSetParamLocks
      } catch {}
    }
  }, [
    setHappyAura,
    applyEmotionUI,
    setSadRain,
    setSadHaze,
    setSadWind,
    resetPose,
    clearParamLocks,
    setParamLocks,
  ])

  useEffect(() => {
    if (typeof window === 'undefined' || !model) return
    ;(window as any).__live2d = model

    return () => {
      if ((window as any).__live2d === model) {
        delete (window as any).__live2d
      }
    }
  }, [model])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onReset = () => {
      try {
        resetPose()
      } catch (e) {
        console.warn('Failed to handle live2d:reset:', e)
      }
    }
    window.addEventListener('live2d:reset', onReset)
    return () => {
      window.removeEventListener('live2d:reset', onReset)
    }
  }, [resetPose])

  // モデルの現在位置を設定に保存する関数
  const saveModelPosition = useCallback(() => {
    if (!model) return

    const settings = settingsStore.getState()
    settingsStore.setState({
      characterPosition: {
        x: model.x,
        y: model.y,
        z: settings.characterPosition.z, // 既存のzを保持（VRM viewerで使用 → viewer.ts:216–221）
        scale: model.scale.x,
      },
      characterRotation: settings.characterRotation, // 既存のrotationを保持（VRM viewerで使用 → viewer.ts:224–226）
    })
  }, [model])

  // Position management functions that can be called from settings
  const fixPosition = useCallback(() => {
    if (!model) return
    saveModelPosition()
    settingsStore.setState({ fixedCharacterPosition: true })
  }, [model, saveModelPosition])

  const unfixPosition = useCallback(() => {
    settingsStore.setState({ fixedCharacterPosition: false })
  }, [])

  const resetPosition = useCallback(() => {
    if (!model || !app) return
    settingsStore.setState({
      fixedCharacterPosition: false,
      characterPosition: { x: 0, y: 0, z: 0, scale: 1 },
      characterRotation: { x: 0, y: 0, z: 0 },
    })
    syncRendererToViewport(app, canvasContainerRef.current)
    setModelPosition(app, model, chatLogWidth, shouldShowPersistentAvatar, {
      ignoreFixedPosition: shouldShowPersistentAvatar,
    })
    app.render()
  }, [model, app, chatLogWidth, shouldShowPersistentAvatar])

  // Store position management functions in homeStore for access from settings
  useEffect(() => {
    if (model) {
      // Merge position management functions with the Live2D model instance
      const viewerWithPositionControls = Object.assign(model, {
        fixPosition,
        unfixPosition,
        resetPosition,
      })
      homeStore.setState({
        live2dViewer: viewerWithPositionControls,
      })
    }
  }, [model, app, fixPosition, unfixPosition, resetPosition])

  useEffect(() => {
    initApp()
    return () => {
      // Stop ticking first to avoid Live2D internal updates after destroy
      try {
        app?.ticker?.stop()
      } catch {}
      // Cleanup happy aura
      try {
        if (app && auraTickRef.current) {
          app.ticker.remove(auraTickRef.current)
        }
      } catch {}
      auraTickRef.current = null
      try {
        auraRef.current?.destroy?.()
      } catch {}
      auraRef.current = null
      // Cleanup sad auras
      try {
        if (app && sadRainTickRef.current) {
          app.ticker.remove(sadRainTickRef.current)
        }
      } catch {}
      sadRainTickRef.current = null
      try {
        sadRainRef.current?.destroy?.()
      } catch {}
      sadRainRef.current = null
      try {
        if (app && sadHazeTickRef.current) {
          app.ticker.remove(sadHazeTickRef.current)
        }
      } catch {}
      sadHazeTickRef.current = null
      try {
        sadHazeRef.current?.destroy?.()
      } catch {}
      sadHazeRef.current = null
      try {
        if (app && sadWindTickRef.current) {
          app.ticker.remove(sadWindTickRef.current)
        }
      } catch {}
      sadWindTickRef.current = null
      try {
        sadWindRef.current?.destroy?.()
      } catch {}
      sadWindRef.current = null
      safeDestroyLive2DModel(modelRef.current)
      modelRef.current = null
      homeStore.setState({
        live2dViewer: null,
        isLive2dLoaded: false,
      })
      safeDestroyPixiApp(app)
    }
  }, [])

  useEffect(() => {
    if (app && selectedLive2DPath) {
      // 既存のモデルがある場合は先に削除
      if (modelRef.current) {
        try {
          app.stage.removeChild(modelRef.current as unknown as DisplayObject)
        } catch {}
        safeDestroyLive2DModel(modelRef.current)
        modelRef.current = null
        setModel(null)
      }
      // ステージをクリア
      app.stage.removeChildren()
      // Remove aura from stage when switching models (it will be re-added after new model loads)
      try {
        if (auraRef.current) {
          app.stage.removeChild(auraRef.current as unknown as DisplayObject)
        }
      } catch {}
      try {
        if (sadRainRef.current) {
          app.stage.removeChild(sadRainRef.current as unknown as DisplayObject)
        }
      } catch {}
      try {
        if (sadHazeRef.current) {
          app.stage.removeChild(sadHazeRef.current as unknown as DisplayObject)
        }
      } catch {}
      try {
        if (sadWindRef.current) {
          app.stage.removeChild(sadWindRef.current as unknown as DisplayObject)
        }
      } catch {}
      // 新しいモデルを読み込む
      loadLive2DModel(app, selectedLive2DPath)
    }
  }, [app, selectedLive2DPath])

  // Receive cross-tab control via BroadcastChannel (from send-message.tsx)
  useEffect(() => {
    if (typeof window === 'undefined') return
    // If the browser doesn't support it, do nothing
    if (!(window as any).BroadcastChannel) return

    const CHANNEL = 'aituber:live2d'
    const bc = new BroadcastChannel(CHANNEL)

    const onMessage = (ev: MessageEvent) => {
      try {
        const data: any = ev.data
        if (!data || typeof data !== 'object') return

        // Expected shapes:
        //  - { type: 'emotion', params: { PARAM_RAGE: 1, PARAM_SWEAT: 0 } }
        //  - { type: 'happy', on: true }
        if (data.type === 'emotion') {
          const params = (data.params || {}) as Record<string, any>

          // Apply via existing UI helper so local state stays in sync
          const next: { rage?: number; sweat?: number } = {}
          if (typeof params.PARAM_RAGE === 'number')
            next.rage = params.PARAM_RAGE
          if (typeof params.PARAM_SWEAT === 'number')
            next.sweat = params.PARAM_SWEAT

          // If neither is provided, fall back to direct param apply (for future extensions)
          if (next.rage !== undefined || next.sweat !== undefined) {
            applyEmotionUI(next)
          } else {
            const core = getCoreModel()
            if (core?.setParameterValueById) {
              for (const [paramId, value] of Object.entries(params)) {
                if (typeof value === 'number')
                  core.setParameterValueById(paramId, value)
              }
            }
          }

          console.log('[Live2DComponent] Received BC emotion:', params)
          return
        }

        if (data.type === 'happy') {
          const on = !!data.on
          setHappyAura(on)
          console.log('[Live2DComponent] Received BC happy:', on)
          return
        }
      } catch (err) {
        console.warn(
          '[Live2DComponent] BroadcastChannel message handling failed:',
          err
        )
      }
    }

    bc.addEventListener('message', onMessage)
    return () => {
      try {
        bc.removeEventListener('message', onMessage)
        bc.close()
      } catch {}
    }
  }, [applyEmotionUI, getCoreModel, setHappyAura])

  const initApp = () => {
    if (!canvasContainerRef.current) return

    const canvasElement = canvasContainerRef.current
    const initialWidth =
      canvasElement.parentElement?.clientWidth || window.innerWidth
    const initialHeight =
      canvasElement.parentElement?.clientHeight || window.innerHeight
    try {
      const app = new Application({
        width: initialWidth,
        height: initialHeight,
        view: canvasElement,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: getLive2DRendererResolution(),
        powerPreference: 'high-performance',
      })

      setApp(app)
      return
    } catch (error) {
      console.warn(
        '[Live2DComponent] PIXI Application init failed with canvas view, falling back to dynamic canvas',
        error
      )
    }

    try {
      const app = new Application({
        width: initialWidth,
        height: initialHeight,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: getLive2DRendererResolution(),
        powerPreference: 'high-performance',
      })

      const parent = canvasElement.parentElement
      if (parent) {
        const newCanvas = app.view as HTMLCanvasElement
        newCanvas.className = canvasElement.className
        newCanvas.style.width = '100%'
        newCanvas.style.height = '100%'
        parent.replaceChild(newCanvas, canvasElement)
        canvasContainerRef.current = newCanvas
      }

      setApp(app)
    } catch (error) {
      console.error(
        '[Live2DComponent] Failed to initialize PIXI Application:',
        error
      )
    }
  }

  const loadLive2DModel = async (
    currentApp: Application,
    modelPath: string
  ) => {
    if (!canvasContainerRef.current) return

    const resolveModelPath = async (path: string): Promise<string> => {
      const candidatePath = resolvePublicAssetPath(path)

      // If the provided path 404s, try a common fallback (wanko.model3.json)
      try {
        const res = await fetch(candidatePath, { cache: 'no-store' })
        if (res.ok) return candidatePath
      } catch {}

      try {
        const url = new URL(candidatePath, window.location.origin)
        const parts = url.pathname.split('/')
        parts[parts.length - 1] = 'wanko.model3.json'
        const fallback = parts.join('/')
        const res2 = await fetch(fallback, { cache: 'no-store' })
        if (res2.ok) return fallback
      } catch {}

      try {
        const touchFallback = resolvePublicAssetPath(
          '/live2d/wanko/wanko_touch_t01.model3.json'
        )
        const res3 = await fetch(touchFallback, { cache: 'no-store' })
        if (res3.ok) return touchFallback
      } catch {}

      try {
        const wankoFallback = resolvePublicAssetPath(
          '/live2d/wanko/wanko.model3.json'
        )
        const res4 = await fetch(wankoFallback, { cache: 'no-store' })
        if (res4.ok) return wankoFallback
      } catch {}

      return candidatePath
    }

    const resolvedModelPath = await resolveModelPath(modelPath)
    const touchFallback = resolvePublicAssetPath(
      '/live2d/wanko/wanko_touch_t01.model3.json'
    )
    const wankoFallback = resolvePublicAssetPath(
      '/live2d/wanko/wanko.model3.json'
    )
    const candidatePaths = Array.from(
      new Set([resolvedModelPath, touchFallback, wankoFallback])
    )

    const loadModelFromPath = async (path: string) => {
      paramIdsRef.current = []
      loadParamIdsFromDisplayInfo(path).catch(() => {})
      idleParamsRef.current = null
      loadIdleMotionParams(path).catch(() => {})

      return Promise.race([
        Live2DModel.from(path, {
          // Use the app-scoped ticker so it stops when the app is destroyed.
          // Using Ticker.shared can keep updating a destroyed model and crash with
          // `this.motionManager.update` undefined.
          ticker: currentApp.ticker,
          autoHitTest: false,
          autoFocus: false,
        }),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => {
            reject(new Error(`Live2D load timeout: ${path}`))
          }, 8000)
        }),
      ])
    }

    let newModel: any = null
    let lastError: unknown = null
    for (const path of candidatePaths) {
      try {
        newModel = await loadModelFromPath(path)
        break
      } catch (error) {
        lastError = error
        console.warn('[Live2DComponent] Live2D load failed for', path, error)
      }
    }

    if (!newModel) {
      throw lastError
    }

    try {
      currentApp.stage.addChild(newModel as unknown as DisplayObject)
      newModel.anchor.set(0.5, 0.5)
      syncRendererToViewport(currentApp, canvasContainerRef.current)
      setModelPosition(
        currentApp,
        newModel,
        chatLogWidth,
        shouldShowPersistentAvatar,
        { ignoreFixedPosition: shouldShowPersistentAvatar }
      )
      currentApp.render()

      modelRef.current = newModel
      setModel(newModel)

      // Happy aura: create and follow this model
      try {
        ensureHappyAura(currentApp, newModel)
        if (auraRef.current) auraRef.current.visible = happyAuraUI > 0
      } catch (e) {
        console.warn('Failed to setup happy aura:', e)
      }

      // Sad auras: create and follow this model
      try {
        ensureSadRain(currentApp, newModel)
        if (sadRainRef.current) sadRainRef.current.visible = sadRainUI > 0
      } catch (e) {
        console.warn('Failed to setup sad rain:', e)
      }
      try {
        ensureSadHaze(currentApp, newModel)
        if (sadHazeRef.current) sadHazeRef.current.visible = sadHazeUI > 0
      } catch (e) {
        console.warn('Failed to setup sad haze:', e)
      }
      try {
        ensureSadWind(currentApp, newModel)
        if (sadWindRef.current) sadWindRef.current.visible = sadWindUI > 0
      } catch (e) {
        console.warn('Failed to setup sad wind:', e)
      }

      // Re-apply locked params every frame so they win over lipSync / motions
      try {
        const anyM = newModel as any

        // Remove previous hook if any
        if (anyM.__emotionTicker && anyM.__emotionTickerHost?.remove) {
          try {
            anyM.__emotionTickerHost.remove(anyM.__emotionTicker)
          } catch {}
        }

        const tick = () => {
          const core = anyM?.internalModel?.coreModel
          if (!core?.setParameterValueById) return

          const locked = lockedParamsRef.current
          for (const [paramId, value] of Object.entries(locked)) {
            core.setParameterValueById(paramId, value)
          }
        }

        anyM.__emotionTicker = tick
        anyM.__emotionTickerHost = currentApp.ticker
        currentApp.ticker.add(tick)
      } catch (e) {
        console.warn('Failed to attach emotion override ticker:', e)
      }

      // Reset emotion parameters on startup (avoid default angry/sweat)
      // Set default mouth open to 0.5
      try {
        const core = (newModel as any).internalModel?.coreModel
        if (core?.setParameterValueById) {
          // Default mouth opening
          core.setParameterValueById('PARAM_MOUTH_OPEN_Y', 0.5)

          // Store 0.5 as the default value for future restores
          defaultMouthOpenYRef.current = 0.5
          lastMouthOpenYRef.current = null

          // Reset emotions
          core.setParameterValueById('PARAM_RAGE', 0)
          core.setParameterValueById('PARAM_SWEAT', 0)
        }
      } catch (e) {
        console.warn('Failed to reset emotion params:', e)
      }
      // Keep UI state consistent with the reset
      setRageUI(0)
      setSweatUI(0)
      // Unlock any mouth override on load
      lockedParamsRef.current = {}

      // Debug: expose the current Live2D model in devtools
      ;(window as any).__live2d = newModel

      // NOTE: resetToIdle may override the Expression you just applied.
      // If you see it immediately reverting, comment this out while testing.
      // await Live2DHandler.resetToIdle()
    } catch (error) {
      console.error('Failed to load Live2D model:', error)
    }
  }

  // 2点間の距離を計算する関数
  const getDistance = (touch1: Touch, touch2: Touch): number => {
    const dx = touch1.clientX - touch2.clientX
    const dy = touch1.clientY - touch2.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  useEffect(() => {
    if (!canvasContainerRef.current || !model) return

    const canvas = canvasContainerRef.current

    const handlePointerDown = (event: PointerEvent) => {
      const { fixedCharacterPosition } = settingsStore.getState()

      // Don't allow dragging if position is fixed
      if (!fixedCharacterPosition) {
        setIsDragging(true)
        setDragOffset({
          x: event.clientX - model.x,
          y: event.clientY - model.y,
        })
      }

      if (event.button !== 2) {
        model.tap(event.clientX, event.clientY)
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (isDragging) {
        model.x = event.clientX - dragOffset.x
        model.y = event.clientY - dragOffset.y
      }
    }

    const handlePointerUp = () => {
      setIsDragging(false)
      // Save position when dragging ends (if not fixed)
      if (!settingsStore.getState().fixedCharacterPosition) {
        saveModelPosition()
      }
    }

    const handleWheel = (event: WheelEvent) => {
      const { fixedCharacterPosition } = settingsStore.getState()

      // Don't allow scaling if position is fixed
      if (fixedCharacterPosition) return

      event.preventDefault()
      // スケール変更を緩やかにするため、係数を小さくする
      const scaleChange = event.deltaY * -0.0002
      // 現在のスケールに緩やかな変更を適用
      const newScale = model.scale.x + scaleChange
      // スケールの範囲は0.1から2.0に制限
      if (newScale >= 0.1 && newScale <= 2.0) {
        model.scale.set(newScale)
        // Save position when scaling (if not fixed)
        saveModelPosition()
      }
    }

    const handleDragOver = (event: DragEvent) => {
      event.preventDefault()
    }

    const handleDrop = (event: DragEvent) => {
      event.preventDefault()

      const files = event.dataTransfer?.files
      if (!files) {
        return
      }

      const file = files[0]
      if (!file) {
        return
      }

      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.readAsDataURL(file)
        reader.onload = function () {
          const image = reader.result as string
          image !== '' && homeStore.setState({ modalImage: image })
        }
      }
    }

    // タッチイベント処理
    const handleTouchStart = (event: TouchEvent) => {
      const { fixedCharacterPosition } = settingsStore.getState()

      // Don't allow pinch if position is fixed
      if (fixedCharacterPosition) return

      if (event.touches.length === 2) {
        // ピンチ開始
        const dist = getDistance(event.touches[0], event.touches[1])
        setPinchDistance(dist)
        setInitialScale(model.scale.x)
      }
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (
        event.touches.length === 2 &&
        pinchDistance !== null &&
        initialScale !== null
      ) {
        // ピンチ中
        const currentDistance = getDistance(event.touches[0], event.touches[1])
        const scale = initialScale * (currentDistance / pinchDistance)

        // スケールの範囲制限
        const newScale = Math.min(Math.max(scale, 0.1), 2.0)
        model.scale.set(newScale)
      }
    }

    const handleTouchEnd = () => {
      // ピンチ終了
      setPinchDistance(null)
      setInitialScale(null)
      // Save position when pinch gesture ends (if not fixed)
      if (!settingsStore.getState().fixedCharacterPosition) {
        saveModelPosition()
      }
    }

    // イベントリスナーの登録
    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    canvas.addEventListener('dragover', handleDragOver)
    canvas.addEventListener('drop', handleDrop)

    // タッチイベントリスナーの登録
    canvas.addEventListener('touchstart', handleTouchStart)
    canvas.addEventListener('touchmove', handleTouchMove)
    canvas.addEventListener('touchend', handleTouchEnd)

    // クリーンアップ関数
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('wheel', handleWheel)
      canvas.removeEventListener('dragover', handleDragOver)
      canvas.removeEventListener('drop', handleDrop)

      // タッチイベントリスナーの削除
      canvas.removeEventListener('touchstart', handleTouchStart)
      canvas.removeEventListener('touchmove', handleTouchMove)
      canvas.removeEventListener('touchend', handleTouchEnd)
    }
  }, [model, isDragging, dragOffset, pinchDistance, initialScale])

  useEffect(() => {
    if (!app || !model) return

    const onResize = debounce(() => {
      syncRendererToViewport(app, canvasContainerRef.current)

      setModelPosition(app, model, chatLogWidth, shouldShowPersistentAvatar, {
        ignoreFixedPosition: shouldShowPersistentAvatar,
      })
      app.render()
    }, 250)

    onResize()
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    window.visualViewport?.addEventListener('resize', onResize)

    const resizeObserver = new ResizeObserver(onResize)
    if (canvasContainerRef.current) {
      resizeObserver.observe(
        canvasContainerRef.current.parentElement || canvasContainerRef.current
      )
    }

    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
      resizeObserver.disconnect()
      onResize.cancel() // クリーンアップ時にデバウンスをキャンセル
    }
  }, [app, model, chatLogWidth, shouldShowPersistentAvatar])

  useEffect(() => {
    if (!app || !model) return

    let frame2: number | null = null
    const frame1 = window.requestAnimationFrame(() => {
      frame2 = window.requestAnimationFrame(() => {
        syncRendererToViewport(app, canvasContainerRef.current)
        setModelPosition(app, model, chatLogWidth, shouldShowPersistentAvatar, {
          ignoreFixedPosition: shouldShowPersistentAvatar,
        })
        app.render()
      })
    })

    return () => {
      window.cancelAnimationFrame(frame1)
      if (typeof frame2 === 'number') {
        window.cancelAnimationFrame(frame2)
      }
    }
  }, [app, model, chatLogWidth, layoutStageKey, shouldShowPersistentAvatar])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const onLayoutMode = (event: Event) => {
      if (!app || !model) return
      const detail = (event as CustomEvent).detail || {}
      const nextPersistent =
        typeof detail.shouldShowPersistentAvatar === 'boolean'
          ? detail.shouldShowPersistentAvatar
          : shouldShowPersistentAvatar
      const runId = layoutModeRunIdRef.current + 1
      layoutModeRunIdRef.current = runId

      const applyLayout = () => {
        if (layoutModeRunIdRef.current !== runId) return
        syncRendererToViewport(app, canvasContainerRef.current)
        setModelPosition(app, model, chatLogWidth, nextPersistent, {
          ignoreFixedPosition: nextPersistent,
        })
        app.render()
      }

      applyLayout()
      window.setTimeout(applyLayout, 120)
      window.setTimeout(applyLayout, 360)
      window.setTimeout(applyLayout, 720)

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          applyLayout()
        })
      })
    }

    window.addEventListener('live2d:layout-mode', onLayoutMode)
    return () => {
      window.removeEventListener('live2d:layout-mode', onLayoutMode)
    }
  }, [app, model, chatLogWidth, shouldShowPersistentAvatar])

  useEffect(() => {
    if (!model) return
    const hat = new WankoQuizHat(model)
    hat.enabled = isQuizAvatarMode(homeStore.getState().chatLog)
    model.addChild(hat as unknown as DisplayObject)
    quizHatRef.current = hat
    return () => {
      if (quizHatRef.current === hat) quizHatRef.current = null
      if (!hat.destroyed) hat.destroy()
    }
  }, [model])

  useEffect(() => {
    if (quizHatRef.current) quizHatRef.current.enabled = showQuizHat
  }, [showQuizHat])

  return (
    <div className="pointer-events-none absolute inset-0">
      <canvas
        ref={canvasContainerRef}
        className="pointer-events-none block h-full w-full"
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
}

export default Live2DComponent
