import { isQuizAvatarMode } from '@/features/live2d/quizAvatarMode'
import { getAssistantMode } from '@/features/messages/assistantMode'
import type { Message } from '@/features/messages/messages'

const quiz: Message = {
  role: 'assistant',
  content: '問題です',
  meta: { quiz: { question: 'メールに使うのは？', choices: ['A', 'B'] } },
}

it('removes the hat when the explanation uses the conversation icon', () => {
  const explanation: Message = {
    role: 'assistant',
    content: 'さっきの問題の正解はGmailです。',
    meta: { quizExplanation: { level: 1 } },
  }
  expect(getAssistantMode(explanation)).toBe('conversation')
  expect(isQuizAvatarMode([quiz, explanation])).toBe(false)
})

it('keeps the hat while the user answers, then follows the next assistant reply', () => {
  const messages = [quiz, { role: 'user', content: 'A' }]
  expect(isQuizAvatarMode(messages)).toBe(true)
  messages.push({ role: 'assistant', content: '今日は何を話そうか？' })
  expect(isQuizAvatarMode(messages)).toBe(false)
  expect(isQuizAvatarMode([])).toBe(false)
})

it.each([
  '[happy] {"type":"quiz","question":"どれ？","choices":["a","b","c","d"]}',
  '{"answer":"{\\"type\\":\\"grade\\",\\"correct\\":true}"}',
  '```json\n{"type":"grade","correct":false}\n```',
  '【問題】\nどれ？\n【選択肢】\nA. メール\nB. 電話',
])('matches the quiz icon for supported output formats: %s', (content) => {
  const message = { role: 'assistant', content }
  expect(getAssistantMode(message)).toBe('quiz')
  expect(isQuizAvatarMode([message])).toBe(true)
})

it('matches the conversation icon for a wrapped ordinary reply', () => {
  const message = { role: 'assistant', content: '{"reply":"こんにちは"}' }
  expect(getAssistantMode(message)).toBe('conversation')
  expect(isQuizAvatarMode([quiz, message])).toBe(false)
})
