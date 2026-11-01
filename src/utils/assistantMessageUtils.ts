import { Message } from '@/features/messages/messages'
import { getMessageText } from '@/features/messages/messageContent'

export const getLatestAssistantEntry = (
  chatLog: Message[] | null | undefined
): Message | null => {
  if (!chatLog || chatLog.length === 0) {
    return null
  }

  for (let i = chatLog.length - 1; i >= 0; i -= 1) {
    if (chatLog[i].role === 'assistant') {
      return chatLog[i]
    }
  }

  return null
}

/**
 * chatLogから最新のアシスタントメッセージのコンテンツを取得する
 * @param chatLog メッセージログ
 * @returns 最新のアシスタントメッセージの文字列コンテンツ、存在しない場合は空文字
 */
export const getLatestAssistantMessage = (
  chatLog: Message[] | null | undefined
): string => {
  const msg = getLatestAssistantEntry(chatLog)
  if (!msg) {
    return ''
  }

  return getMessageText(msg.content)
}
