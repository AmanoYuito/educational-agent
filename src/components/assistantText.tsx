import { Message } from '@/features/messages/messages'
import { getMessageText } from '@/features/messages/messageContent'
import settingsStore from '@/features/stores/settings'
import {
  getPlainMessage,
  isQuizRetryMessage,
  isStructuredQuizMessage,
} from '@/utils/quizMessageUtils'

const isStatusLikeAssistantMessage = (plainMessage: string) => {
  const normalized = plainMessage.trim()

  return [
    '問題プールが空です。',
    '先に事前生成した問題を追加してください。',
    'ログイン処理に失敗しました。',
    '認証に失敗しました。',
  ].some((pattern) => normalized.includes(pattern))
}

export const AssistantText = ({ message }: { message: Message }) => {
  const characterName = settingsStore((s) => s.characterName)
  const showCharacterName = settingsStore((s) => s.showCharacterName)
  const showPresetQuestions = settingsStore((s) => s.showPresetQuestions)
  const presetQuestions = settingsStore((s) => s.presetQuestions)
  const rawMessage = getMessageText(message.content)
  const plainMessage = getPlainMessage(rawMessage)

  const shouldHideOverlay =
    !!message.meta?.hideAssistantOverlay ||
    isStructuredQuizMessage(plainMessage) ||
    isQuizRetryMessage(plainMessage) ||
    isStatusLikeAssistantMessage(plainMessage) ||
    !!message.meta?.quiz ||
    !!message.meta?.grade ||
    !!message.meta?.quizExplanation ||
    message.meta?.emotion === 'excited' ||
    message.meta?.emotion === 'bored' ||
    message.meta?.emotion === 'sad' ||
    message.meta?.emotion === 'relaxed' ||
    message.meta?.emotion === 'frustrated1' ||
    message.meta?.emotion === 'frustrated2'

  if (shouldHideOverlay) {
    return null
  }

  // Check if preset questions should be shown AND there are actual questions
  const shouldShowPresetQuestions =
    showPresetQuestions && presetQuestions.length > 0

  return (
    <div
      className={`absolute bottom-0 left-0 ${shouldShowPresetQuestions ? 'md:mb-[180px] mb-[180px]' : 'md:mb-[96px] mb-[80px]'} w-full z-10`}
    >
      <div className="mx-auto max-w-4xl w-full p-4">
        <div className="bg-white rounded-lg">
          {showCharacterName && (
            <div className="px-6 py-2 bg-slate-200 rounded-t-lg text-black font-bold tracking-wider">
              {characterName}
            </div>
          )}
          <div className="px-6 py-4">
            <div className="line-clamp-4 text-black font-bold">
              {plainMessage.replace(/\[([a-zA-Z]*?)\]/g, '')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
