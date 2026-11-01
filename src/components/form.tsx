import { useCallback, useEffect, useState } from 'react'
import settingsStore from '@/features/stores/settings'
import homeStore from '@/features/stores/home'
import menuStore from '@/features/stores/menu'
import slideStore from '@/features/stores/slide'
import {
  handleSendChatFn,
  type SendChatOptions,
} from '../features/chat/handlers'
import { MessageInputContainer } from './messageInputContainer'
import { PresetQuestionButtons } from './presetQuestionButtons'
import { SlideText } from './slideText'
import { isMultiModalAvailable } from '@/features/constants/aiModels'
import { AIService } from '@/features/constants/settings'
import type { StudyWorkspaceView } from './studyWorkspace'

export const Form = ({
  workspaceView,
}: {
  workspaceView?: StudyWorkspaceView
}) => {
  const modalImage = homeStore((s) => s.modalImage)
  const webcamStatus = homeStore((s) => s.webcamStatus)
  const captureStatus = homeStore((s) => s.captureStatus)
  const slideMode = settingsStore((s) => s.slideMode)
  const slideVisible = menuStore((s) => s.slideVisible)
  const slidePlaying = slideStore((s) => s.isPlaying)
  const chatProcessingCount = homeStore((s) => s.chatProcessingCount)
  const multiModalMode = settingsStore((s) => s.multiModalMode)
  const selectAIService = settingsStore((s) => s.selectAIService)
  const selectAIModel = settingsStore((s) => s.selectAIModel)
  const enableMultiModal = settingsStore((s) => s.enableMultiModal)
  const customModel = settingsStore((s) => s.customModel)
  const [delayedSend, setDelayedSend] = useState<{
    text: string
    options?: SendChatOptions
  } | null>(null)
  const handleSendChat = handleSendChatFn()

  useEffect(() => {
    // テキストと画像がそろったら、チャットを送信
    if (delayedSend && modalImage) {
      handleSendChat(delayedSend.text, delayedSend.options)
      setDelayedSend(null)
    }

    // コンポーネントがアンマウントされる際にpending操作をクリーンアップ
    return () => {
      if (delayedSend) {
        setDelayedSend(null)
      }
    }
  }, [modalImage, delayedSend, handleSendChat])

  const hookSendChat = useCallback(
    (text: string, options?: SendChatOptions) => {
      // マルチモーダル機能が使用可能かチェック
      const isMultiModalSupported = isMultiModalAvailable(
        selectAIService as AIService,
        selectAIModel,
        enableMultiModal,
        multiModalMode,
        customModel
      )

      // モードに基づいて画像キャプチャの必要性を判定
      let shouldCaptureImage = false

      if (isMultiModalSupported && (webcamStatus || captureStatus)) {
        switch (multiModalMode) {
          case 'always':
            shouldCaptureImage = true
            break
          case 'never':
            shouldCaptureImage = false
            break
          case 'ai-decide':
            // AI判断モードの場合、とりあえず画像をキャプチャして、後でAIに判断させる
            shouldCaptureImage = true
            break
        }
      }

      // 画像キャプチャが必要な場合
      if (shouldCaptureImage) {
        // すでにmodalImageが存在する場合は、Webcamのキャプチャーをスキップ
        homeStore.setState((state) => {
          if (!state.modalImage) {
            return { ...state, triggerShutter: true }
          }
          return state
        })
        // 画像が取得されるまで遅延させる
        setDelayedSend({ text, options })
      } else {
        // 画像キャプチャが不要な場合は直接送信
        handleSendChat(text, options)
      }
    },
    [
      handleSendChat,
      webcamStatus,
      captureStatus,
      setDelayedSend,
      multiModalMode,
      selectAIService,
      selectAIModel,
      enableMultiModal,
      customModel,
    ]
  )

  const handleGenerateQuestion = useCallback(() => {
    hookSendChat('問題を1問生成してください。', {
      dify: {
        mode: 'generate_question',
        generationStartedAt: performance.now(),
      },
    })
  }, [hookSendChat])

  return slideMode &&
    slideVisible &&
    slidePlaying &&
    chatProcessingCount !== 0 ? (
    <SlideText />
  ) : (
    <>
      <PresetQuestionButtons onSelectQuestion={hookSendChat} />
      <MessageInputContainer
        onChatProcessStart={hookSendChat}
        onGenerateQuestion={handleGenerateQuestion}
        workspaceView={workspaceView}
      />
    </>
  )
}
