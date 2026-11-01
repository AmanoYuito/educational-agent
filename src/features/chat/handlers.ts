import { getAIChatResponseStream } from '@/features/chat/aiChatFactory'
import {
  getDifyChatResponse,
  syncDifyConversationVariables,
  type DifyChatRequestOptions,
} from '@/features/chat/difyChat'
import { Message, EmotionType } from '@/features/messages/messages'
import { speakCharacter } from '@/features/messages/speakCharacter'
import { judgeSlide } from '@/features/slide/slideAIHelpers'
import homeStore, {
  type GeneratedQuizMemory,
  type QuestionPoolItem,
  type QuizHistoryItem,
} from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import slideStore from '@/features/stores/slide'
import { goToSlide } from '@/components/slides'
import { messageSelectors } from '../messages/messageSelectors'
import webSocketStore from '@/features/stores/websocketStore'
import i18next from 'i18next'
import toastStore from '@/features/stores/toast'
import { generateMessageId } from '@/utils/messageUtils'
import { withBasePath } from '@/utils/basePath'
import { isMultiModalAvailable } from '@/features/constants/aiModels'
import {
  revealQuizAnswer,
  submitQuizAnswer,
  submitWrittenQuizAnswer,
  type GradeQuizResponse,
} from '../../../app/lib/api/client'

// セッションIDを生成する関数
const generateSessionId = () => generateMessageId()

export type SendChatOptions = {
  dify?: DifyChatRequestOptions
  quizAction?: 'reveal_answer'
}

const QUESTION_REQUEST_PATTERNS = [
  /(?:4択|四択|択一|クイズ|問題|練習問題).*(?:出して|ください|お願い|お願いし|作って|生成して|ちょうだい)/u,
  /(?:出題して|問題を出題して|クイズを出して|問題を作って|問題生成して)/u,
  /(?:メール|ネットワーク|英語|数学|国語|理科|社会|歴史|地理|化学|物理|生物).*(?:の|について).*(?:問題|クイズ).*(?:出して|作って|ください)/u,
]

const QUESTION_REQUEST_EXCLUDE_PATTERNS = [
  /(?:解説|答え|正解|不正解|採点|答え合わせ)/u,
  /(?:さっき|前|この|その).*(?:問題)/u,
]

const shouldRouteToQuestionGeneration = (text: string): boolean => {
  const normalized = String(text || '').trim()
  if (!normalized) return false
  if (
    QUESTION_REQUEST_EXCLUDE_PATTERNS.some((pattern) =>
      pattern.test(normalized)
    )
  ) {
    return false
  }
  return QUESTION_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized))
}

const resetQuizEmotion = () => {
  if (typeof window === 'undefined') return
  const setQuizEmotion = (window as any).__setQuizEmotion as
    | ((
        v:
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
      ) => void)
    | undefined
  if (typeof setQuizEmotion === 'function') {
    setQuizEmotion('neutral')
  }
}

const applyQuizEmotion = (
  emotion:
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
) => {
  if (typeof window === 'undefined') return
  const setQuizEmotion = (window as any).__setQuizEmotion as
    | ((
        v:
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
      ) => void)
    | undefined
  if (typeof setQuizEmotion === 'function') {
    setQuizEmotion(emotion)
    return
  }

  window.dispatchEvent(
    new CustomEvent('quiz:emotion', {
      detail: { emotion },
    })
  )
}

const INITIAL_BOT_PROMPT = '最初の質問をしてください。'
let lastDifyQuiz: {
  question?: string
  choices?: string[]
  answerIndex?: number
} | null = null

const escapeHtml = (input: string): string =>
  String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const normalizeDisplayText = (rawText: string): string => {
  const raw = String(rawText || '').replace(/\r\n/g, '\n')
  return raw
    .replace(/(解説[:：][^\n]*?)\s*(?=【問題】)/g, '$1\n\n')
    .replace(/(解説[:：][^\n]*?)\s*(\d+\s*\/\s*\d+\s*正解)/g, '$1\n\n$2')
    .replace(/(判定できません[^\n]*?)\s*(?=【問題】)/g, '$1\n\n')
    .replace(/(【\s*\d+\s*\/\s*\d+\s*問目\s*】)/g, '\n$1\n')
    .replace(/(【問題】)/g, '\n$1\n')
    .replace(/(【選択肢】)/g, '\n$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const shouldHtmlify = (text: string): boolean =>
  /【問題】|【選択肢】|解説[:：]|正解[:：]|不正解|\/\s*\d+\s*正解/.test(text)

const buildStructuredHtmlFromText = (text: string): string => {
  const normalized = normalizeDisplayText(text)
  const safe = escapeHtml(normalized).replace(/\n/g, '<br/>')
  return `<div class="dify-text">${safe}</div>`
}

const parseGeneratedQuizMemory = (
  rawText: string,
  parsed?: any
): GeneratedQuizMemory | null => {
  const normalized = normalizeDisplayText(rawText)
  if (!normalized) return null

  const rawQuestionType =
    parsed?.questionType ?? parsed?.question_type ?? parsed?.format
  const parsedQuestionType =
    rawQuestionType === 'written' ||
    rawQuestionType === 'descriptive' ||
    rawQuestionType === 'free_text' ||
    rawQuestionType === 'short_answer'
      ? 'written'
      : rawQuestionType === 'multiple_choice' ||
          rawQuestionType === 'choice' ||
          rawQuestionType === 'quiz'
        ? 'multiple_choice'
        : undefined
  const questionFromParsed = parsed?.public?.question ?? parsed?.question
  const choicesFromParsed = parsed?.public?.choices ?? parsed?.choices
  const answerFromParsed =
    typeof parsed?.answer === 'string'
      ? parsed.answer
      : typeof parsed?.correctAnswer === 'string'
        ? parsed.correctAnswer
        : undefined
  const answerIndexFromParsed =
    typeof parsed?.answerIndex === 'number'
      ? parsed.answerIndex
      : typeof parsed?.correctIndex === 'number'
        ? parsed.correctIndex
        : undefined
  const explanationFromParsed =
    typeof parsed?.explanation === 'string' ? parsed.explanation : undefined
  const quizIndexFromParsed =
    typeof parsed?.quizIndex === 'number'
      ? parsed.quizIndex
      : typeof parsed?.quizIndexNext === 'number'
        ? parsed.quizIndexNext
        : typeof parsed?.questionIndex === 'number'
          ? parsed.questionIndex
          : typeof parsed?.questionNo === 'number'
            ? parsed.questionNo
            : undefined
  const totalFromParsed =
    typeof parsed?.total === 'number'
      ? parsed.total
      : typeof parsed?.totalNext === 'number'
        ? parsed.totalNext
        : undefined

  const progressMatch = normalized.match(/【\s*(\d+)\s*\/\s*(\d+)\s*問目\s*】/)
  const quizIndexFromText = progressMatch?.[1]
    ? Number(progressMatch[1])
    : undefined
  const totalFromText = progressMatch?.[2]
    ? Number(progressMatch[2])
    : undefined

  const questionMatch = normalized.match(
    /【問題】\s*([\s\S]*?)(?=【選択肢】|正解[:：]|解説[:：]|$)/
  )
  const choicesSectionMatch = normalized.match(
    /【選択肢】\s*([\s\S]*?)(?=正解[:：]|解説[:：]|$)/
  )
  const answerMatch = normalized.match(/正解[:：]\s*([^\n]+)/)
  const explanationMatch = normalized.match(/解説[:：]\s*([\s\S]+)$/)

  const choicesFromText = choicesSectionMatch?.[1]
    ?.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(?:[A-DＡ-Ｄ1-4][.)．、:]?\s*)?(.+)$/)
      return match?.[1]?.trim() || line
    })
    .filter(Boolean)

  const question =
    typeof questionFromParsed === 'string' && questionFromParsed.trim()
      ? questionFromParsed.trim()
      : questionMatch?.[1]?.trim()
  const choices =
    Array.isArray(choicesFromParsed) && choicesFromParsed.length > 0
      ? choicesFromParsed.map((choice: unknown) => String(choice).trim())
      : choicesFromText && choicesFromText.length > 0
        ? choicesFromText
        : undefined
  const questionType =
    parsedQuestionType || (choices?.length ? 'multiple_choice' : 'written')
  const answer =
    typeof answerFromParsed === 'string' && answerFromParsed.trim()
      ? answerFromParsed.trim()
      : answerMatch?.[1]?.trim()
  const explanation =
    typeof explanationFromParsed === 'string' && explanationFromParsed.trim()
      ? explanationFromParsed.trim()
      : explanationMatch?.[1]?.trim()
  const normalizedChoices = choices?.map((choice) => choice.trim()) || []
  const derivedAnswerIndex =
    typeof answerIndexFromParsed === 'number'
      ? answerIndexFromParsed
      : answer &&
          normalizedChoices.length > 0 &&
          normalizedChoices.findIndex((choice) => {
            const normalizedAnswer = answer
              .replace(/^[A-DＡ-Ｄ1-4][.)．、:\s]*/u, '')
              .trim()
            return choice === normalizedAnswer || answer.includes(choice)
          }) >= 0
        ? normalizedChoices.findIndex((choice) => {
            const normalizedAnswer = answer
              .replace(/^[A-DＡ-Ｄ1-4][.)．、:\s]*/u, '')
              .trim()
            return choice === normalizedAnswer || answer.includes(choice)
          })
        : undefined

  return {
    rawText: normalized,
    questionType,
    ...(question ? { question } : {}),
    ...(choices?.length ? { choices } : {}),
    ...(typeof quizIndexFromParsed === 'number'
      ? { quizIndex: quizIndexFromParsed }
      : typeof quizIndexFromText === 'number'
        ? { quizIndex: quizIndexFromText }
        : {}),
    ...(typeof totalFromParsed === 'number'
      ? { total: totalFromParsed }
      : typeof totalFromText === 'number'
        ? { total: totalFromText }
        : {}),
    ...(typeof derivedAnswerIndex === 'number'
      ? { answerIndex: derivedAnswerIndex }
      : {}),
    ...(answer
      ? { answer }
      : typeof derivedAnswerIndex === 'number' && choices?.[derivedAnswerIndex]
        ? { answer: choices[derivedAnswerIndex] }
        : {}),
    ...(explanation ? { explanation } : {}),
    awaitingAnswer: true,
    lastUserAnswerIndex: null,
    lastIsCorrect: null,
    updatedAt: new Date().toISOString(),
  }
}

const resolveGradeCorrect = (parsed: any, text: string): boolean => {
  if (typeof parsed?.correct === 'boolean') return parsed.correct
  const score =
    typeof parsed?.score === 'number'
      ? parsed.score
      : typeof parsed?.scorePercent === 'number'
        ? parsed.scorePercent
        : undefined
  if (typeof score === 'number') {
    return score >= 70
  }
  return /正解|十分|理解できています|合格/u.test(text)
}

const buildDifyGradeResult = (
  parsed: any,
  text: string,
  userAnswer: string
) => {
  const correct = resolveGradeCorrect(parsed, text)
  const explanation =
    typeof parsed?.explanation === 'string' && parsed.explanation.trim()
      ? parsed.explanation.trim()
      : typeof parsed?.feedback === 'string' && parsed.feedback.trim()
        ? parsed.feedback.trim()
        : text.trim()
  const correctAnswer =
    typeof parsed?.correctAnswer === 'string' && parsed.correctAnswer.trim()
      ? parsed.correctAnswer.trim()
      : typeof parsed?.answer === 'string' && parsed.answer.trim()
        ? parsed.answer.trim()
        : ''

  return {
    type: 'grade' as const,
    correct,
    userIndex: null,
    emotion: (correct ? 'happy' : 'sweat') as 'happy' | 'sweat',
    message:
      typeof parsed?.message === 'string' ? parsed.message : correct ? '' : '',
    explanation,
    correctAnswer,
    userAnswer,
  }
}

const appendWrittenQuizHistory = (
  quizMemory: GeneratedQuizMemory,
  gradeResult: ReturnType<typeof buildDifyGradeResult>,
  userAnswer: string
) => {
  const quizHistoryItem: QuizHistoryItem = {
    id: generateMessageId(),
    questionPoolId: quizMemory.questionPoolId,
    questionType: 'written',
    question: quizMemory.question || quizMemory.rawText || '（問題）',
    choices: quizMemory.choices,
    quizIndex: quizMemory.quizIndex,
    total: quizMemory.total,
    difficultyLevel: quizMemory.difficultyLevel,
    questionGroup: quizMemory.questionGroup,
    correctAnswer: gradeResult.correctAnswer || quizMemory.answer || '',
    userAnswer,
    userIndex: null,
    correct: gradeResult.correct,
    explanation: gradeResult.explanation,
    aiOutput: JSON.stringify(gradeResult),
    answeredAt: new Date().toISOString(),
  }

  homeStore.getState().appendQuizHistory(quizHistoryItem)
}

const parseQuizAnswerIndex = (
  userText: string,
  choices?: string[]
): number | null => {
  const raw = String(userText || '').trim()
  if (!raw) return null

  const normalized = raw.replace(/\s+/g, ' ').trim().toLowerCase()
  const labelMatch = normalized.match(/^([a-d]|[1-4])(?:[\s).．、:]|$)/i)
  if (labelMatch?.[1]) {
    const token = labelMatch[1].toUpperCase()
    if (/^[A-D]$/.test(token)) {
      return token.charCodeAt(0) - 65
    }
    if (/^[1-4]$/.test(token)) {
      return Number(token) - 1
    }
  }

  if (!choices?.length) return null

  const normalizedChoices = choices.map((choice) =>
    choice.replace(/\s+/g, ' ').trim().toLowerCase()
  )
  const exactIndex = normalizedChoices.findIndex(
    (choice) => choice === normalized
  )
  if (exactIndex >= 0) return exactIndex

  const partialMatches = normalizedChoices
    .map((choice, index) => ({ choice, index }))
    .filter(
      ({ choice }) => normalized.includes(choice) || choice.includes(normalized)
    )
  if (partialMatches.length === 1) {
    return partialMatches[0].index
  }

  return null
}

const buildQuizMemorySystemPrompt = (
  quizMemory: GeneratedQuizMemory
): string => {
  const sections = [
    '以下は直近に生成した問題の記憶です。ユーザーがこの問題について質問した場合は、この内容を前提に答えてください。別の話題なら通常どおり会話してください。',
  ]

  if (quizMemory.question) {
    sections.push(`問題: ${quizMemory.question}`)
  }

  sections.push(
    `問題形式: ${quizMemory.questionType === 'written' ? '記述式' : '4択'}`
  )

  if (quizMemory.choices?.length) {
    sections.push(
      `選択肢: ${quizMemory.choices
        .map((choice, index) => `${String.fromCharCode(65 + index)}. ${choice}`)
        .join(' / ')}`
    )
  }

  if (quizMemory.answer) {
    sections.push(`正解: ${quizMemory.answer}`)
  }

  if (quizMemory.explanation) {
    sections.push(`解説: ${quizMemory.explanation}`)
  } else {
    sections.push(`問題全文: ${quizMemory.rawText}`)
  }

  return sections.join('\n')
}

const buildQuestionPoolQuizMemory = (
  item: QuestionPoolItem
): GeneratedQuizMemory => ({
  rawText: item.question,
  serverQuizId: item.serverQuizId,
  questionPoolId: item.id,
  learningSessionId: item.learningSessionId,
  questionType: item.questionType,
  understandSkill: item.understandSkill,
  question: item.question,
  choices: item.choices,
  quizIndex: item.quizIndex,
  total: item.total,
  difficultyLevel: item.difficultyLevel,
  questionGroup: item.questionGroup,
  answerIndex: item.correctIndex,
  answer: item.correctAnswer,
  explanation: item.explanation,
  explanationLevel: 1,
  awaitingAnswer: true,
  lastUserAnswer: '',
  lastUserAnswerIndex: null,
  lastIsCorrect: null,
  updatedAt: new Date().toISOString(),
})

const buildQuestionPoolQuizPayload = (item: QuestionPoolItem) =>
  JSON.stringify({
    type: 'quiz',
    serverQuizId: item.serverQuizId,
    questionType: item.questionType,
    understandSkill: item.understandSkill,
    quizIndex: item.quizIndex,
    total: item.total,
    question: item.question,
    choices: item.choices || [],
    difficultyLevel: item.difficultyLevel,
    questionGroup: item.questionGroup,
  })

const buildQuestionPoolSpeechText = (item: QuestionPoolItem): string => {
  const intro = `問題です。${item.question}`
  if (!item.choices?.length) {
    return intro
  }

  const choices = item.choices
    .map(
      (choice, index) => `${String.fromCharCode(65 + index)}。${String(choice)}`
    )
    .join('。')

  return `${intro}。選択肢は、${choices}です。`
}

export const requestQuestionFromPool = async (params?: {
  topic?: string
  difficulty?: number
  lessonId?: string
}): Promise<boolean> => {
  const searchParams = new URLSearchParams()
  if (params?.topic) {
    searchParams.set('topic', params.topic)
  }
  if (typeof params?.difficulty === 'number') {
    searchParams.set('difficulty', String(params.difficulty))
  }
  const lessonId = params?.lessonId || homeStore.getState().selectedLessonId
  if (lessonId) {
    searchParams.set('lesson', lessonId)
  }

  const response = await fetch(
    withBasePath(
      `/api/question-pool/next/${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
    ),
    {
      method: 'GET',
      credentials: 'include',
    }
  )

  if (response.status === 404) {
    const emptyMessage =
      '問題プールが空です。先に事前生成した問題を追加してください。'
    resetQuizEmotion()
    homeStore.getState().upsertMessage({
      id: generateMessageId(),
      role: 'assistant',
      content: emptyMessage,
      meta: {
        hideAssistantOverlay: true,
      },
    })
    await speakMessageHandler(emptyMessage, { skipUpsert: true })
    return false
  }

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as {
      message?: string
    } | null
    throw new Error(
      errorBody?.message ||
        `問題プールから問題を取得できませんでした（${response.status}）。`
    )
  }

  const data = (await response.json()) as {
    item?: QuestionPoolItem | null
  }

  if (!data.item) {
    return false
  }

  const quizMemory = buildQuestionPoolQuizMemory(data.item)
  homeStore.setState({ latestGeneratedQuizMemory: quizMemory })
  resetQuizEmotion()

  homeStore.getState().upsertMessage({
    id: generateMessageId(),
    role: 'assistant',
    content: buildQuestionPoolQuizPayload(data.item),
    meta: {
      quiz: {
        question: data.item.question,
        choices: data.item.choices,
      },
    },
  })

  await speakMessageHandler(buildQuestionPoolSpeechText(data.item), {
    skipUpsert: true,
  })
  return true
}

export const triggerInitialBotQuestion = async () => {
  const ss = settingsStore.getState()
  const hs = homeStore.getState()
  if (ss.externalLinkageMode || ss.realtimeAPIMode || hs.chatProcessing) return

  const currentChatLog = hs.chatLog
  const latestGeneratedQuizMemory = hs.latestGeneratedQuizMemory
  const messages: Message[] = [
    {
      role: 'system',
      content: ss.systemPrompt,
    },
    ...(latestGeneratedQuizMemory
      ? [
          {
            role: 'system' as const,
            content: buildQuizMemorySystemPrompt(latestGeneratedQuizMemory),
          },
        ]
      : []),
    ...messageSelectors.getProcessedMessages(
      [
        ...currentChatLog,
        {
          role: 'user',
          content: INITIAL_BOT_PROMPT,
        },
      ],
      ss.includeTimestampInUserMessage
    ),
  ]

  try {
    await processAIResponse(messages)
  } catch (e) {
    console.error(e)
  }
}

// コードブロックのデリミネーター
const CODE_DELIMITER = '```'

/**
 * AI判断機能でマルチモーダルを使用するかどうかを決定する
 * @param userMessage ユーザーメッセージ
 * @param image 画像データ
 * @param decisionPrompt AI判断用プロンプト
 * @returns 画像を使用するかどうか
 */
const askAIForMultiModalDecision = async (
  userMessage: string,
  image: string,
  decisionPrompt: string
): Promise<boolean> => {
  try {
    // 直近の会話履歴を取得（最新3つまで）
    const currentChatLog = homeStore.getState().chatLog
    const recentMessages = currentChatLog.slice(-3)

    // 会話履歴をテキストとして構築
    let conversationHistory = ''
    if (recentMessages.length > 0) {
      conversationHistory = '\n\n直近の会話履歴:\n'
      // cutImageMessage関数を使用して画像メッセージをテキストに変換
      const textOnlyMessages = messageSelectors.cutImageMessage(recentMessages)
      textOnlyMessages.forEach((msg, index) => {
        const content = msg.content || ''
        conversationHistory += `${index + 1}. ${msg.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${content}\n`
      })
    }

    // AI判断用のメッセージを構築
    const decisionMessage: Message = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Conversation History:\n${conversationHistory}\n\nUser Message: "${userMessage}"`,
        },
        { type: 'image', image: image },
      ],
      timestamp: new Date().toISOString(),
    }

    // AI判断用のシステムプロンプト
    const systemMessage: Message = {
      role: 'system',
      content: decisionPrompt,
    }

    // AIに判断を求める
    const response = await getAIChatResponseStream([
      systemMessage,
      decisionMessage,
    ])

    if (!response) {
      return false // エラーの場合は画像を使用しない
    }

    // ReadableStreamからテキストを取得
    const reader = response.getReader()
    let result = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        result += value
      }
    } finally {
      reader.releaseLock()
    }

    const decision = result.trim().toLowerCase()

    // 各言語の肯定的な回答をチェック
    const affirmativeResponses = [
      'はい',
      'yes',
      'oui',
      'sí',
      'ja',
      '是',
      '예',
      'tak',
      'da',
      'sim',
    ]
    return affirmativeResponses.some((response) => decision.includes(response))
  } catch (error) {
    console.error('AI判断でエラーが発生しました:', error)
    return false // エラーの場合は画像を使用しない
  }
}

/**
 * テキストから感情タグ `[...]` を抽出する
 * @param text 入力テキスト
 * @returns 感情タグと残りのテキスト
 */
const extractEmotion = (
  text: string
): { emotionTag: string; remainingText: string } => {
  // 先頭のスペースを無視して、感情タグを検出
  const emotionMatch = text.match(/^\s*\[(.*?)\]/)
  if (emotionMatch?.[0]) {
    return {
      emotionTag: emotionMatch[0].trim(), // タグ自体の前後のスペースは除去
      // 先頭のスペースも含めて削除し、さらに前後のスペースを除去
      remainingText: text
        .slice(text.indexOf(emotionMatch[0]) + emotionMatch[0].length)
        .trimStart(),
    }
  }
  return { emotionTag: '', remainingText: text }
}

/**
 * テキストから文法的に区切りの良い文を抽出する
 * @param text 入力テキスト
 * @returns 抽出された文と残りのテキスト
 */
const extractSentence = (
  text: string
): { sentence: string; remainingText: string } => {
  const sentenceMatch = text.match(
    /^(.{1,19}?(?:[。．.!?！？\n]|(?=\[))|.{20,}?(?:[、,。．.!?！？\n]|(?=\[)))/
  )
  if (sentenceMatch?.[0]) {
    return {
      sentence: sentenceMatch[0],
      remainingText: text.slice(sentenceMatch[0].length).trimStart(),
    }
  }
  return { sentence: '', remainingText: text }
}

/**
 * 発話と関連する状態更新を行う
 * @param sessionId セッションID
 * @param sentence 発話する文
 * @param emotionTag 感情タグ (例: "[neutral]")
 * @param currentAssistantMessageListRef アシスタントメッセージリストの参照
 * @param currentSlideMessagesRef スライドメッセージリストの参照
 */
const handleSpeakAndStateUpdate = (
  sessionId: string,
  sentence: string,
  emotionTag: string,
  currentAssistantMessageListRef: { current: string[] },
  currentSlideMessagesRef: { current: string[] }
) => {
  const hs = homeStore.getState()
  const emotion = emotionTag.includes('[')
    ? (emotionTag.slice(1, -1).toLowerCase() as EmotionType)
    : 'neutral'

  // 発話不要/不可能な文字列だった場合はスキップ
  if (
    sentence === '' ||
    sentence.replace(
      /^[\s\u3000\t\n\r\[\(\{「［（【『〈《〔｛«‹〘〚〛〙›»〕》〉』】）］」\}\)\]'"''""・、。,.!?！？:：;；\-_=+~～*＊@＠#＃$＄%％^＾&＆|｜\\＼/／`｀]+$/gu,
      ''
    ) === ''
  ) {
    return
  }

  speakCharacter(
    sessionId,
    { message: sentence, emotion: emotion },
    () => {
      hs.incrementChatProcessingCount()
      currentSlideMessagesRef.current.push(sentence)
      homeStore.setState({
        slideMessages: [...currentSlideMessagesRef.current],
      })
    },
    () => {
      hs.decrementChatProcessingCount()
      currentSlideMessagesRef.current.shift()
      homeStore.setState({
        slideMessages: [...currentSlideMessagesRef.current],
      })
    }
  )
}

/**
 * 受け取ったメッセージを処理し、AIの応答を生成して発話させる (Refactored)
 * @param receivedMessage 処理する文字列
 */
export const speakMessageHandler = async (
  receivedMessage: string,
  options?: { skipUpsert?: boolean }
) => {
  const skipUpsert = options?.skipUpsert ?? false
  const sessionId = generateSessionId()
  const currentSlideMessagesRef = { current: [] as string[] }
  const assistantMessageListRef = { current: [] as string[] }

  let isCodeBlock: boolean = false
  let codeBlockContent: string = ''
  let accumulatedAssistantText: string = ''
  let remainingMessage = receivedMessage
  let currentMessageId: string = generateMessageId()

  while (remainingMessage.length > 0 || isCodeBlock) {
    let processableText = ''
    let currentCodeBlock = ''

    if (isCodeBlock) {
      if (remainingMessage.includes(CODE_DELIMITER)) {
        const [codeEnd, ...rest] = remainingMessage.split(CODE_DELIMITER)
        currentCodeBlock = codeBlockContent + codeEnd
        codeBlockContent = ''
        remainingMessage = rest.join(CODE_DELIMITER).trimStart()
        isCodeBlock = false

        if (accumulatedAssistantText.trim()) {
          if (!skipUpsert) {
            homeStore.getState().upsertMessage({
              id: currentMessageId,
              role: 'assistant',
              content: accumulatedAssistantText.trim(),
            })
          }
          accumulatedAssistantText = ''
        }
        const codeBlockId = generateMessageId()
        if (!skipUpsert) {
          homeStore.getState().upsertMessage({
            id: codeBlockId,
            role: 'code',
            content: currentCodeBlock,
          })
        }

        currentMessageId = generateMessageId()
        continue
      } else {
        codeBlockContent += remainingMessage
        remainingMessage = ''
        continue
      }
    } else if (remainingMessage.includes(CODE_DELIMITER)) {
      const [beforeCode, ...rest] = remainingMessage.split(CODE_DELIMITER)
      processableText = beforeCode
      codeBlockContent = rest.join(CODE_DELIMITER)
      isCodeBlock = true
      remainingMessage = ''
    } else {
      processableText = remainingMessage
      remainingMessage = ''
    }

    if (processableText.length > 0) {
      let localRemaining = processableText.trimStart()
      while (localRemaining.length > 0) {
        const prevLocalRemaining = localRemaining
        const { emotionTag, remainingText: textAfterEmotion } =
          extractEmotion(localRemaining)
        const { sentence, remainingText: textAfterSentence } =
          extractSentence(textAfterEmotion)

        if (sentence) {
          assistantMessageListRef.current.push(sentence)
          const aiText = emotionTag ? `${emotionTag} ${sentence}` : sentence
          accumulatedAssistantText += aiText + ' '
          handleSpeakAndStateUpdate(
            sessionId,
            sentence,
            emotionTag,
            assistantMessageListRef,
            currentSlideMessagesRef
          )
          localRemaining = textAfterSentence
        } else {
          if (localRemaining === prevLocalRemaining && localRemaining) {
            const finalSentence = localRemaining
            assistantMessageListRef.current.push(finalSentence)
            const aiText = emotionTag
              ? `${emotionTag} ${finalSentence}`
              : finalSentence
            accumulatedAssistantText += aiText + ' '
            handleSpeakAndStateUpdate(
              sessionId,
              finalSentence,
              emotionTag,
              assistantMessageListRef,
              currentSlideMessagesRef
            )
            localRemaining = ''
          } else {
            localRemaining = textAfterSentence
          }
        }
        if (
          localRemaining.length > 0 &&
          localRemaining === prevLocalRemaining &&
          !sentence
        ) {
          console.warn(
            'Potential infinite loop detected in speakMessageHandler, breaking. Remaining:',
            localRemaining
          )
          const finalSentence = localRemaining
          assistantMessageListRef.current.push(finalSentence)
          accumulatedAssistantText += finalSentence + ' '
          handleSpeakAndStateUpdate(
            sessionId,
            finalSentence,
            '',
            assistantMessageListRef,
            currentSlideMessagesRef
          )
          break
        }
      }
    }

    if (isCodeBlock && codeBlockContent) {
      if (accumulatedAssistantText.trim()) {
        if (!skipUpsert) {
          homeStore.getState().upsertMessage({
            id: currentMessageId,
            role: 'assistant',
            content: accumulatedAssistantText.trim(),
          })
        }
        accumulatedAssistantText = ''
      }
      remainingMessage = codeBlockContent
      codeBlockContent = ''
    }
  }

  if (accumulatedAssistantText.trim()) {
    if (!skipUpsert) {
      homeStore.getState().upsertMessage({
        id: currentMessageId,
        role: 'assistant',
        content: accumulatedAssistantText.trim(),
      })
    }
  }
  if (isCodeBlock && codeBlockContent.trim()) {
    console.warn('Loop ended unexpectedly while in code block state.')
    if (!skipUpsert) {
      homeStore.getState().upsertMessage({
        role: 'code',
        content: codeBlockContent.trim(),
      })
    }
  }
}

/**
 * AIからの応答を処理する関数 (Refactored for chunk-by-chunk saving)
 * @param messages 解答生成に使用するメッセージの配列
 */
export const processAIResponse = async (
  messages: Message[],
  options?: SendChatOptions
) => {
  const sessionId = generateSessionId()
  homeStore.setState({ chatProcessing: true })
  let stream: ReadableStream<string> | null | undefined

  const currentSlideMessagesRef = { current: [] as string[] }
  const assistantMessageListRef = { current: [] as string[] }

  const ss = settingsStore.getState()
  const envSelectedService = process.env.NEXT_PUBLIC_SELECT_AI_SERVICE as
    | string
    | undefined
  const forceDify = envSelectedService === 'dify'
  const effectiveDifyUrl = ss.difyUrl || process.env.NEXT_PUBLIC_DIFY_URL || ''
  const selectedLessonId = homeStore.getState().selectedLessonId
  const latestGeneratedQuizMemory =
    homeStore.getState().latestGeneratedQuizMemory
  const shouldUseDify =
    forceDify ||
    ss.selectAIService === 'dify' ||
    !!options?.dify ||
    !!selectedLessonId ||
    !!latestGeneratedQuizMemory

  if (shouldUseDify) {
    try {
      const difyOptions: DifyChatRequestOptions | undefined =
        latestGeneratedQuizMemory && !options?.dify?.mode
          ? {
              ...options?.dify,
              inputs: {
                ...options?.dify?.inputs,
                latest_question:
                  latestGeneratedQuizMemory.question ||
                  latestGeneratedQuizMemory.rawText,
                question_type:
                  latestGeneratedQuizMemory.questionType === 'written'
                    ? 'written'
                    : 'multiple_choice',
                latest_choices:
                  latestGeneratedQuizMemory.choices?.join('\n') || '',
                latest_answer: latestGeneratedQuizMemory.awaitingAnswer
                  ? ''
                  : latestGeneratedQuizMemory.answer || '',
                latest_explanation: latestGeneratedQuizMemory.awaitingAnswer
                  ? ''
                  : latestGeneratedQuizMemory.explanation || '',
                latest_user_answer:
                  latestGeneratedQuizMemory.lastUserAnswer || '',
                latest_is_correct:
                  latestGeneratedQuizMemory.lastIsCorrect === null ||
                  latestGeneratedQuizMemory.lastIsCorrect === undefined
                    ? ''
                    : latestGeneratedQuizMemory.lastIsCorrect
                      ? 'true'
                      : 'false',
              },
            }
          : options?.dify
      const explainQuizLevel =
        difyOptions?.mode === 'explain_quiz'
          ? Number.parseInt(
              String(difyOptions?.inputs?.explanation_level || '1'),
              10
            ) || 1
          : null

      const difyResult = await getDifyChatResponse(
        messages,
        ss.difyKey || '',
        effectiveDifyUrl,
        ss.difyConversationId,
        difyOptions?.mode === 'generate_question' &&
          homeStore.getState().selectedLessonId
          ? {
              ...difyOptions,
              inputs: {
                ...difyOptions.inputs,
                lesson_id: homeStore.getState().selectedLessonId!,
              },
            }
          : difyOptions
      )

      const text = difyResult.text || ''
      const segments =
        Array.isArray(difyResult.segments) && difyResult.segments.length > 0
          ? difyResult.segments
          : [
              {
                text,
                html: difyResult.html,
                is_html: difyResult.is_html,
              },
            ]

      let insertedMessage = false
      segments.forEach((segment, index) => {
        const content = difyResult.quizMemory?.serverQuizId
          ? JSON.stringify({
              type: 'quiz',
              serverQuizId: difyResult.quizMemory.serverQuizId,
              question: difyResult.quizMemory.question,
              choices: difyResult.quizMemory.choices,
              quizIndex: difyResult.quizMemory.quizIndex,
              total: difyResult.quizMemory.total,
            })
          : String(segment.text || '').trim()
        if (!content) return

        homeStore.getState().upsertMessage({
          id: generateMessageId(),
          role: 'assistant',
          content,
          ...(difyResult.quizMemory?.serverQuizId
            ? {
                meta: {
                  serverQuizId: difyResult.quizMemory.serverQuizId,
                  ...(difyResult.evaluationId
                    ? { quizEvaluationId: difyResult.evaluationId }
                    : {}),
                },
              }
            : {}),
          ...(difyResult.evaluationId &&
          !difyResult.quizMemory?.serverQuizId &&
          index === segments.length - 1
            ? { meta: { quizEvaluationId: difyResult.evaluationId } }
            : {}),
          ...(typeof explainQuizLevel === 'number'
            ? {
                meta: {
                  quizExplanation: {
                    level: explainQuizLevel,
                  },
                },
              }
            : {}),
          ...(segment.is_html && segment.html
            ? { html: segment.html, is_html: true }
            : {}),
        })
        insertedMessage = true
      })

      if (!insertedMessage && text.trim()) {
        homeStore.getState().upsertMessage({
          id: generateMessageId(),
          role: 'assistant',
          content: text.trim(),
          ...(difyResult.quizMemory?.serverQuizId
            ? {
                meta: {
                  serverQuizId: difyResult.quizMemory.serverQuizId,
                  ...(difyResult.evaluationId
                    ? { quizEvaluationId: difyResult.evaluationId }
                    : {}),
                },
              }
            : {}),
          ...(difyResult.evaluationId && !difyResult.quizMemory?.serverQuizId
            ? { meta: { quizEvaluationId: difyResult.evaluationId } }
            : {}),
          ...(typeof explainQuizLevel === 'number'
            ? {
                meta: {
                  quizExplanation: {
                    level: explainQuizLevel,
                  },
                },
              }
            : {}),
          ...(difyResult.is_html && difyResult.html
            ? { html: difyResult.html, is_html: true }
            : {}),
        })
      }

      if (difyResult.parsed && typeof difyResult.parsed === 'object') {
        const parsed = difyResult.parsed
        const choices = parsed.public?.choices ?? parsed.choices
        const answerIndex =
          typeof parsed.answerIndex === 'number'
            ? parsed.answerIndex
            : typeof parsed.correctIndex === 'number'
              ? parsed.correctIndex
              : undefined
        const question = parsed.public?.question ?? parsed.question
        if (question && Array.isArray(choices)) {
          lastDifyQuiz = {
            question,
            choices,
            answerIndex,
          }
        }
      }

      if (difyOptions?.mode === 'grade_written_answer') {
        const latestQuizMemory = homeStore.getState().latestGeneratedQuizMemory
        const userAnswer = String(difyOptions.inputs?.user_answer || '').trim()
        if (latestQuizMemory && userAnswer) {
          const gradeResult = buildDifyGradeResult(
            difyResult.parsed,
            text,
            userAnswer
          )
          const nextQuizMemory: GeneratedQuizMemory = {
            ...latestQuizMemory,
            awaitingAnswer: false,
            explanationLevel: 1,
            lastUserAnswer: userAnswer,
            lastUserAnswerIndex: null,
            lastIsCorrect: gradeResult.correct,
            answer:
              gradeResult.correctAnswer ||
              latestQuizMemory.answer ||
              latestQuizMemory.explanation ||
              '',
            explanation:
              gradeResult.explanation || latestQuizMemory.explanation || '',
            updatedAt: new Date().toISOString(),
          }

          homeStore.setState({ latestGeneratedQuizMemory: nextQuizMemory })
          appendWrittenQuizHistory(nextQuizMemory, gradeResult, userAnswer)
          applyQuizEmotion(gradeResult.emotion)
        }
      } else if (
        difyOptions?.mode === 'generate_question' ||
        difyResult.quizMemory
      ) {
        const quizMemory =
          difyResult.quizMemory ||
          parseGeneratedQuizMemory(text, difyResult.parsed)
        if (quizMemory) {
          homeStore.setState({ latestGeneratedQuizMemory: quizMemory })

          const activeConversationId =
            difyResult.conversation_id ||
            settingsStore.getState().difyConversationId

          if (activeConversationId) {
            try {
              const result = await syncDifyConversationVariables(
                activeConversationId,
                ss.difyKey || '',
                ss.difyUrl || '',
                {
                  latest_question: quizMemory.question || quizMemory.rawText,
                  question_type:
                    quizMemory.questionType === 'written'
                      ? 'written'
                      : 'multiple_choice',
                  latest_choices: quizMemory.choices?.join('\n') || '',
                  latest_answer: quizMemory.answer || '',
                  latest_explanation: quizMemory.explanation || '',
                  latest_user_answer: '',
                  latest_is_correct: '',
                },
                difyOptions?.user
              )

              if (result.missing.length > 0) {
                console.warn(
                  '[dify] Missing conversation variables:',
                  result.missing
                )
              }
            } catch (syncError) {
              console.error(
                '[dify] Failed to sync conversation variables:',
                syncError
              )
            }
          }
        }
      } else if (difyOptions?.mode === 'explain_quiz') {
        const latestQuizMemory = homeStore.getState().latestGeneratedQuizMemory
        if (
          latestQuizMemory &&
          typeof explainQuizLevel === 'number' &&
          explainQuizLevel > 0
        ) {
          homeStore.setState({
            latestGeneratedQuizMemory: {
              ...latestQuizMemory,
              explanationLevel: explainQuizLevel,
              updatedAt: new Date().toISOString(),
            },
          })
        }
      }

      const speechText =
        difyResult.emotion && difyResult.emotion !== 'neutral'
          ? `[${difyResult.emotion}] ${text}`
          : text
      await speakMessageHandler(speechText, { skipUpsert: true })
    } catch (e) {
      console.error(e)
    } finally {
      homeStore.setState({ chatProcessing: false })
    }
    return
  }

  try {
    stream = await getAIChatResponseStream(messages)
  } catch (e) {
    console.error(e)
    homeStore.setState({ chatProcessing: false })
    return
  }

  if (stream == null) {
    homeStore.setState({ chatProcessing: false })
    return
  }

  const reader = stream.getReader()
  let receivedChunksForSpeech = ''
  let currentMessageId: string | null = null
  let currentMessageContent = ''
  let currentEmotionTag = ''
  let isCodeBlock = false
  let codeBlockContent = ''

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (value) {
        let textToAdd = value

        if (!isCodeBlock) {
          const delimiterIndexInValue = value.indexOf(CODE_DELIMITER)
          if (delimiterIndexInValue !== -1) {
            textToAdd = value.substring(0, delimiterIndexInValue)
          }
        }

        if (currentMessageId === null) {
          currentMessageId = generateMessageId()
          currentMessageContent = textToAdd
          if (currentMessageContent) {
            homeStore.getState().upsertMessage({
              id: currentMessageId,
              role: 'assistant',
              content: currentMessageContent,
            })
          }
        } else if (!isCodeBlock) {
          currentMessageContent += textToAdd

          if (textToAdd) {
            homeStore.getState().upsertMessage({
              id: currentMessageId,
              role: 'assistant',
              content: currentMessageContent,
            })
          }
        }

        // assistantMessage is now derived from chatLog, no need to set it separately

        receivedChunksForSpeech += value
      }

      let processableTextForSpeech = receivedChunksForSpeech
      receivedChunksForSpeech = ''

      while (processableTextForSpeech.length > 0) {
        const originalProcessableText = processableTextForSpeech

        if (isCodeBlock) {
          codeBlockContent += processableTextForSpeech
          processableTextForSpeech = ''

          const delimiterIndex = codeBlockContent.lastIndexOf(CODE_DELIMITER)

          if (
            delimiterIndex !== -1 &&
            delimiterIndex >=
              codeBlockContent.length -
                (originalProcessableText.length + CODE_DELIMITER.length - 1)
          ) {
            const actualCode = codeBlockContent.substring(0, delimiterIndex)
            const remainingAfterDelimiter = codeBlockContent.substring(
              delimiterIndex + CODE_DELIMITER.length
            )

            if (actualCode.trim()) {
              homeStore.getState().upsertMessage({
                role: 'code',
                content: actualCode,
              })
            }

            codeBlockContent = ''
            isCodeBlock = false
            currentEmotionTag = ''

            currentMessageId = generateMessageId()
            currentMessageContent = ''

            processableTextForSpeech = remainingAfterDelimiter.trimStart()
            continue
          } else {
            receivedChunksForSpeech = codeBlockContent + receivedChunksForSpeech
            codeBlockContent = ''
            break
          }
        } else {
          const delimiterIndex =
            processableTextForSpeech.indexOf(CODE_DELIMITER)
          if (delimiterIndex !== -1) {
            const beforeCode = processableTextForSpeech.substring(
              0,
              delimiterIndex
            )
            const afterDelimiterRaw = processableTextForSpeech.substring(
              delimiterIndex + CODE_DELIMITER.length
            )

            //
            let textToProcessBeforeCode = beforeCode.trimStart()
            while (textToProcessBeforeCode.length > 0) {
              const prevText = textToProcessBeforeCode
              const {
                emotionTag: extractedEmotion,
                remainingText: textAfterEmotion,
              } = extractEmotion(textToProcessBeforeCode)
              if (extractedEmotion) currentEmotionTag = extractedEmotion
              const { sentence, remainingText: textAfterSentence } =
                extractSentence(textAfterEmotion)

              if (sentence) {
                handleSpeakAndStateUpdate(
                  sessionId,
                  sentence,
                  currentEmotionTag,
                  assistantMessageListRef,
                  currentSlideMessagesRef
                )
                textToProcessBeforeCode = textAfterSentence
                if (!textAfterSentence) currentEmotionTag = ''
              } else {
                receivedChunksForSpeech =
                  textToProcessBeforeCode + receivedChunksForSpeech
                textToProcessBeforeCode = ''
                break
              }

              if (
                textToProcessBeforeCode.length > 0 &&
                textToProcessBeforeCode === prevText
              ) {
                console.warn('Speech processing loop stuck on:', prevText)
                receivedChunksForSpeech =
                  textToProcessBeforeCode + receivedChunksForSpeech
                break
              }
            }

            isCodeBlock = true
            codeBlockContent = ''

            const langMatch = afterDelimiterRaw.match(/^ *(\w+)? *\n/)
            let remainingAfterDelimiter = afterDelimiterRaw
            if (langMatch) {
              remainingAfterDelimiter = afterDelimiterRaw.substring(
                langMatch[0].length
              )
            }
            processableTextForSpeech = remainingAfterDelimiter
            continue
          } else {
            const {
              emotionTag: extractedEmotion,
              remainingText: textAfterEmotion,
            } = extractEmotion(processableTextForSpeech)
            if (extractedEmotion) currentEmotionTag = extractedEmotion

            const { sentence, remainingText: textAfterSentence } =
              extractSentence(textAfterEmotion)

            if (sentence) {
              handleSpeakAndStateUpdate(
                sessionId,
                sentence,
                currentEmotionTag,
                assistantMessageListRef,
                currentSlideMessagesRef
              )
              processableTextForSpeech = textAfterSentence
              if (!textAfterSentence) currentEmotionTag = ''
            } else {
              receivedChunksForSpeech =
                processableTextForSpeech + receivedChunksForSpeech
              processableTextForSpeech = ''
              break
            }
          }
        }

        if (
          processableTextForSpeech.length > 0 &&
          processableTextForSpeech === originalProcessableText
        ) {
          console.warn(
            'Main speech processing loop stuck on:',
            originalProcessableText
          )
          receivedChunksForSpeech =
            processableTextForSpeech + receivedChunksForSpeech
          processableTextForSpeech = ''
          break
        }
      }

      if (done) {
        if (receivedChunksForSpeech.length > 0) {
          if (!isCodeBlock) {
            const finalSentence = receivedChunksForSpeech
            const { emotionTag: extractedEmotion, remainingText: finalText } =
              extractEmotion(finalSentence)
            if (extractedEmotion) currentEmotionTag = extractedEmotion

            handleSpeakAndStateUpdate(
              sessionId,
              finalText,
              currentEmotionTag,
              assistantMessageListRef,
              currentSlideMessagesRef
            )
          } else {
            console.warn(
              'Stream ended while still in code block state. Saving remaining code.',
              codeBlockContent
            )
            codeBlockContent += receivedChunksForSpeech
            if (codeBlockContent.trim()) {
              homeStore.getState().upsertMessage({
                role: 'code',
                content: codeBlockContent,
              })
            }
            codeBlockContent = ''
            isCodeBlock = false
          }
        }

        if (isCodeBlock && codeBlockContent.trim()) {
          console.warn(
            'Stream ended unexpectedly while in code block state. Saving buffered code.'
          )
          homeStore.getState().upsertMessage({
            role: 'code',
            content: codeBlockContent,
          })
          codeBlockContent = ''
          isCodeBlock = false
        }
        break
      }
    }
  } catch (e) {
    console.error('Error processing AI response stream:', e)
  } finally {
    reader.releaseLock()
  }

  homeStore.setState({
    chatProcessing: false,
  })

  if (currentMessageContent.trim()) {
    const html = shouldHtmlify(currentMessageContent)
      ? buildStructuredHtmlFromText(currentMessageContent)
      : null
    homeStore.getState().upsertMessage({
      id: currentMessageId ?? generateMessageId(),
      role: 'assistant',
      content: currentMessageContent.trim(),
      ...(html ? { html, is_html: true } : {}),
    })
  }
  if (isCodeBlock && codeBlockContent.trim()) {
    console.warn(
      'Stream ended unexpectedly while in code block state. Saving buffered code.'
    )
    homeStore.getState().upsertMessage({
      role: 'code',
      content: codeBlockContent,
    })
    codeBlockContent = ''
    isCodeBlock = false
  }
}

/**
 * アシスタントとの会話を行う
 * 画面のチャット欄から入力されたときに実行される処理
 * Youtubeでチャット取得した場合もこの関数を使用する
 */
export const handleSendChatFn =
  () => async (text: string, options?: SendChatOptions) => {
    const sessionId = generateSessionId()
    const newMessage = text
    const timestamp = new Date().toISOString()

    if (newMessage === null) return
    resetQuizEmotion()

    const ss = settingsStore.getState()
    const sls = slideStore.getState()
    const wsManager = webSocketStore.getState().wsManager
    const modalImage = homeStore.getState().modalImage

    if (ss.externalLinkageMode) {
      homeStore.setState({ chatProcessing: true })

      if (wsManager?.websocket?.readyState === WebSocket.OPEN) {
        homeStore.getState().upsertMessage({
          role: 'user',
          content: newMessage,
          timestamp: timestamp,
        })

        wsManager.websocket.send(
          JSON.stringify({ content: newMessage, type: 'chat' })
        )
      } else {
        toastStore.getState().addToast({
          message: i18next.t('NotConnectedToExternalAssistant'),
          type: 'error',
          tag: 'not-connected-to-external-assistant',
        })
        homeStore.setState({
          chatProcessing: false,
        })
      }
    } else if (ss.realtimeAPIMode) {
      if (wsManager?.websocket?.readyState === WebSocket.OPEN) {
        homeStore.getState().upsertMessage({
          role: 'user',
          content: newMessage,
          timestamp: timestamp,
        })
      }
    } else {
      let systemPrompt = ss.systemPrompt
      if (ss.slideMode) {
        if (sls.isPlaying) {
          return
        }

        try {
          let scripts = JSON.stringify(
            require(
              `../../../public/slides/${sls.selectedSlideDocs}/scripts.json`
            )
          )
          systemPrompt = systemPrompt.replace('{{SCRIPTS}}', scripts)

          let supplement = ''
          try {
            const response = await fetch(
              withBasePath(
                `/api/getSupplement?slideName=${sls.selectedSlideDocs}`
              )
            )
            if (!response.ok) {
              throw new Error('Failed to fetch supplement')
            }
            const data = await response.json()
            supplement = data.supplement
            systemPrompt = systemPrompt.replace('{{SUPPLEMENT}}', supplement)
          } catch (e) {
            console.error('supplement.txtの読み込みに失敗しました:', e)
          }

          const answerString = await judgeSlide(newMessage, scripts, supplement)
          const answer = JSON.parse(answerString)
          if (answer.judge === 'true' && answer.page !== '') {
            goToSlide(Number(answer.page))
            systemPrompt += `\n\nEspecial Page Number is ${answer.page}.`
          }
        } catch (e) {
          console.error(e)
        }
      }

      homeStore.setState({ chatProcessing: true })

      // マルチモーダル対応チェック
      if (
        modalImage &&
        !isMultiModalAvailable(
          ss.selectAIService,
          ss.selectAIModel,
          ss.enableMultiModal,
          ss.multiModalMode,
          ss.customModel
        )
      ) {
        toastStore.getState().addToast({
          message: i18next.t('MultiModalNotSupported'),
          type: 'error',
          tag: 'multimodal-not-supported',
        })
        homeStore.setState({
          chatProcessing: false,
          modalImage: '',
        })
        return
      }

      // マルチモーダルモードに基づいてメッセージコンテンツを構築
      let userMessageContent: Message['content'] = newMessage
      let shouldUseImage = false

      if (modalImage) {
        switch (ss.multiModalMode) {
          case 'always':
            shouldUseImage = true
            break
          case 'never':
            shouldUseImage = false
            break
          case 'ai-decide':
            // AI判断モードの場合は、AIに判断を求める
            shouldUseImage = await askAIForMultiModalDecision(
              newMessage,
              modalImage,
              ss.multiModalAiDecisionPrompt
            )
            break
        }

        if (shouldUseImage) {
          userMessageContent = [
            { type: 'text' as const, text: newMessage },
            { type: 'image' as const, image: modalImage },
          ]
        }
      }

      const activeQuizMemory =
        options?.dify?.mode === 'generate_question'
          ? null
          : homeStore.getState().latestGeneratedQuizMemory
      const shouldRevealQuizAnswer = options?.quizAction === 'reveal_answer'
      let parsedMultipleChoiceAnswerIndex: number | null = null
      if (
        !shouldRevealQuizAnswer &&
        activeQuizMemory?.awaitingAnswer &&
        Array.isArray(activeQuizMemory.choices) &&
        activeQuizMemory.choices.length > 0
      ) {
        parsedMultipleChoiceAnswerIndex = parseQuizAnswerIndex(
          newMessage,
          activeQuizMemory.choices
        )

        if (parsedMultipleChoiceAnswerIndex === null) {
          const retryMessage =
            'A〜D、1〜4、または選択肢の文そのもので答えてね。'
          applyQuizEmotion('frustrated1')
          homeStore.getState().upsertMessage({
            id: generateMessageId(),
            role: 'assistant',
            content: retryMessage,
            meta: {
              emotion: 'frustrated1',
            },
          })
          await speakMessageHandler(retryMessage, { skipUpsert: true })
          homeStore.setState({ chatProcessing: false })
          return
        }
      }

      homeStore.getState().upsertMessage({
        role: 'user',
        content: userMessageContent,
        timestamp: timestamp,
      })

      if (modalImage) {
        homeStore.setState({ modalImage: '' })
      }

      if (
        shouldRevealQuizAnswer &&
        activeQuizMemory?.awaitingAnswer &&
        Array.isArray(activeQuizMemory.choices) &&
        activeQuizMemory.choices.length > 0
      ) {
        try {
          if (!activeQuizMemory.serverQuizId) {
            throw new Error(
              '更新前の問題では正答を取得できません。「問題生成」で新しく問題を生成してください。'
            )
          }
          const revealed = await revealQuizAnswer(activeQuizMemory.serverQuizId)
          const gradeResult = revealed.grade
          const nextQuizMemory: GeneratedQuizMemory = {
            ...activeQuizMemory,
            awaitingAnswer: false,
            explanationLevel: 1,
            answerIndex: gradeResult.correctIndex ?? undefined,
            answer: gradeResult.correctAnswer,
            explanation: gradeResult.explanation,
            lastUserAnswer: 'ー',
            lastUserAnswerIndex: null,
            lastIsCorrect: null,
            updatedAt: new Date().toISOString(),
          }

          homeStore.setState({
            latestGeneratedQuizMemory: nextQuizMemory,
            ...(revealed.learningSet
              ? { learningSetProgress: revealed.learningSet }
              : {}),
          })
          homeStore.getState().appendQuizHistory(revealed.attempt, true)
          homeStore.getState().upsertMessage({
            id: generateMessageId(),
            role: 'assistant',
            content: JSON.stringify({
              ...gradeResult,
              questionType: 'multiple_choice',
              serverQuizId: activeQuizMemory.serverQuizId,
              quizIndex: activeQuizMemory.quizIndex,
              total: activeQuizMemory.total,
              learningSet: revealed.learningSet,
            }),
            meta: {
              emotion: 'neutral',
              userAnswer: 'ー',
              serverQuizId: activeQuizMemory.serverQuizId,
              grade: {
                answerStatus: 'unanswered',
                userIndex: null,
                correctIndex: gradeResult.correctIndex ?? undefined,
                emotion: 'neutral',
                message: gradeResult.message,
                explanation: gradeResult.explanation,
              },
            },
          })
          resetQuizEmotion()
          await speakMessageHandler(
            [
              `正解は${gradeResult.correctAnswer}です。`,
              gradeResult.explanation ? `解説：${gradeResult.explanation}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
            { skipUpsert: true }
          )
        } catch (error) {
          toastStore.getState().addToast({
            message:
              error instanceof Error
                ? error.message
                : '正答と解説を取得できませんでした。もう一度お試しください。',
            type: 'error',
            tag: 'quiz-answer-reveal-error',
          })
        } finally {
          homeStore.setState({ chatProcessing: false })
        }
        return
      }

      if (
        activeQuizMemory?.awaitingAnswer &&
        Array.isArray(activeQuizMemory.choices) &&
        activeQuizMemory.choices.length > 0 &&
        typeof parsedMultipleChoiceAnswerIndex === 'number'
      ) {
        const userIndex = parsedMultipleChoiceAnswerIndex
        let graded: GradeQuizResponse
        try {
          if (!activeQuizMemory.serverQuizId) {
            throw new Error(
              '更新前の問題は採点できません。「問題生成」で新しく問題を生成してください。'
            )
          }
          graded = await submitQuizAnswer(
            activeQuizMemory.serverQuizId,
            userIndex,
            newMessage
          )
        } catch (error) {
          toastStore.getState().addToast({
            message:
              error instanceof Error
                ? error.message
                : '通信に失敗しました。同じ回答をもう一度送信してください。',
            type: 'error',
            tag: 'quiz-grading-error',
          })
          homeStore.setState({ chatProcessing: false })
          return
        }
        const gradeResult = graded.grade

        const nextQuizMemory: GeneratedQuizMemory = {
          ...activeQuizMemory,
          awaitingAnswer: false,
          explanationLevel: 1,
          answerIndex: gradeResult.correctIndex ?? undefined,
          answer:
            (typeof gradeResult.correctIndex === 'number'
              ? graded.attempt.choices?.[gradeResult.correctIndex]
              : undefined) || gradeResult.correctAnswer,
          explanation: gradeResult.explanation,
          lastUserAnswer: newMessage,
          lastUserAnswerIndex: userIndex,
          lastIsCorrect: gradeResult.correct,
          updatedAt: new Date().toISOString(),
        }

        homeStore.setState({
          latestGeneratedQuizMemory: nextQuizMemory,
          ...(graded.learningSet
            ? { learningSetProgress: graded.learningSet }
            : {}),
        })

        homeStore.getState().appendQuizHistory(graded.attempt, true)

        homeStore.getState().upsertMessage({
          id: generateMessageId(),
          role: 'assistant',
          content: JSON.stringify({
            ...gradeResult,
            questionType: 'multiple_choice',
            serverQuizId: graded.attempt.id,
            quizIndex: graded.attempt.quizIndex ?? activeQuizMemory.quizIndex,
            total: graded.attempt.total ?? activeQuizMemory.total,
            learningSet: graded.learningSet,
          }),
          meta: {
            emotion: gradeResult.emotion,
            userAnswer: newMessage,
            serverQuizId: graded.attempt.id,
            grade: {
              answerStatus: gradeResult.correct ? 'correct' : 'incorrect',
              correct: gradeResult.correct,
              userIndex,
              correctIndex: gradeResult.correctIndex ?? undefined,
              emotion: gradeResult.emotion,
              message: gradeResult.message,
              explanation: gradeResult.explanation,
            },
          },
        })
        applyQuizEmotion(gradeResult.emotion)

        if (ss.difyConversationId) {
          try {
            const result = await syncDifyConversationVariables(
              ss.difyConversationId,
              ss.difyKey || '',
              ss.difyUrl || '',
              {
                latest_question:
                  nextQuizMemory.question || nextQuizMemory.rawText,
                question_type:
                  nextQuizMemory.questionType === 'written'
                    ? 'written'
                    : 'multiple_choice',
                latest_choices: nextQuizMemory.choices?.join('\n') || '',
                latest_answer: nextQuizMemory.answer || '',
                latest_explanation: nextQuizMemory.explanation || '',
                latest_user_answer: nextQuizMemory.lastUserAnswer || '',
                latest_is_correct:
                  nextQuizMemory.lastIsCorrect === null ||
                  nextQuizMemory.lastIsCorrect === undefined
                    ? ''
                    : nextQuizMemory.lastIsCorrect
                      ? 'true'
                      : 'false',
              }
            )

            if (result.missing.length > 0) {
              console.warn(
                '[dify] Missing conversation variables:',
                result.missing
              )
            }
          } catch (syncError) {
            console.error(
              '[dify] Failed to sync conversation variables:',
              syncError
            )
          }
        }

        const speechParts = [
          gradeResult.correct
            ? '[happy]正解です。'
            : `[sweat]${gradeResult.message}`,
          nextQuizMemory.explanation
            ? `[neutral]解説：${nextQuizMemory.explanation}`
            : '',
        ].filter(Boolean)
        try {
          await speakMessageHandler(speechParts.join('\n'), {
            skipUpsert: true,
          })
        } finally {
          homeStore.setState({ chatProcessing: false })
        }
        return
      }

      if (
        activeQuizMemory?.awaitingAnswer &&
        (activeQuizMemory.questionType === 'written' ||
          !activeQuizMemory.choices?.length)
      ) {
        let graded: GradeQuizResponse
        try {
          if (!activeQuizMemory.serverQuizId) {
            throw new Error(
              '更新前の問題は採点できません。「問題生成」で新しく問題を生成してください。'
            )
          }
          graded = await submitWrittenQuizAnswer(
            activeQuizMemory.serverQuizId,
            newMessage
          )
        } catch (error) {
          toastStore.getState().addToast({
            message:
              error instanceof Error
                ? error.message
                : '通信に失敗しました。同じ回答をもう一度送信してください。',
            type: 'error',
            tag: 'written-quiz-grading-error',
          })
          homeStore.setState({ chatProcessing: false })
          return
        }

        const gradeResult = graded.grade
        const nextQuizMemory: GeneratedQuizMemory = {
          ...activeQuizMemory,
          awaitingAnswer: false,
          explanationLevel: 1,
          answerIndex: undefined,
          answer: gradeResult.correctAnswer,
          explanation: gradeResult.explanation,
          lastUserAnswer: newMessage,
          lastUserAnswerIndex: null,
          lastIsCorrect: gradeResult.correct,
          updatedAt: new Date().toISOString(),
        }
        homeStore.setState({
          latestGeneratedQuizMemory: nextQuizMemory,
          ...(graded.learningSet
            ? { learningSetProgress: graded.learningSet }
            : {}),
        })
        homeStore.getState().appendQuizHistory(graded.attempt, true)
        homeStore.getState().upsertMessage({
          id: generateMessageId(),
          role: 'assistant',
          content: JSON.stringify({
            ...gradeResult,
            questionType: 'written',
            serverQuizId: graded.attempt.id,
            quizIndex: graded.attempt.quizIndex ?? activeQuizMemory.quizIndex,
            total: graded.attempt.total ?? activeQuizMemory.total,
            learningSet: graded.learningSet,
          }),
          meta: {
            emotion: gradeResult.emotion,
            userAnswer: newMessage,
            serverQuizId: graded.attempt.id,
            grade: {
              answerStatus: gradeResult.correct ? 'correct' : 'incorrect',
              correct: gradeResult.correct,
              userIndex: undefined,
              correctIndex: undefined,
              emotion: gradeResult.emotion,
              message: gradeResult.message,
              explanation: gradeResult.explanation,
            },
          },
        })
        resetQuizEmotion()
        const speechParts = [
          gradeResult.message || '採点結果と解説を確認してください。',
          gradeResult.explanation ? `解説：${gradeResult.explanation}` : '',
        ].filter(Boolean)
        try {
          await speakMessageHandler(speechParts.join('\n'), {
            skipUpsert: true,
          })
        } finally {
          homeStore.setState({ chatProcessing: false })
        }
        return
      }

      const currentChatLog = homeStore.getState().chatLog
      const latestGeneratedQuizMemory =
        homeStore.getState().latestGeneratedQuizMemory
      const shouldAutoGenerateQuestion =
        !options?.dify?.mode && shouldRouteToQuestionGeneration(newMessage)
      const resolvedOptions: SendChatOptions | undefined =
        shouldAutoGenerateQuestion
          ? {
              ...options,
              dify: {
                ...(options?.dify || {}),
                mode: 'generate_question',
              },
            }
          : options

      if (resolvedOptions?.dify?.mode === 'generate_question') {
        try {
          await requestQuestionFromPool({
            lessonId: homeStore.getState().selectedLessonId,
          })
        } catch (error) {
          console.error('[question-pool] Failed to issue question:', error)
          toastStore.getState().addToast({
            message:
              error instanceof Error
                ? error.message
                : '問題プールから問題を取得できませんでした。',
            type: 'error',
            tag: 'question-pool-fetch-error',
          })
        } finally {
          homeStore.setState({ chatProcessing: false })
        }
        return
      }

      const messages: Message[] = [
        {
          role: 'system',
          content: systemPrompt,
        },
        ...(latestGeneratedQuizMemory && !resolvedOptions?.dify?.mode
          ? [
              {
                role: 'system' as const,
                content: buildQuizMemorySystemPrompt(latestGeneratedQuizMemory),
              },
            ]
          : []),
        ...messageSelectors.getProcessedMessages(
          currentChatLog,
          ss.includeTimestampInUserMessage
        ),
      ]

      try {
        await processAIResponse(messages, resolvedOptions)
      } catch (e) {
        console.error(e)
        homeStore.setState({ chatProcessing: false })
      }
    }
  }

/**
 * WebSocketからのテキストを受信したときの処理
 */
export const handleReceiveTextFromWsFn =
  () =>
  async (
    text: string,
    role?: string,
    emotion: EmotionType = 'neutral',
    type?: string
  ) => {
    const sessionId = generateSessionId()
    if (text === null || role === undefined) return

    const ss = settingsStore.getState()
    const hs = homeStore.getState()
    const wsManager = webSocketStore.getState().wsManager

    if (ss.externalLinkageMode) {
      console.log('ExternalLinkage Mode: true')
    } else {
      console.log('ExternalLinkage Mode: false')
      return
    }

    homeStore.setState({ chatProcessing: true })

    if (role !== 'user') {
      if (type === 'start') {
        // startの場合は何もしない（textは空文字のため）
        console.log('Starting new response')
        wsManager?.setTextBlockStarted(false)
      } else if (
        hs.chatLog.length > 0 &&
        hs.chatLog[hs.chatLog.length - 1].role === role &&
        wsManager?.textBlockStarted
      ) {
        // 既存のメッセージに追加（IDを維持）
        const lastMessage = hs.chatLog[hs.chatLog.length - 1]
        const lastContent =
          typeof lastMessage.content === 'string' ? lastMessage.content : ''

        homeStore.getState().upsertMessage({
          id: lastMessage.id,
          role: role,
          content: lastContent + text,
        })
      } else {
        // 新しいメッセージを追加（新規IDを生成）
        homeStore.getState().upsertMessage({
          role: role,
          content: text,
        })
        wsManager?.setTextBlockStarted(true)
      }

      if (role === 'assistant' && text !== '') {
        try {
          // 文ごとに音声を生成 & 再生、返答を表示
          speakCharacter(
            sessionId,
            {
              message: text,
              emotion: emotion,
            },
            () => {
              // assistantMessage is now derived from chatLog, no need to set it separately
            },
            () => {
              // hs.decrementChatProcessingCount()
            }
          )
        } catch (e) {
          console.error('Error in speakCharacter:', e)
        }
      }

      if (type === 'end') {
        // レスポンスの終了処理
        console.log('Response ended')
        wsManager?.setTextBlockStarted(false)
        homeStore.setState({ chatProcessing: false })
      }
    }

    homeStore.setState({ chatProcessing: type !== 'end' })
  }

/**
 * RealtimeAPIからのテキストまたは音声データを受信したときの処理
 */
export const handleReceiveTextFromRtFn = () => {
  // 連続する response.audio イベントで共通の sessionId を使用するための変数
  let currentSessionId: string | null = null

  return async (
    text?: string,
    role?: string,
    type?: string,
    buffer?: ArrayBuffer
  ) => {
    // type が `response.audio` かつ currentSessionId が未設定の場合に新しいセッションIDを発番
    // それ以外の場合は既存の sessionId を使い続ける。
    // レスポンス終了（content_part.done 等）時にリセットする。

    if (currentSessionId === null) {
      currentSessionId = generateSessionId()
    }

    const sessionId = currentSessionId

    const ss = settingsStore.getState()
    const hs = homeStore.getState()

    if (ss.realtimeAPIMode) {
      console.log('realtime api mode: true')
    } else if (ss.audioMode) {
      console.log('audio mode: true')
    } else {
      console.log('realtime api mode: false')
      return
    }

    homeStore.setState({ chatProcessing: true })

    if (role == 'assistant') {
      if (type?.includes('response.audio') && buffer !== undefined) {
        console.log('response.audio:')
        try {
          speakCharacter(
            sessionId,
            {
              emotion: 'neutral',
              message: '',
              buffer: buffer,
            },
            () => {},
            () => {}
          )
        } catch (e) {
          console.error('Error in speakCharacter:', e)
        }
      } else if (type === 'response.content_part.done' && text !== undefined) {
        homeStore.getState().upsertMessage({
          role: role,
          content: text,
        })
      }
    }
    homeStore.setState({ chatProcessing: false })

    // レスポンスが完了したらセッションIDをリセット
    if (type === 'response.content_part.done') {
      currentSessionId = null
    }
  }
}
