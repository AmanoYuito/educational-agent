import type { Message } from '@/features/messages/messages'
import { getAssistantMode } from '@/features/messages/assistantMode'

// Follow the latest assistant icon, including ordinary quiz explanations.
// Pending answers and retained quiz memory must not override that visible mode.
export function isQuizAvatarMode(messages: Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      return getAssistantMode(messages[i]) === 'quiz'
    }
  }
  return false
}
