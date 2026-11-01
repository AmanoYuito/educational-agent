import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageInput } from '@/components/messageInput'
import { type SendChatOptions } from '@/features/chat/handlers'
import homeStore from '@/features/stores/home'
import type { StudyWorkspaceView } from './studyWorkspace'

// 無音検出用の状態と変数を追加
type Props = {
  onChatProcessStart: (text: string, options?: SendChatOptions) => void
  onGenerateQuestion?: () => void
  workspaceView?: StudyWorkspaceView
}

export const MessageInputContainer = ({
  onChatProcessStart,
  onGenerateQuestion,
  workspaceView,
}: Props) => {
  const [userMessage, setUserMessage] = useState('')
  const chatProcessing = homeStore((s) => s.chatProcessing)
  const sendGuardRef = useRef<{
    locked: boolean
    lastText: string
    lastAt: number
  }>({
    locked: false,
    lastText: '',
    lastAt: 0,
  })

  useEffect(() => {
    if (!chatProcessing) {
      sendGuardRef.current.locked = false
    }
  }, [chatProcessing])

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setUserMessage(event.target.value)
    },
    []
  )

  const handleSendMessage = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      const trimmedMessage = userMessage.trim()
      if (!trimmedMessage) return

      const now = Date.now()
      const isImmediateDuplicate =
        sendGuardRef.current.locked &&
        sendGuardRef.current.lastText === trimmedMessage &&
        now - sendGuardRef.current.lastAt < 1500

      if (isImmediateDuplicate) {
        return
      }

      sendGuardRef.current = {
        locked: true,
        lastText: trimmedMessage,
        lastAt: now,
      }

      onChatProcessStart(trimmedMessage)
      setUserMessage('')
    },
    [onChatProcessStart, userMessage]
  )

  const handleStopSpeaking = useCallback(() => {
    return
  }, [])

  const handleGenerateQuestion = () => {
    if (!onGenerateQuestion) return
    handleStopSpeaking()
    onGenerateQuestion()
    setUserMessage('')
  }

  return (
    <MessageInput
      userMessage={userMessage}
      onChangeUserMessage={handleInputChange}
      onClickSendButton={handleSendMessage}
      onClickGenerateQuestionButton={handleGenerateQuestion}
      workspaceView={workspaceView}
    />
  )
}
