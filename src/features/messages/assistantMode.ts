import { EMOTIONS, type Message } from './messages'
import { getMessageText } from './messageContent'
import { tryParseDifyJson, type DifyJsonResult } from './difyMessageParser'

export { tryParseDifyJson }
export type { DifyJsonMessage } from './difyMessageParser'

export type AssistantMode = 'conversation' | 'quiz'

const getReply = (value: unknown): string | null => {
  if (
    typeof value === 'object' &&
    value !== null &&
    'reply' in value &&
    typeof value.reply === 'string' &&
    value.reply.trim()
  ) {
    return value.reply
  }
  return null
}

const extractReplyText = (raw: string): string => {
  const text = raw.trim()
  if (!text) return ''

  try {
    const parsed: unknown = JSON.parse(text)
    const directReply = getReply(parsed)
    if (directReply) return directReply

    if (typeof parsed === 'string') {
      const nested: unknown = JSON.parse(parsed)
      const nestedReply = getReply(nested)
      if (nestedReply) return nestedReply
    }
  } catch {
    // Non-JSON responses are displayed unchanged.
  }

  return raw
}

const normalizeExplanationDisplayText = (text: string): string =>
  text
    .replace(/\r\n/g, '\n')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*>\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const isQuizParsedMessage = (parsed: DifyJsonResult | null): boolean => {
  if (!parsed) return false
  const messages = Array.isArray(parsed) ? parsed : [parsed]
  return messages.some(
    (message) => message.type === 'quiz' || message.type === 'grade'
  )
}

// The chat badge/icon and Live2D avatar must use the same message classification.
export const getAssistantDisplayText = (
  message: Pick<Message, 'content' | 'meta'>
): string => {
  const emotionPattern = new RegExp(`\\[(${EMOTIONS.join('|')})\\]\\s*`, 'gi')
  const text = extractReplyText(
    getMessageText(message.content).replace(emotionPattern, '')
  )

  return typeof message.meta?.quizExplanation?.level === 'number'
    ? normalizeExplanationDisplayText(text)
    : text
}

export const getAssistantMode = (
  message: Pick<Message, 'role' | 'content' | 'meta'>,
  parsed: DifyJsonResult | null = tryParseDifyJson(
    getAssistantDisplayText(message)
  )
): AssistantMode => {
  if (message.role === 'user') return 'conversation'

  const text = getAssistantDisplayText(message)
  const isQuiz =
    isQuizParsedMessage(parsed) ||
    !!message.meta?.grade ||
    !!message.meta?.quiz?.question ||
    (text.includes('【問題】') && text.includes('【選択肢】'))

  return isQuiz ? 'quiz' : 'conversation'
}
