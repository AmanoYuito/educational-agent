import type { Message } from './messages'
import {
  createMultimodalMessageContent,
  getMessageImage,
  getMessageText,
  isMultimodalMessageContent,
} from './messageContent'
import settingsStore from '@/features/stores/settings'

const isSupportedRole = (
  role: string
): role is 'assistant' | 'user' | 'system' =>
  role === 'assistant' || role === 'user' || role === 'system'

const appendMessageText = (message: Message, appendedText: string): Message => {
  const text = `${getMessageText(message.content)} ${appendedText}`
  const image = getMessageImage(message.content)

  return {
    ...message,
    content:
      image === undefined ? text : createMultimodalMessageContent(text, image),
  }
}

export const messageSelectors = {
  // テキストまたは画像を含むメッセージのみを取得
  getTextAndImageMessages: (messages: Message[]): Message[] =>
    messages.filter(
      (message) =>
        !!message.content &&
        (typeof message.content === 'string' ||
          isMultimodalMessageContent(message.content))
    ),

  // 音声メッセージのみを取得
  getAudioMessages: (messages: Message[]): Message[] =>
    messages.filter((message) => {
      if (message.role === 'system') return !!message.content
      if (message.role === 'user') return typeof message.content === 'string'
      if (message.role === 'assistant') return message.audio !== undefined
      return false
    }),

  // メッセージを処理して、テキストメッセージのみを取得
  getProcessedMessages: (
    messages: Message[],
    includeTimestamp: boolean
  ): Message[] => {
    const maxPastMessages = settingsStore.getState().maxPastMessages

    return messages
      .map((message, index) => {
        // 最後のメッセージだけマルチモーダルの対象にする
        const isLastMessage = index === messages.length - 1
        const messageText = getMessageText(message.content)
        const image = getMessageImage(message.content)
        const textWithTimestamp =
          includeTimestamp && message.timestamp
            ? `[${message.timestamp}] ${messageText}`
            : messageText

        let content: Message['content']
        if (includeTimestamp) {
          content =
            isLastMessage && image !== undefined
              ? createMultimodalMessageContent(textWithTimestamp, image)
              : textWithTimestamp
        } else {
          content = isLastMessage ? message.content : messageText
        }

        return {
          role: isSupportedRole(message.role) ? message.role : 'assistant',
          content,
        }
      })
      .slice(-maxPastMessages)
  },

  // メッセージを正規化して、同じIDの連続メッセージを統合
  normalizeMessages: (messages: Message[]): Message[] => {
    let lastImageUrl = ''

    return messages
      .reduce((normalizedMessages: Message[], message) => {
        const image = getMessageImage(message.content)
        if (image !== undefined) lastImageUrl = image

        const previousMessage =
          normalizedMessages[normalizedMessages.length - 1]
        const shouldMerge =
          previousMessage?.role === message.role &&
          previousMessage.id !== undefined &&
          previousMessage.id === message.id

        if (shouldMerge) {
          const hasTextToAppend = isMultimodalMessageContent(message.content)
            ? getMessageText(message.content).length > 0
            : typeof message.content === 'string'

          if (hasTextToAppend) {
            normalizedMessages[normalizedMessages.length - 1] =
              appendMessageText(
                previousMessage,
                getMessageText(message.content)
              )
          }
          return normalizedMessages
        }

        const text = getMessageText(message.content).trim()
        const content =
          lastImageUrl === ''
            ? text
            : createMultimodalMessageContent(text, lastImageUrl)

        normalizedMessages.push({ ...message, content })
        lastImageUrl = ''
        return normalizedMessages
      }, [])
      .filter((message) => message.content !== '')
  },

  // 画像メッセージをテキストメッセージに変換
  cutImageMessage: (messages: Message[]): Message[] =>
    messages.map((message) => ({
      ...message,
      content: getMessageText(message.content),
    })),

  // APIで保存する際にバイナリデータをプレースホルダーへ置換
  // 戻り値の形は保存先との後方互換性のため従来どおり動的に保つ
  sanitizeMessageForStorage: (message: Message): any => {
    if (message.audio !== undefined) {
      return { ...message, audio: '[audio data omitted]' }
    }

    const image = getMessageImage(message.content)
    if (image !== undefined) {
      return {
        ...message,
        content: createMultimodalMessageContent(
          getMessageText(message.content),
          '[image data omitted]'
        ),
      }
    }

    return { ...message }
  },
}
