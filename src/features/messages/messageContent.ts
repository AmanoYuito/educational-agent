import type { Message } from './messages'

export type MultimodalMessageContent = Exclude<
  Message['content'],
  string | undefined
>
type TextMessageContent = Extract<
  MultimodalMessageContent[number],
  { type: 'text' }
>
type ImageMessageContent = Extract<
  MultimodalMessageContent[number],
  { type: 'image' }
>

export const isMultimodalMessageContent = (
  content: Message['content']
): content is MultimodalMessageContent => Array.isArray(content)

export const getMessageText = (content: Message['content']): string => {
  if (typeof content === 'string') return content
  if (!isMultimodalMessageContent(content)) return ''

  const textContent = content.find(
    (item): item is TextMessageContent => item.type === 'text'
  )
  return textContent?.text ?? ''
}

export const getMessageImage = (
  content: Message['content']
): string | undefined => {
  if (!isMultimodalMessageContent(content)) return undefined

  const imageContent = content.find(
    (item): item is ImageMessageContent => item.type === 'image'
  )
  return imageContent?.image
}

export const createMultimodalMessageContent = (
  text: string,
  image: string
): MultimodalMessageContent => [
  { type: 'text', text },
  { type: 'image', image },
]
