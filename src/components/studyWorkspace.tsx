import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ChatWorkspaceHeader } from '@/components/chatWorkspaceHeader'
import { Form } from '@/components/form'
import ImageOverlay from '@/components/ImageOverlay'
import { Introduction } from '@/components/introduction'
import { LessonMaterialViewer } from '@/components/lessonMaterialViewer'
import Live2DViewer from '@/components/live2DViewer'
import { Menu } from '@/components/menu'
import { Meta } from '@/components/meta'
import MessageReceiver from '@/components/messageReceiver'
import ModalImage from '@/components/modalImage'
import { Toasts } from '@/components/toasts'
import { WebSocketManager } from '@/components/websocketManager'
import { WorkspaceResizeHandle } from '@/components/workspaceResizeHandle'
import { YoutubeManager } from '@/components/youtubeManager'
import type { LessonDefinition } from '@/config/lessons'
import { isQuizAvatarMode } from '@/features/live2d/quizAvatarMode'
import { useLearningActivity } from '@/features/learningActivity/useLearningActivity'
import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import toastStore from '@/features/stores/toast'
import '@/lib/i18n'
import styles from '@/styles/chatWorkspace.module.css'
import { buildUrl } from '@/utils/buildUrl'
import {
  DEFAULT_WORKSPACE_AVATAR_CHAT_RATIO,
  DEFAULT_WORKSPACE_MATERIAL_CHAT_RATIO,
  getWorkspaceChatPaneWidth,
  MOBILE_LAYOUT_MAX,
} from '@/utils/responsiveLayout'

export type StudyWorkspaceView = 'material' | 'avatar'

type WorkspaceStyle = CSSProperties & {
  '--chat-pane-width'?: string
  '--study-rail'?: string
}

export const StudyWorkspace = ({ lesson }: { lesson: LessonDefinition }) => {
  const [workspaceView, setWorkspaceView] =
    useState<StudyWorkspaceView>('material')
  const workspaceRef = useRef<HTMLDivElement>(null)
  const [workspaceWidth, setWorkspaceWidth] = useState(0)
  const isProblemMode = homeStore((s) => isQuizAvatarMode(s.chatLog))
  const webcamStatus = homeStore((s) => s.webcamStatus)
  const captureStatus = homeStore((s) => s.captureStatus)
  const backgroundImageUrl = homeStore((s) => s.backgroundImageUrl)
  const useVideoAsBackground = settingsStore((s) => s.useVideoAsBackground)
  const messageReceiverEnabled = settingsStore((s) => s.messageReceiverEnabled)
  const { t } = useTranslation()
  const characterPreset1 = settingsStore((s) => s.characterPreset1)
  const characterPreset2 = settingsStore((s) => s.characterPreset2)
  const characterPreset3 = settingsStore((s) => s.characterPreset3)
  const characterPreset4 = settingsStore((s) => s.characterPreset4)
  const characterPreset5 = settingsStore((s) => s.characterPreset5)
  const workspaceAvatarChatRatio = settingsStore(
    (s) => s.workspaceAvatarChatRatio
  )
  const workspaceMaterialChatRatio = settingsStore(
    (s) => s.workspaceMaterialChatRatio
  )
  const characterPresets = useMemo(
    () => [
      characterPreset1,
      characterPreset2,
      characterPreset3,
      characterPreset4,
      characterPreset5,
    ],
    [
      characterPreset1,
      characterPreset2,
      characterPreset3,
      characterPreset4,
      characterPreset5,
    ]
  )
  const { recordActivity } = useLearningActivity({
    lessonId: lesson.id,
    viewMode: workspaceView,
    isProblemMode,
  })

  useEffect(() => {
    homeStore.setState({
      selectedLessonId: lesson.id,
    })
  }, [lesson.datasetId, lesson.id])

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return

    const updateWidth = () => setWorkspaceWidth(workspace.clientWidth)
    updateWidth()

    const resizeObserver = new ResizeObserver(updateWidth)
    resizeObserver.observe(workspace)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return
      const keyNumber = Number(event.code.replace('Digit', ''))
      if (!Number.isInteger(keyNumber) || keyNumber < 1 || keyNumber > 5) return
      settingsStore.setState({ systemPrompt: characterPresets[keyNumber - 1] })
      toastStore.getState().addToast({
        message: t('Toasts.PresetSwitching', {
          presetName: t(`Characterpreset${keyNumber}`),
        }),
        type: 'info',
        tag: 'character-preset-switching',
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [characterPresets, t])

  const bgUrl =
    (webcamStatus || captureStatus) && useVideoAsBackground
      ? ''
      : backgroundImageUrl === 'green' || backgroundImageUrl === 'white'
        ? ''
        : `url(${buildUrl(backgroundImageUrl)})`
  const backgroundStyle =
    (webcamStatus || captureStatus) && useVideoAsBackground
      ? {}
      : backgroundImageUrl === 'green'
        ? { backgroundColor: '#00FF00' }
        : backgroundImageUrl === 'white' ||
            backgroundImageUrl === '/backgrounds/bg-c.png'
          ? { backgroundColor: 'var(--chat-background)' }
          : { backgroundImage: bgUrl }

  const activeChatRatio =
    workspaceView === 'material'
      ? workspaceMaterialChatRatio
      : workspaceAvatarChatRatio
  const fallbackChatRatio =
    workspaceView === 'material'
      ? DEFAULT_WORKSPACE_MATERIAL_CHAT_RATIO
      : DEFAULT_WORKSPACE_AVATAR_CHAT_RATIO
  const chatPaneWidth = getWorkspaceChatPaneWidth(
    workspaceWidth,
    activeChatRatio,
    fallbackChatRatio
  )
  const workspaceStyle: WorkspaceStyle = { ...backgroundStyle }

  if (workspaceWidth >= MOBILE_LAYOUT_MAX && chatPaneWidth > 0) {
    workspaceStyle['--chat-pane-width'] = `${chatPaneWidth}px`
    if (workspaceView === 'avatar') {
      workspaceStyle['--study-rail'] = `${workspaceWidth - chatPaneWidth}px`
    }
  }

  const handleChatPaneWidthChange = useCallback(
    (width: number) => {
      if (!workspaceWidth) return

      const ratio = width / workspaceWidth
      if (workspaceView === 'material') {
        settingsStore.setState({ workspaceMaterialChatRatio: ratio })
      } else {
        settingsStore.setState({ workspaceAvatarChatRatio: ratio })
      }
    },
    [workspaceView, workspaceWidth]
  )

  return (
    <div
      ref={workspaceRef}
      className={`${styles.workspace} h-[100svh] bg-cover`}
      data-chat-workspace
      data-mode={isProblemMode ? 'quiz' : 'conversation'}
      data-workspace-view={workspaceView}
      style={workspaceStyle}
    >
      <Meta />
      <ChatWorkspaceHeader
        isProblemMode={isProblemMode}
        lesson={lesson}
        workspaceView={workspaceView}
        onWorkspaceViewChange={setWorkspaceView}
      />
      <WorkspaceResizeHandle
        chatPaneWidth={chatPaneWidth}
        containerRef={workspaceRef}
        onChange={handleChatPaneWidthChange}
        workspaceView={workspaceView}
      />
      <Introduction />
      <LessonMaterialViewer
        lesson={lesson}
        isProblemMode={isProblemMode}
        onActivity={recordActivity}
        onOpenExternal={() => setWorkspaceView('avatar')}
      />
      <Live2DViewer
        modern
        workspaceView={workspaceView}
        onAvatarSelect={() => setWorkspaceView('avatar')}
      />
      <Form workspaceView={workspaceView} />
      <Menu modern />
      <ModalImage />
      {messageReceiverEnabled && <MessageReceiver />}
      <Toasts />
      <WebSocketManager />
      <YoutubeManager />
      <ImageOverlay />
    </div>
  )
}
