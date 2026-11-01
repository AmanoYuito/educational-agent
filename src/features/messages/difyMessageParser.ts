type DifyQuizMessage = {
  type: 'quiz'
  questionType?: 'multiple_choice' | 'written'
  question?: string
  choices?: string[]
  answerIndex?: number
  explanation?: string
  correctAnswer?: string
}

type DifyGradeMessage = {
  type: 'grade'
  correct?: boolean
  correctIndex?: number
  userIndex?: number
  emotion?:
    | 'happy'
    | 'excited'
    | 'bored'
    | 'relaxed'
    | 'sad'
    | 'rage'
    | 'sweat'
    | 'neutral'
    | 'frustrated1'
    | 'frustrated2'
  message?: string
  explanation?: string
}

type DifyOtherMessage = {
  type: string
  [key: string]: unknown
}

export type DifyJsonMessage =
  | DifyQuizMessage
  | DifyGradeMessage
  | DifyOtherMessage
export type DifyJsonResult = DifyJsonMessage | DifyJsonMessage[]

type JsonObject = Record<string, unknown>

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isDifyJsonMessage = (value: unknown): value is DifyJsonMessage =>
  isJsonObject(value) && typeof value.type === 'string'

const parseJsonObject = (text: string): JsonObject | null => {
  try {
    const parsed: unknown = JSON.parse(text)
    return isJsonObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

const parseTextQuiz = (raw: string): DifyQuizMessage | null => {
  if (!raw.includes('【問題】') || !raw.includes('【選択肢】')) return null

  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  let question = ''
  const choices: string[] = []
  let section: 'none' | 'question' | 'choices' = 'none'

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('【問題】')) {
      section = 'question'
      continue
    }
    if (trimmed.startsWith('【選択肢】')) {
      section = 'choices'
      continue
    }
    if (section === 'question') {
      question = question ? `${question}\n${trimmed}` : trimmed
      continue
    }
    if (section === 'choices') {
      const choice = trimmed.match(/^([A-Da-d])[.)]\s*(.+)$/)
      if (choice) choices.push(choice[2].trim())
    }
  }

  return question && choices.length > 0
    ? { type: 'quiz', question, choices }
    : null
}

const tryParseEscapedObject = (chunk: string): JsonObject | null => {
  if (
    !chunk.includes('\\"') &&
    !chunk.includes('\\n') &&
    !chunk.includes('\\t')
  ) {
    return null
  }

  return parseJsonObject(
    chunk
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
  )
}

const extractJsonObjects = (text: string): JsonObject[] => {
  const results: JsonObject[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }

    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (character !== '}') continue

    if (depth > 0) depth -= 1
    if (depth !== 0 || start < 0) continue

    const chunk = text.slice(start, index + 1)
    const parsed = parseJsonObject(chunk) ?? tryParseEscapedObject(chunk)
    if (parsed) results.push(parsed)
    start = -1
  }

  return results
}

const getTypedMessages = (text: string): DifyJsonMessage[] =>
  extractJsonObjects(text).filter(isDifyJsonMessage)

const collectJsonMessages = (raw: string): DifyJsonMessage[] => {
  const messages: DifyJsonMessage[] = []
  const trimmed = raw.trim()

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const outer = parseJsonObject(raw)
    if (isDifyJsonMessage(outer)) {
      messages.push(outer)
    } else if (outer && typeof outer.answer === 'string') {
      messages.push(...getTypedMessages(outer.answer))
    }
  }

  messages.push(...getTypedMessages(raw))

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const unwrapped: unknown = JSON.parse(trimmed)
      if (typeof unwrapped === 'string') {
        messages.push(...getTypedMessages(unwrapped))
      }
    } catch {
      // The raw text is handled by the other parsing strategies.
    }
  }

  const textQuiz = parseTextQuiz(raw)
  if (textQuiz) messages.push(textQuiz)

  return messages
}

const deduplicateMessages = (
  messages: DifyJsonMessage[]
): DifyJsonMessage[] => {
  const seen = new Set<string>()
  return messages.filter((message) => {
    const key = JSON.stringify(message)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const tryParseDifyJson = (raw: string): DifyJsonResult | null => {
  const messages = deduplicateMessages(collectJsonMessages(String(raw || '')))
  if (messages.length === 1) return messages[0]
  return messages.length > 1 ? messages : null
}
