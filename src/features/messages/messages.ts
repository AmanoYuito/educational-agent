export type Message = {
  id?: string
  role: string // "assistant" | "system" | "user";
  content?:
    | string
    | [{ type: 'text'; text: string }, { type: 'image'; image: string }] // マルチモーダル拡張
  html?: string | null
  is_html?: boolean
  meta?: {
    serverQuizId?: string
    quizEvaluationId?: string
    hideAssistantOverlay?: boolean
    emotion?:
      | 'happy'
      | 'excited'
      | 'bored'
      | 'relaxed'
      | 'sad'
      | 'sweat'
      | 'rage'
      | 'neutral'
      | 'frustrated1'
      | 'frustrated2'
    userAnswer?: string
    quiz?: {
      question?: string
      choices?: string[]
      answerIndex?: number
    }
    grade?: {
      answerStatus?: 'correct' | 'incorrect' | 'unanswered'
      correct?: boolean
      userIndex?: number | null
      correctIndex?: number
      emotion?:
        | 'happy'
        | 'excited'
        | 'bored'
        | 'relaxed'
        | 'sad'
        | 'sweat'
        | 'rage'
        | 'neutral'
        | 'frustrated1'
        | 'frustrated2'
      message?: string
      explanation?: string
    }
    quizExplanation?: {
      level: number
    }
  }
  audio?: { id: string }
  timestamp?: string
}

export const EMOTIONS = [
  'neutral',
  'happy',
  'angry',
  'sad',
  'relaxed',
  'surprised',
] as const
export type EmotionType = (typeof EMOTIONS)[number]

export type Talk = {
  emotion: EmotionType
  message: string
  buffer?: ArrayBuffer
}

export const splitSentence = (text: string): string[] => {
  const splitMessages = text.split(/(?<=[。．！？\n])/g)
  return splitMessages.filter((msg) => msg !== '')
}
