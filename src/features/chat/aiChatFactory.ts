import { Message } from '@/features/messages/messages'
import {
  type AIService,
  isVercelCloudAIService,
  isVercelLocalAIService,
} from '@/features/constants/settings'
import { getDifyChatResponseStream } from './difyChat'
import { getVercelAIChatResponseStream } from './vercelAIChat'
import settingsStore from '@/features/stores/settings'
import { getOpenAIAudioChatResponseStream } from '@/features/chat/openAIAudioChat'

export async function getAIChatResponseStream(
  messages: Message[]
): Promise<ReadableStream<string> | null> {
  const ss = settingsStore.getState()
  const envSelectedService = process.env.NEXT_PUBLIC_SELECT_AI_SERVICE as
    | AIService
    | undefined
  const effectiveAIService =
    envSelectedService === 'dify' ? envSelectedService : ss.selectAIService
  const effectiveDifyUrl = ss.difyUrl || process.env.NEXT_PUBLIC_DIFY_URL || ''

  if (effectiveAIService === 'openai' && ss.audioMode) {
    return getOpenAIAudioChatResponseStream(messages)
  }

  if (
    isVercelCloudAIService(effectiveAIService) ||
    isVercelLocalAIService(effectiveAIService)
  ) {
    return getVercelAIChatResponseStream(messages)
  }

  if (effectiveAIService === 'dify') {
    return getDifyChatResponseStream(
      messages,
      ss.difyKey || '',
      effectiveDifyUrl,
      ss.difyConversationId
    )
  }

  throw new Error(`Unsupported AI service: ${effectiveAIService}`)
}
