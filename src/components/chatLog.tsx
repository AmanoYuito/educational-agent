import { QuizLearningSupport } from './quizLearningSupport'
import Image from 'next/image'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Message } from '@/features/messages/messages'
import { getMessageText } from '@/features/messages/messageContent'
import {
  getAssistantDisplayText,
  getAssistantMode,
  tryParseDifyJson,
  type AssistantMode,
  type DifyJsonMessage,
} from '@/features/messages/assistantMode'
import { handleSendChatFn } from '@/features/chat/handlers'

import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import { messageSelectors } from '@/features/messages/messageSelectors'
import { getChatPaneWidth } from '@/utils/responsiveLayout'
import { useViewportLayout } from '@/hooks/useViewportLayout'
import { buildUrl } from '@/utils/buildUrl'
import { isQuizUiOnlyMessage } from '@/utils/quizMessageUtils'
import { observeEvaluationDisplay } from '@/features/quizEvaluation/client'

// --- Dify JSON helpers ---
// Difyに「JSONだけ返す」プロンプトを入れている場合、本文がJSON文字列になる。
// そのまま表示すると読みにくいので、ここでパースしてカード表示にする。

const extractInlineEmotion = (
  text: string
):
  | 'happy'
  | 'excited'
  | 'bored'
  | 'relaxed'
  | 'sad'
  | 'sweat'
  | 'rage'
  | 'neutral'
  | null => {
  const raw = String(text || '')
  const plain = raw.match(
    /"emotion"\s*:\s*"(happy|excited|bored|relaxed|sad|sweat|rage|neutral)"/i
  )
  if (plain?.[1]) return plain[1].toLowerCase() as any
  const escaped = raw.match(
    /\\"emotion\\"\s*:\s*\\"(happy|excited|bored|relaxed|sad|sweat|rage|neutral)\\"/i
  )
  if (escaped?.[1]) return escaped[1].toLowerCase() as any
  return null
}

const buildQuestionGenerationContext = (): string => {
  const { chatLog, latestGeneratedQuizMemory } = homeStore.getState()

  const recentConversation = chatLog
    .filter(
      (message) => message.role === 'user' || message.role === 'assistant'
    )
    .map((message) => ({
      role: message.role === 'user' ? '学習者' : 'AI',
      text: getMessageText(message.content).trim(),
    }))
    .filter(({ text }) => text.length > 0 && !isQuizUiOnlyMessage(text))
    .slice(-6)
    .map(({ role, text }) => `${role}: ${text}`)

  const sections: string[] = []

  if (recentConversation.length > 0) {
    sections.push(`直前会話:\n${recentConversation.join('\n')}`)
  }

  if (latestGeneratedQuizMemory?.question) {
    sections.push(`直近の問題: ${latestGeneratedQuizMemory.question}`)
  }

  if (latestGeneratedQuizMemory?.lastUserAnswer) {
    sections.push(
      `学習者の直近回答: ${latestGeneratedQuizMemory.lastUserAnswer}`
    )
  }

  if (
    latestGeneratedQuizMemory?.lastIsCorrect !== null &&
    latestGeneratedQuizMemory?.lastIsCorrect !== undefined
  ) {
    sections.push(
      `学習者の直近回答の正誤: ${
        latestGeneratedQuizMemory.lastIsCorrect ? '正解' : '不正解'
      }`
    )
  }

  return sections.join('\n\n').slice(0, 2000)
}

const MAX_QUIZ_EXPLANATION_LEVEL = 3

const buildLatestQuizInputs = (
  quizMemory: ReturnType<typeof homeStore.getState>['latestGeneratedQuizMemory']
): Record<string, string> => {
  if (!quizMemory) return {}
  return {
    latest_question: quizMemory.question || quizMemory.rawText || '',
    question_type:
      quizMemory.questionType === 'written' ? 'written' : 'multiple_choice',
    latest_choices: quizMemory.choices?.join('\n') || '',
    latest_answer: quizMemory.answer || '',
    latest_explanation: quizMemory.explanation || '',
    latest_user_answer: quizMemory.lastUserAnswer || '',
    latest_is_correct:
      quizMemory.lastIsCorrect === null ||
      quizMemory.lastIsCorrect === undefined
        ? ''
        : quizMemory.lastIsCorrect
          ? 'true'
          : 'false',
  }
}

const buildQuizExplanationRequest = (
  quizMemory: ReturnType<
    typeof homeStore.getState
  >['latestGeneratedQuizMemory'],
  currentLevel?: number
) => {
  const nextLevel = Math.min(
    MAX_QUIZ_EXPLANATION_LEVEL,
    (currentLevel || 1) + 1
  )
  const text =
    nextLevel >= MAX_QUIZ_EXPLANATION_LEVEL
      ? 'さっきの問題について、初学者にもわかるように、身近な具体例を1つ以上使って説明してください。見出しや箇条書きは使わず、普通の文だけで、順番にやさしく説明してください。'
      : 'さっきの問題について、前の説明よりもわかりやすく、順を追って説明してください。必要なら簡単な具体例も入れてください。見出しや箇条書きは使わず、普通の文だけで説明してください。'

  return {
    buttonLabel: 'もっとわかりやすく解説して',
    text,
    options: {
      dify: {
        mode: 'explain_quiz' as const,
        inputs: {
          ...buildLatestQuizInputs(quizMemory),
          explanation_level: String(nextLevel),
        },
      },
    },
  }
}

const buildQuestionGenerationRequest = () => {
  const conversationContext = buildQuestionGenerationContext()
  return {
    text: '問題を1問生成してください。',
    options: {
      dify: {
        mode: 'generate_question' as const,
        ...(conversationContext ? { topic: conversationContext } : {}),
        ...(conversationContext
          ? {
              inputs: {
                conversation_context: conversationContext,
                allowed_question_types: 'multiple_choice,written',
                question_generation_policy:
                  '基本は4択。学習が進んで知識定着を確認したい場合は、用語説明や理由説明の記述式問題を出す。',
              },
            }
          : {}),
      },
    },
  }
}

type MessageBlock =
  | { type: 'text'; text: string }
  | {
      type: 'list'
      listStyle: 'bullet' | 'number' | 'alpha'
      items: string[]
    }

const parseMessageBlocks = (raw: string): MessageBlock[] => {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const blocks: MessageBlock[] = []
  let textBuffer: string[] = []
  let listBuffer: {
    listStyle: 'bullet' | 'number' | 'alpha'
    items: string[]
  } | null = null

  const flushText = () => {
    if (textBuffer.length === 0) return
    const text = textBuffer.join('\n').trimEnd()
    if (text) blocks.push({ type: 'text', text })
    textBuffer = []
  }

  const flushList = () => {
    if (!listBuffer || listBuffer.items.length === 0) {
      listBuffer = null
      return
    }
    blocks.push({
      type: 'list',
      listStyle: listBuffer.listStyle,
      items: listBuffer.items,
    })
    listBuffer = null
  }

  const normalizeListItem = (line: string) => {
    const trimmed = line.trim()
    let match = trimmed.match(/^([-*•])\s+(.+)$/)
    if (match) {
      return { listStyle: 'bullet' as const, text: match[2].trim() }
    }

    match = trimmed.match(/^(\d+)[.)]\s+(.+)$/)
    if (match) {
      return { listStyle: 'number' as const, text: match[2].trim() }
    }

    match = trimmed.match(/^([A-Za-z])[.)]\s+(.+)$/)
    if (match) {
      return { listStyle: 'alpha' as const, text: match[2].trim() }
    }

    return null
  }

  lines.forEach((line) => {
    const item = normalizeListItem(line)
    if (item) {
      flushText()
      if (!listBuffer || listBuffer.listStyle !== item.listStyle) {
        flushList()
        listBuffer = { listStyle: item.listStyle, items: [] }
      }
      listBuffer.items.push(item.text)
      return
    }

    flushList()
    textBuffer.push(line)
  })

  flushList()
  flushText()

  if (blocks.length === 0 && raw.trim()) {
    return [{ type: 'text', text: raw }]
  }

  return blocks
}

const insertSentenceLineBreaks = (text: string) => {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/([。！？!?][」』】）”"]?)([^\n])/g, '$1\n$2')
}

const renderMessageBlocks = (blocks: MessageBlock[]) => {
  return (
    <div className="space-y-2">
      {blocks.map((block, idx) => {
        if (block.type === 'list') {
          const listClass =
            block.listStyle === 'bullet'
              ? 'list-disc'
              : block.listStyle === 'alpha'
                ? 'list-[upper-alpha]'
                : 'list-decimal'
          const ListTag = block.listStyle === 'bullet' ? 'ul' : 'ol'
          return (
            <ListTag key={idx} className={`${listClass} pl-5 space-y-1`}>
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx}>{item}</li>
              ))}
            </ListTag>
          )
        }

        return (
          <div key={idx} className="whitespace-pre-line">
            {insertSentenceLineBreaks(block.text)}
          </div>
        )
      })}
    </div>
  )
}

const isActiveQuizCard = (
  question: string,
  choices: string[] | undefined,
  quizMemory: ReturnType<typeof homeStore.getState>['latestGeneratedQuizMemory']
) => {
  if (!quizMemory?.awaitingAnswer) return false
  const normalizedQuestion = question.trim()
  const currentQuestion = (
    quizMemory.question ||
    quizMemory.rawText ||
    ''
  ).trim()
  if (!normalizedQuestion || normalizedQuestion !== currentQuestion)
    return false
  if (!choices?.length) return true
  if (
    !quizMemory.choices?.length ||
    quizMemory.choices.length !== choices.length
  ) {
    return false
  }

  return choices.every(
    (choice, index) => choice.trim() === quizMemory.choices?.[index]?.trim()
  )
}

const isLikelyQuizAnswerMessage = (
  text: string,
  quizMemory: ReturnType<typeof homeStore.getState>['latestGeneratedQuizMemory']
) => {
  const normalized = String(text || '').trim()
  if (!normalized) return false
  if (normalized === '答えと解説を教えてください。') return true

  if (
    quizMemory?.awaitingAnswer &&
    (quizMemory.questionType === 'written' || !quizMemory.choices?.length)
  ) {
    return true
  }

  if (/^[A-Da-d]$/.test(normalized)) return true
  if (/^[1-4]$/.test(normalized)) return true
  if (/^[A-Da-d][.)、:]$/.test(normalized)) return true
  if (/^[1-4][.)、:]$/.test(normalized)) return true

  const choices = quizMemory?.choices?.map((choice) => choice.trim()) ?? []
  return choices.includes(normalized)
}

// Timers to avoid overlapping emotion resets across re-renders
let live2dHappyOffTimer: ReturnType<typeof setTimeout> | null = null
let live2dEmotionResetTimer: ReturnType<typeof setTimeout> | null = null
let live2dEmotionPoint = { x: 0, y: 0 }

const clampEmotionValue = (value: number) => Math.max(-1, Math.min(1, value))

const setLive2DEmotionPoint = (point: { x: number; y: number }) => {
  live2dEmotionPoint = {
    x: clampEmotionValue(point.x),
    y: clampEmotionValue(point.y),
  }
  return live2dEmotionPoint
}

const isLive2DEmotionDisabled = () =>
  typeof window !== 'undefined' &&
  (window as any).__disableLive2DEmotion === true

const applyLive2DEmotionByPoint = () => {
  let emotion: 'happy' | 'relaxed' | 'sad' | 'rage' | 'neutral' = 'neutral'

  if (live2dEmotionPoint.x > 0 && live2dEmotionPoint.y < 0) {
    emotion = 'relaxed'
  } else if (live2dEmotionPoint.x > 0) {
    emotion = 'happy'
  } else if (live2dEmotionPoint.x < 0 && live2dEmotionPoint.y < 0) {
    emotion = 'rage'
  } else if (live2dEmotionPoint.x < 0) {
    emotion = 'sad'
  }
  applyLive2DEmotion(emotion)
}

const resolveGradeEmotion = (grade: {
  correct?: boolean
  userIndex?: number | null
  emotion?: string
}) => {
  // Written-answer grading deliberately returns neutral because partial
  // understanding should not trigger a positive or negative avatar reaction.
  if (grade.emotion === 'neutral') return null
  if (grade.emotion === 'happy' || grade.emotion === 'relaxed') {
    return grade.emotion
  }
  if (grade.emotion === 'sweat') return 'sweat'
  if (grade.emotion === 'rage') return 'rage'
  if (grade.emotion === 'sad') {
    return grade.correct === false ? 'sweat' : 'sad'
  }
  if (grade.correct === true) return 'happy'
  if (grade.userIndex === null) return 'rage'
  if (grade.correct === false) return 'sweat'
  return null
}

const pointForEmotion = (
  emotion: 'happy' | 'relaxed' | 'sad' | 'sweat' | 'rage'
) => {
  if (emotion === 'relaxed') return { x: 1, y: -1 }
  if (emotion === 'happy') return { x: 1, y: 0 }
  if (emotion === 'rage') return { x: -1, y: -1 }
  return { x: -1, y: 0 }
}

const resetLive2DEmotionPoint = () => {
  live2dEmotionPoint = { x: 0, y: 0 }
  applyLive2DEmotion('neutral')
}

const showLive2DAvatarBurst = (durationMs = 3000) => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent('quiz:avatar-burst', {
      detail: { durationMs },
    })
  )
}

const applyLive2DEmotion = (
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
  if (isLive2DEmotionDisabled()) return

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

  if (emotion === 'frustrated1' || emotion === 'frustrated2') {
    window.dispatchEvent(
      new CustomEvent('quiz:emotion', {
        detail: { emotion },
      })
    )
    return
  }

  // Clear pending timers so old emotions can't re-apply/override later
  if (live2dHappyOffTimer) {
    clearTimeout(live2dHappyOffTimer)
    live2dHappyOffTimer = null
  }
  if (live2dEmotionResetTimer) {
    clearTimeout(live2dEmotionResetTimer)
    live2dEmotionResetTimer = null
  }

  // Prefer same-tab exposed APIs
  const applyEmotionFn = (window as any).__live2dApplyEmotion as
    | ((v: any) => void)
    | undefined
  const setHappyFn = (window as any).__live2dSetHappy as
    | ((v: any) => void)
    | undefined

  const dispatchEmotionEvent = (params: Record<string, number>) => {
    window.dispatchEvent(
      new CustomEvent('live2d:emotion', {
        detail: { params, ...params },
      })
    )
  }

  const dispatchHappyEvent = (on: boolean) => {
    window.dispatchEvent(
      new CustomEvent('live2d:happy', {
        detail: { on },
      })
    )
  }

  const hardNeutralReset = () => {
    // happy off
    try {
      if (typeof setHappyFn === 'function') setHappyFn(false)
    } catch {}
    dispatchHappyEvent(false)

    // emotion params to zero
    try {
      if (typeof applyEmotionFn === 'function') {
        applyEmotionFn({
          rage: 0,
          sweat: 0,
          PARAM_RAGE: 0,
          PARAM_SWEAT: 0,
          PARAM_EYE_L_OPEN: 1,
          PARAM_EYE_R_OPEN: 1,
        })
      }
    } catch {}
    dispatchEmotionEvent({
      PARAM_RAGE: 0,
      PARAM_SWEAT: 0,
      PARAM_EYE_L_OPEN: 1,
      PARAM_EYE_R_OPEN: 1,
    })
  }

  if (emotion === 'happy') {
    try {
      if (typeof setHappyFn === 'function') setHappyFn(true)
    } catch {}
    dispatchHappyEvent(true)
    return
  }

  if (emotion === 'neutral') {
    hardNeutralReset()
    return
  }

  // rage / sweat
  const params =
    emotion === 'rage'
      ? { PARAM_RAGE: 1, PARAM_SWEAT: 0 }
      : { PARAM_RAGE: 0, PARAM_SWEAT: 1 }

  try {
    if (typeof applyEmotionFn === 'function') {
      // robust payload
      applyEmotionFn({
        rage: params.PARAM_RAGE,
        sweat: params.PARAM_SWEAT,
        PARAM_RAGE: params.PARAM_RAGE,
        PARAM_SWEAT: params.PARAM_SWEAT,
      })
    }
  } catch {}
  dispatchEmotionEvent(params)

  // keep until next reset
}

const assistantModeIconMap: Record<
  AssistantMode,
  {
    src: string
    alt: string
    label: string
    labelClassName: string
    frameClassName: string
    headerClassName: string
  }
> = {
  conversation: {
    src: '/images/icons/wanko-conversation.png',
    alt: '会話モードのワンコロ',
    label: '会話モード',
    labelClassName: 'bg-[#FDE7CF] text-[#8F4F18] ring-1 ring-[#D9A16A]/40',
    frameClassName: 'bg-white ring-[#BFCDE2]/70',
    headerClassName: 'bg-[#F8E7D3]',
  },
  quiz: {
    src: '/images/icons/wanko-quiz-professor.png',
    alt: '問題モードの博士ワンコ',
    label: '問題モード',
    labelClassName: 'bg-[#D8E6FF] text-[#245DCC]',
    frameClassName: 'bg-white ring-[#BFCDE2]/70',
    headerClassName: 'bg-[#C6D9FB]',
  },
}

const AssistantModeIcon = ({ mode }: { mode: AssistantMode }) => {
  const config = assistantModeIconMap[mode]

  return (
    <div
      className={`chat-avatar flex h-[5.25rem] w-[5.25rem] shrink-0 items-center justify-center rounded-full ring-1 ${config.frameClassName}`}
    >
      <Image
        src={buildUrl(config.src)}
        alt={config.alt}
        width={62}
        height={62}
        unoptimized
        className="h-[3.9rem] w-[3.9rem] object-contain"
      />
    </div>
  )
}

const AssistantIdentity = ({
  mode,
  characterName,
}: {
  mode: AssistantMode
  characterName: string
}) => {
  const config = assistantModeIconMap[mode]

  return (
    <div
      className={`chat-identity min-w-0 px-6 py-3 ${config.headerClassName}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm font-bold tracking-wide text-[#24303B]">
          {characterName || 'AIエージェント'}
        </div>
        <span
          className={`chat-mode-tag inline-flex rounded-full px-3 py-1 text-sm font-bold ${config.labelClassName}`}
        >
          {config.label}
        </span>
      </div>
    </div>
  )
}

const getQuizCardServerId = (message: Message): string => {
  if (message.role === 'user' || typeof message.content !== 'string') return ''
  const parsed = tryParseDifyJson(message.content)
  const payloads = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  const quiz = payloads.find((payload) => (payload as any)?.type === 'quiz') as
    | DifyJsonMessage
    | undefined
  if (!quiz) return ''
  return String((quiz as any).serverQuizId || message.meta?.serverQuizId || '')
}

export const ChatLog = ({ modern = false }: { modern?: boolean }) => {
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const chatLogRef = useRef<HTMLDivElement>(null)

  // Prevent re-triggering emotions when the chat list re-renders
  const firedGradeKeysRef = useRef<Set<string>>(new Set())
  const initialMessageKeysRef = useRef<Set<string>>(new Set())

  const characterName = settingsStore((s) => s.characterName)
  const chatLogWidth = settingsStore((s) => s.chatLogWidth)
  const { viewportWidth } = useViewportLayout()
  const responsiveChatPaneWidth = getChatPaneWidth(viewportWidth, chatLogWidth)
  const messages = messageSelectors.getTextAndImageMessages(
    homeStore((s) => s.chatLog)
  )
  const quizCardServerIds = useMemo(
    () => messages.map(getQuizCardServerId),
    [messages]
  )
  const latestQuizCardIndexes = useMemo(() => {
    const indexes = new Map<string, number>()
    quizCardServerIds.forEach((serverQuizId, index) => {
      if (serverQuizId) indexes.set(serverQuizId, index)
    })
    return indexes
  }, [quizCardServerIds])

  if (initialMessageKeysRef.current.size === 0 && messages.length > 0) {
    initialMessageKeysRef.current = new Set(
      messages.map((msg, index) => msg.id ?? `${msg.role}-${index}`)
    )
  }

  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({
      behavior: 'auto',
      block: 'center',
    })
  }, [])

  useEffect(() => {
    chatScrollRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }, [messages])

  return (
    <div
      ref={chatLogRef}
      className="chat-log absolute left-2 top-3 bottom-[12.5rem] z-10 max-w-full overflow-hidden rounded-[28px] sm:left-3 sm:top-4 sm:bottom-[13rem]"
      style={{
        width: `${responsiveChatPaneWidth}px`,
      }}
    >
      <div
        className="chat-scroll h-full overflow-y-auto px-3 pt-16 pb-8 sm:px-4 sm:pt-20 sm:pb-10 md:px-5"
        tabIndex={0}
        aria-label="会話の履歴"
      >
        {modern && messages.length === 0 && (
          <div className="chat-welcome">
            <Image
              src={buildUrl('/images/icons/wanko-conversation.png')}
              alt="ワンコロ"
              width={100}
              height={100}
              unoptimized
            />
            <span className="chat-welcome-eyebrow">あなたの学習パートナー</span>
            <h2>今日は何を学びますか？</h2>
            <p>
              気になることを質問するか、教材から問題を生成しましょう。
              <br />
              わからないところは、いつでも一緒に確認できます。
            </p>
          </div>
        )}
        {messages.map((msg, i) => {
          const messageKey = msg.id ?? `${msg.role}-${i}`
          const quizCardServerId = quizCardServerIds[i]
          const collapseQuizCard = Boolean(
            quizCardServerId &&
              (latestQuizCardIndexes.get(quizCardServerId) ?? i) > i
          )
          const skipInitialLive2D =
            initialMessageKeysRef.current.has(messageKey)
          return (
            <div key={i} ref={messages.length - 1 === i ? chatScrollRef : null}>
              {typeof msg.content === 'string' ? (
                <Chat
                  messageKey={messageKey}
                  role={msg.role}
                  message={msg.content}
                  html={msg.html ?? null}
                  isHtml={msg.is_html ?? false}
                  meta={msg.meta}
                  characterName={characterName}
                  firedGradeKeysRef={firedGradeKeysRef}
                  isLast={i === messages.length - 1}
                  collapseQuizCard={collapseQuizCard}
                  skipInitialLive2D={skipInitialLive2D}
                />
              ) : (
                <>
                  <Chat
                    messageKey={messageKey}
                    role={msg.role}
                    message={msg.content ? msg.content[0].text : ''}
                    html={msg.html ?? null}
                    isHtml={msg.is_html ?? false}
                    meta={msg.meta}
                    characterName={characterName}
                    firedGradeKeysRef={firedGradeKeysRef}
                    isLast={i === messages.length - 1}
                    collapseQuizCard={collapseQuizCard}
                    skipInitialLive2D={skipInitialLive2D}
                  />
                  <ChatImage
                    role={msg.role}
                    imageUrl={msg.content ? msg.content[1].image : ''}
                    characterName={characterName}
                  />
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const Chat = ({
  messageKey,
  role,
  message,
  html,
  isHtml,
  meta,
  characterName,
  firedGradeKeysRef,
  isLast,
  collapseQuizCard,
  skipInitialLive2D,
}: {
  messageKey: string
  role: string
  message: string
  html: string | null
  isHtml: boolean
  meta?: Message['meta']
  characterName: string
  firedGradeKeysRef: React.MutableRefObject<Set<string>>
  isLast: boolean
  collapseQuizCard: boolean
  skipInitialLive2D: boolean
}) => {
  useEffect(() => {
    if (!meta?.quizEvaluationId || role === 'user') return
    return observeEvaluationDisplay(meta.quizEvaluationId)
  }, [meta?.quizEvaluationId, role])
  const displayMessage = getAssistantDisplayText({ content: message, meta })

  const shouldRenderHtml = !!html && role !== 'user'

  const parsed = useMemo(
    () => tryParseDifyJson(displayMessage),
    [displayMessage]
  )
  const shouldRenderHtmlFinal = shouldRenderHtml && !parsed
  const messageBlocks = useMemo(
    () => parseMessageBlocks(displayMessage),
    [displayMessage]
  )
  const assistantMode = getAssistantMode(
    { role, content: message, meta },
    parsed
  )
  const isQuizMessage = assistantMode === 'quiz'
  const roleText = 'text-[#24303B]'
  const containerClass =
    role === 'user'
      ? 'chat-message chat-user mx-auto ml-0 md:ml-10 lg:ml-20 my-4 pl-10'
      : 'chat-message chat-assistant my-4 mr-6 md:mr-2 lg:mr-0'
  const chatProcessing = homeStore((s) => s.chatProcessing)
  const latestGeneratedQuizMemory = homeStore(
    (s) => s.latestGeneratedQuizMemory
  )
  const handleSendChat = useMemo(() => handleSendChatFn(), [])
  const explanationLevel = meta?.quizExplanation?.level
  const isQuizAnswerMessage =
    role === 'user' &&
    isLikelyQuizAnswerMessage(displayMessage, latestGeneratedQuizMemory)
  const messageMode: AssistantMode =
    role === 'user'
      ? isQuizAnswerMessage
        ? 'quiz'
        : 'conversation'
      : assistantMode
  const roleColor =
    role === 'user'
      ? isQuizAnswerMessage
        ? 'bg-[#6C7892] text-white'
        : 'bg-[#C97E3A] text-white'
      : isQuizMessage
        ? 'bg-[#D7E4F7] text-[#24324A]'
        : 'bg-[#D7E4F7] text-[#24324A]'
  const explanationRequest =
    typeof explanationLevel === 'number'
      ? buildQuizExplanationRequest(latestGeneratedQuizMemory, explanationLevel)
      : null
  const shouldRenderExplanationPlainText = typeof explanationLevel === 'number'
  const messageBorderClass =
    messageMode === 'quiz'
      ? 'border-[1.5px] border-[#95B7F2]'
      : 'border-[1.5px] border-[#E3AE78]'
  const innerPanelClass = `chat-message-text rounded-xl ${messageBorderClass} bg-white/98 p-4`
  const assistantOuterCardClass =
    'chat-assistant-card overflow-hidden rounded-[24px] shadow-[0_8px_24px_rgba(36,48,59,0.08)]'
  const showExplanationActions =
    role !== 'user' &&
    isLast &&
    !chatProcessing &&
    typeof explanationLevel === 'number' &&
    explanationRequest
  const renderExplanationActions = () =>
    showExplanationActions ? (
      <div className="chat-followup mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            const request = buildQuestionGenerationRequest()
            void handleSendChat(request.text, request.options)
          }}
          className="rounded-full bg-[#EAF1FC] px-4 py-2 text-sm font-bold text-[#4E75C8] transition-colors hover:bg-[#DBE7F8]"
        >
          次の問題を生成
        </button>
        <button
          type="button"
          onClick={() => {
            if (!explanationRequest) return
            void handleSendChat(
              explanationRequest.text,
              explanationRequest.options
            )
          }}
          className="rounded-full bg-[#EAF1FC] px-4 py-2 text-sm font-bold text-[#5B73A7] transition-colors hover:bg-[#DBE7F8]"
        >
          {explanationRequest.buttonLabel}
        </button>
      </div>
    ) : null

  useEffect(() => {
    if (skipInitialLive2D) return
    if (!isLast) return
    if (role !== 'user') return
    resetLive2DEmotionPoint()
  }, [isLast, role, displayMessage, skipInitialLive2D])

  useEffect(() => {
    if (skipInitialLive2D) return
    if (!isLast) return
    if (role === 'user') return

    const grade = meta?.grade
    if (!grade) return

    const emotion = resolveGradeEmotion(grade)
    if (!emotion) return

    const gradeKey = `meta:${emotion}:${messageKey}`
    if (firedGradeKeysRef.current.has(gradeKey)) return
    firedGradeKeysRef.current.add(gradeKey)

    setLive2DEmotionPoint(pointForEmotion(emotion))
    applyLive2DEmotion(emotion)
    showLive2DAvatarBurst()
  }, [isLast, messageKey, meta, role, firedGradeKeysRef, skipInitialLive2D])

  useEffect(() => {
    if (skipInitialLive2D) return
    if (!isLast) return
    if (role === 'user') return
    if (meta?.grade) return

    const emotion = meta?.emotion || extractInlineEmotion(message)
    if (
      emotion !== 'happy' &&
      emotion !== 'excited' &&
      emotion !== 'bored' &&
      emotion !== 'relaxed' &&
      emotion !== 'sad' &&
      emotion !== 'sweat' &&
      emotion !== 'rage' &&
      emotion !== 'neutral' &&
      emotion !== 'frustrated1' &&
      emotion !== 'frustrated2'
    ) {
      return
    }

    const emotionKey = `meta:emotion:${emotion}:${messageKey}`
    if (firedGradeKeysRef.current.has(emotionKey)) return
    firedGradeKeysRef.current.add(emotionKey)

    if (emotion === 'happy' || emotion === 'excited') {
      const x = live2dEmotionPoint.x + 1
      const y = live2dEmotionPoint.y
      setLive2DEmotionPoint({ x, y })
      applyLive2DEmotionByPoint()
      return
    }

    applyLive2DEmotion(emotion)
  }, [
    isLast,
    messageKey,
    role,
    meta?.grade,
    meta?.emotion,
    message,
    firedGradeKeysRef,
    skipInitialLive2D,
  ])

  useEffect(() => {
    if (!isLast) return
    if (role === 'user') return
    if (!meta?.quiz?.question) return
  }, [isLast, meta?.quiz?.question, role])

  return (
    <div className={containerClass} data-mode={messageMode}>
      {role === 'code' ? (
        <pre className="whitespace-pre-wrap break-words rounded-lg border border-[#C7D7EA] bg-white p-4 text-[#24324A]">
          <code className="font-mono text-sm">{message}</code>
        </pre>
      ) : role === 'user' ? (
        <>
          <div
            className={`chat-user-label rounded-t-lg px-6 py-2 font-bold tracking-wider ${roleColor}`}
          >
            あなた
          </div>
          <div className="chat-user-body rounded-b-lg bg-white px-6 py-4">
            {shouldRenderHtmlFinal ? (
              <div className={innerPanelClass}>
                <div
                  className={`font-bold ${roleText}`}
                  dangerouslySetInnerHTML={{ __html: html ?? '' }}
                />
                {renderExplanationActions()}
              </div>
            ) : parsed ? (
              Array.isArray(parsed) ? (
                <div className="space-y-3">
                  {parsed.map((item, idx) => (
                    <DifyJsonCard
                      key={`${messageKey}|${idx}`}
                      role={role}
                      data={{
                        ...(item as any),
                        serverQuizId:
                          (item as any).serverQuizId || meta?.serverQuizId,
                      }}
                      gradeKey={`${messageKey}|${idx}`}
                      firedGradeKeysRef={firedGradeKeysRef}
                      isLast={isLast}
                      collapseQuizCard={collapseQuizCard}
                      skipInitialLive2D={skipInitialLive2D}
                    />
                  ))}
                </div>
              ) : (
                <DifyJsonCard
                  role={role}
                  data={{
                    ...(parsed as any),
                    serverQuizId:
                      (parsed as any).serverQuizId || meta?.serverQuizId,
                  }}
                  gradeKey={messageKey}
                  firedGradeKeysRef={firedGradeKeysRef}
                  isLast={isLast}
                  collapseQuizCard={collapseQuizCard}
                  skipInitialLive2D={skipInitialLive2D}
                />
              )
            ) : (
              <div className={innerPanelClass}>
                <div className={`font-bold ${roleText}`}>
                  <div className="whitespace-pre-line">{displayMessage}</div>
                </div>
                {renderExplanationActions()}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="chat-assistant-row flex items-start gap-4">
          <AssistantModeIcon mode={assistantMode} />
          <div className="min-w-0 flex-1">
            <div className={assistantOuterCardClass}>
              <div className="rounded-t-[24px]">
                <AssistantIdentity
                  mode={assistantMode}
                  characterName={characterName}
                />
              </div>
              <div className="chat-assistant-body bg-white px-6 py-4">
                {shouldRenderHtmlFinal ? (
                  <div className={innerPanelClass}>
                    <div
                      className={
                        role === 'user'
                          ? `font-bold ${roleText}`
                          : 'font-bold text-[#24303B]'
                      }
                      dangerouslySetInnerHTML={{ __html: html ?? '' }}
                    />
                    {renderExplanationActions()}
                  </div>
                ) : parsed ? (
                  Array.isArray(parsed) ? (
                    <div className="space-y-3">
                      {parsed.map((item, idx) => (
                        <DifyJsonCard
                          key={`${messageKey}|${idx}`}
                          role={role}
                          data={{
                            ...(item as any),
                            serverQuizId:
                              (item as any).serverQuizId || meta?.serverQuizId,
                          }}
                          gradeKey={`${messageKey}|${idx}`}
                          firedGradeKeysRef={firedGradeKeysRef}
                          isLast={isLast}
                          collapseQuizCard={collapseQuizCard}
                          skipInitialLive2D={skipInitialLive2D}
                        />
                      ))}
                    </div>
                  ) : (
                    <DifyJsonCard
                      role={role}
                      data={{
                        ...(parsed as any),
                        serverQuizId:
                          (parsed as any).serverQuizId || meta?.serverQuizId,
                      }}
                      gradeKey={messageKey}
                      firedGradeKeysRef={firedGradeKeysRef}
                      isLast={isLast}
                      collapseQuizCard={collapseQuizCard}
                      skipInitialLive2D={skipInitialLive2D}
                    />
                  )
                ) : (
                  <div className={innerPanelClass}>
                    <div
                      className={
                        role === 'user'
                          ? `font-bold ${roleText}`
                          : 'font-bold text-[#24303B]'
                      }
                    >
                      {role === 'user' ? (
                        <div className="whitespace-pre-line">
                          {displayMessage}
                        </div>
                      ) : shouldRenderExplanationPlainText ? (
                        <div className="whitespace-pre-line">
                          {insertSentenceLineBreaks(displayMessage)}
                        </div>
                      ) : (
                        renderMessageBlocks(messageBlocks)
                      )}
                    </div>
                    {renderExplanationActions()}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const DifyJsonCard = ({
  role,
  data,
  gradeKey,
  firedGradeKeysRef,
  isLast,
  collapseQuizCard,
  skipInitialLive2D,
}: {
  role: string
  data: DifyJsonMessage
  gradeKey: string
  firedGradeKeysRef: React.MutableRefObject<Set<string>>
  isLast: boolean
  collapseQuizCard: boolean
  skipInitialLive2D: boolean
}) => {
  const chatProcessing = homeStore((s) => s.chatProcessing)
  const chatLog = homeStore((s) => s.chatLog)
  const latestGeneratedQuizMemory = homeStore(
    (s) => s.latestGeneratedQuizMemory
  )
  const quizHistory = homeStore((s) => s.quizHistory)
  const handleSendChat = useMemo(() => handleSendChatFn(), [])
  const [reflection, setReflection] = useState('')
  const [reflectionSent, setReflectionSent] = useState(false)
  const [collapsedQuizExpanded, setCollapsedQuizExpanded] = useState(false)
  const answeredQuizCount = useMemo(
    () =>
      chatLog.filter(
        (message) => message.role === 'assistant' && !!message.meta?.grade
      ).length,
    [chatLog]
  )

  // Fire Live2D emotion once when a grade message arrives
  useEffect(() => {
    if (skipInitialLive2D) return
    // Only the latest message is allowed to trigger emotion (prevents old grade re-firing)
    if (!isLast) return

    if (!data || typeof data !== 'object') return
    if ((data as any).type !== 'grade') return

    // Only trigger from assistant-side messages
    if (role === 'user') return

    // Prevent re-trigger across re-renders/remounts
    if (firedGradeKeysRef.current.has(gradeKey)) return
    firedGradeKeysRef.current.add(gradeKey)

    const emotion = resolveGradeEmotion({
      correct: (data as any).correct,
      userIndex: (data as any).userIndex,
      emotion: (data as any).emotion,
    })
    if (!emotion) return

    setLive2DEmotionPoint(pointForEmotion(emotion))
    applyLive2DEmotion(emotion)
    showLive2DAvatarBurst()
  }, [data, gradeKey, firedGradeKeysRef, role, isLast, skipInitialLive2D])

  useEffect(() => {
    if (!isLast) return
    if (!data || typeof data !== 'object') return
    if ((data as any).type !== 'quiz') return
    if (role === 'user') return
  }, [data, isLast, role])

  const type = (data as any).type

  if (type === 'quiz') {
    const q = (data as any).question
    const choices = (data as any).choices as string[] | undefined
    const quizIndexFromData =
      (data as any).quizIndex ??
      (data as any).quizIndexNext ??
      (data as any).questionIndex ??
      (data as any).questionNo
    const totalFromData = (data as any).total ?? (data as any).totalNext
    const quizIndex =
      typeof quizIndexFromData === 'number'
        ? quizIndexFromData
        : latestGeneratedQuizMemory?.question === String(q || '').trim()
          ? latestGeneratedQuizMemory.quizIndex
          : undefined
    const total =
      typeof totalFromData === 'number'
        ? totalFromData
        : latestGeneratedQuizMemory?.question === String(q || '').trim()
          ? latestGeneratedQuizMemory.total
          : undefined
    const rawQuestion = String(q || '').trim()
    const isCollapsedQuiz = collapseQuizCard || (data as any).collapsed === true
    const isQuizReminder = (data as any).quizReminder === true

    if (isCollapsedQuiz && !collapsedQuizExpanded) {
      return (
        <button
          type="button"
          onClick={() => setCollapsedQuizExpanded(true)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#C7D7EA] bg-[#F7FAFE] px-4 py-3 text-left text-sm font-bold text-[#526682] transition-colors hover:bg-[#EEF4FC]"
          aria-expanded="false"
        >
          <span>
            {typeof quizIndex === 'number'
              ? `${quizIndex}問目の問題（説明前）`
              : '説明前の問題'}
          </span>
          <span className="text-xs text-[#2D62B5]">問題を表示</span>
        </button>
      )
    }

    let introText = ''
    let questionText = rawQuestion
    const splitByBlankLine = rawQuestion
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (splitByBlankLine.length >= 2) {
      introText = splitByBlankLine.slice(0, -1).join('\n\n')
      questionText = splitByBlankLine[splitByBlankLine.length - 1]
    } else {
      const guideMatch = rawQuestion.match(
        /(回答してください|答えてください|回答してね|答えてね|回答して下さい|答えて下さい)([。.!！]?)/u
      )
      if (guideMatch && typeof guideMatch.index === 'number') {
        const splitAt = guideMatch.index + guideMatch[0].length
        const before = rawQuestion.slice(0, splitAt).trim()
        const after = rawQuestion.slice(splitAt).trim()
        if (before && after) {
          introText = before
          questionText = after
        }
      }
    }
    const canAnswerQuiz =
      role !== 'user' &&
      isLast &&
      !chatProcessing &&
      isActiveQuizCard(questionText, choices, latestGeneratedQuizMemory)
    const currentQuizIndex =
      typeof quizIndex === 'number'
        ? quizIndex
        : canAnswerQuiz
          ? answeredQuizCount + 1
          : undefined
    const choiceList = Array.isArray(choices) ? choices.map(String) : []
    return (
      <div className="space-y-3">
        {isCollapsedQuiz ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setCollapsedQuizExpanded(false)}
              className="rounded-lg border border-[#C7D7EA] bg-white px-3 py-1.5 text-xs font-bold text-[#526682] hover:bg-[#F7FAFE]"
              aria-expanded="true"
            >
              問題を折りたたむ
            </button>
          </div>
        ) : null}
        {isQuizReminder ? (
          <div className="rounded-xl border border-[#BCD0EE] bg-[#EEF5FF] px-4 py-3 text-sm font-bold leading-6 text-[#345A98]">
            説明を参考に、同じ問題にもう一度答えてみよう。
          </div>
        ) : null}
        {introText ? (
          <div className="rounded-xl border border-[#C7D7EA] bg-white/98 p-4 font-bold whitespace-pre-line text-[#24324A]">
            {insertSentenceLineBreaks(introText)}
          </div>
        ) : null}
        <div className="chat-quiz-card space-y-3 rounded-xl border border-[#C7D7EA] bg-white/98 p-4">
          <div className="chat-question rounded-xl bg-[#F7FAFE] px-3 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-[#24324A]">
              <span className="rounded-full bg-[#5F86D9] px-2.5 py-1 text-[11px] font-bold text-white">
                問題
              </span>
              {typeof currentQuizIndex === 'number' ? (
                <span className="rounded-full bg-[#E0EAF9] px-2 py-0.5 text-[11px] font-bold text-[#5E79A8]">
                  [{currentQuizIndex}問目]
                </span>
              ) : null}
            </div>
            <div className="mt-3 font-bold whitespace-pre-line text-[#24324A]">
              {insertSentenceLineBreaks(questionText || '（問題）')}
            </div>
          </div>
          {choiceList.length > 0 ? (
            <div className="chat-choices space-y-2 rounded-xl bg-[#FAFCFF] px-3 py-3">
              <div className="text-xs font-semibold tracking-wider text-[#24324A]">
                <span className="rounded-full bg-[#7893C3] px-2.5 py-1 text-[11px] font-bold text-white">
                  選択肢
                </span>
              </div>
              <ul className="space-y-1">
                {choiceList.map((c, idx) => {
                  const label = String.fromCharCode(65 + idx)
                  return (
                    <li key={idx}>
                      <button
                        type="button"
                        disabled={!canAnswerQuiz}
                        onClick={() => {
                          void handleSendChat(label)
                        }}
                        className={`chat-choice flex w-full items-start rounded-xl px-3 py-2 text-left font-semibold transition-colors ${
                          canAnswerQuiz
                            ? 'bg-white text-[#24324A] hover:bg-[#EAF1FC]'
                            : 'cursor-default bg-transparent text-[#24324A]'
                        }`}
                      >
                        <span className="mr-2 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#E0EAF9] text-xs font-bold text-[#5E79A8]">
                          {label}
                        </span>
                        <span>{c}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!canAnswerQuiz}
                  onClick={() => {
                    void handleSendChat('答えと解説を教えてください。', {
                      quizAction: 'reveal_answer',
                    })
                  }}
                  className="rounded-lg border border-[#B9CBE8] bg-white px-3 py-2 text-xs font-bold text-[#2D62B5] hover:bg-[#F1F6FF] disabled:cursor-not-allowed disabled:bg-[#F3F5F8] disabled:text-[#9AA7BA]"
                >
                  答えを見る
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-[#FAFCFF] px-3 py-3 text-sm font-bold leading-7 text-[#4D5E77]">
              チャット欄に文章で答えてください。用語の意味や理由を、自分の言葉で説明できているかを確認します。
            </div>
          )}
          <QuizLearningSupport
            key={(data as any).serverQuizId || gradeKey}
            quizId={(data as any).serverQuizId}
            questionType={
              Array.isArray(choices) && choices.length > 0
                ? 'multiple_choice'
                : 'written'
            }
          />
        </div>
      </div>
    )
  }

  if (type === 'grade') {
    const correct = !!(data as any).correct
    const answerStatus = ((data as any).answerStatus ||
      (correct ? 'correct' : 'incorrect')) as
      | 'correct'
      | 'incorrect'
      | 'unanswered'
    const assessmentLevel = (data as any).assessmentLevel as
      | 'understood'
      | 'partial'
      | 'review'
      | undefined
    const message = (data as any).message
    const explanation = (data as any).explanation
    const correctIndex = (data as any).correctIndex
    const correctAnswer = (data as any).correctAnswer
    const userIndex = (data as any).userIndex
    const finalMessage = (data as any).finalMessage
    const learningSet = (data as any).learningSet as
      | import('@/features/stores/home').LearningSetProgress
      | undefined
    const totalFromData = (data as any).total ?? (data as any).totalNext
    const quizIndexFromData =
      (data as any).quizIndex ??
      (data as any).quizIndexNext ??
      (data as any).questionIndex ??
      (data as any).questionNo
    const gradedQuizId = String((data as any).serverQuizId || '').trim()
    const gradedAttempt = gradedQuizId
      ? quizHistory.find((item) => item.id === gradedQuizId)
      : undefined
    const quizIndex =
      typeof quizIndexFromData === 'number'
        ? quizIndexFromData
        : gradedAttempt?.quizIndex
    const total =
      typeof totalFromData === 'number' ? totalFromData : gradedAttempt?.total
    const userAnswerLabel =
      typeof userIndex === 'number' && userIndex >= 0
        ? String.fromCharCode(65 + userIndex)
        : null
    const isWrittenGrade =
      (data as any).questionType === 'written' ||
      assessmentLevel !== undefined ||
      (correctIndex == null && userIndex == null && !!correctAnswer)
    const currentExplanationLevel =
      latestGeneratedQuizMemory?.explanationLevel ?? 1
    const explanationRequest = buildQuizExplanationRequest(
      latestGeneratedQuizMemory,
      currentExplanationLevel
    )
    const showFollowUpButtons =
      isLast && !chatProcessing && (!!explanation || !!finalMessage)

    return (
      <div className="space-y-3">
        <div className="chat-quiz-card space-y-3 rounded-xl border border-[#C7D7EA] bg-white/98 p-4">
          <div className="text-xs font-semibold tracking-wider text-[#24324A]">
            判定結果
          </div>
          <div
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold ${
              answerStatus === 'unanswered'
                ? 'bg-[#EEF1F6] text-[#5F6D82]'
                : assessmentLevel === 'partial'
                  ? 'bg-[#FFF3D6] text-[#9A6500]'
                  : correct
                    ? 'bg-[#EAF2FF] text-[#2C79EE]'
                    : 'bg-[#F1F0F8] text-[#755D98]'
            }`}
          >
            {answerStatus === 'unanswered'
              ? '未回答'
              : assessmentLevel === 'understood'
                ? '理解できています'
                : assessmentLevel === 'partial'
                  ? '一部理解できています'
                  : assessmentLevel === 'review'
                    ? 'もう一度確認しよう'
                    : correct
                      ? '正解 ✅'
                      : '不正解 ❌'}
          </div>
          {typeof correctIndex === 'number' && correctIndex >= 0 ? (
            <div className="font-semibold text-[#24324A]">
              正解：{String.fromCharCode(65 + correctIndex)}
            </div>
          ) : correctAnswer ? (
            <div className="font-semibold whitespace-pre-line text-[#24324A]">
              模範解答：{insertSentenceLineBreaks(String(correctAnswer))}
            </div>
          ) : null}
          {answerStatus === 'unanswered' || (!correct && userAnswerLabel) ? (
            <div className="font-semibold text-[#24324A]">
              {isWrittenGrade ? 'あなたの回答' : 'あなたの選択肢'}：
              {answerStatus === 'unanswered' ? 'ー' : userAnswerLabel}
            </div>
          ) : null}
          {typeof quizIndex === 'number' ? (
            <div className="font-semibold text-[#24324A]">{quizIndex}問目</div>
          ) : null}
          {message ? (
            <div className="font-bold whitespace-pre-line text-[#24324A]">
              {insertSentenceLineBreaks(String(message))}
            </div>
          ) : null}
          {explanation ? (
            <div className="whitespace-pre-line text-[#24324A]">
              <span className="font-bold">解説：</span>
              {insertSentenceLineBreaks(String(explanation))}
            </div>
          ) : null}
          {answerStatus === 'incorrect' ? (
            <div className="rounded-xl bg-[#F7F4FC] px-3 py-3 text-sm text-[#5F5275]">
              <div className="font-semibold leading-6">
                解説を読んで、理解できたところを書いてみよう。
              </div>
              {reflectionSent ? (
                <div className="mt-2 font-semibold text-[#4F7A63]">
                  送信しました。気になったところがあれば、続けて聞いてみよう。
                </div>
              ) : (
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <textarea
                    value={reflection}
                    onChange={(event) => setReflection(event.target.value)}
                    placeholder="例：ヒープ領域にはデータが置かれることがわかった"
                    rows={2}
                    disabled={chatProcessing}
                    className="min-h-[68px] flex-1 resize-y rounded-lg border border-[#D8CDEA] bg-white px-3 py-2 text-sm font-medium text-[#24324A] outline-none placeholder:text-[#9489A7] focus:border-[#A78CCD] disabled:cursor-not-allowed disabled:bg-[#F2EFF6]"
                  />
                  <button
                    type="button"
                    disabled={!reflection.trim() || chatProcessing}
                    onClick={() => {
                      const text = reflection.trim()
                      if (!text) return
                      setReflectionSent(true)
                      setReflection('')
                      void handleSendChat(`解説を読んで理解できたこと：${text}`)
                    }}
                    className="self-end rounded-lg bg-[#76569D] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#664985] disabled:cursor-not-allowed disabled:bg-[#CFC4DD] sm:self-stretch"
                  >
                    送信する
                  </button>
                </div>
              )}
            </div>
          ) : null}
          {learningSet?.feedbackUpdated && learningSet.feedback ? (
            <div className="rounded-xl border border-[#CFE2D8] bg-[#F5FBF7] px-3 py-3 text-sm leading-6 text-[#355548]">
              <div className="font-bold text-[#22613B]">
                {learningSet.feedback.checkpointAnswered || 10}
                問回答時点のフィードバック
              </div>
              {learningSet.feedback.llmMessage ? (
                <div className="mt-2 rounded-lg border border-[#D8E9DE] bg-white px-3 py-2">
                  {learningSet.feedback.llmMessage}
                </div>
              ) : null}
              <div className="mt-1 text-xs text-[#5C806B]">
                {learningSet.feedback.message}
              </div>
            </div>
          ) : null}
          <QuizLearningSupport
            key={(data as any).serverQuizId || gradeKey}
            quizId={(data as any).serverQuizId}
            graded
            incorrect={answerStatus === 'incorrect'}
            autoExplain={isLast && !skipInitialLive2D}
            userLabel={userAnswerLabel || undefined}
            questionType={isWrittenGrade ? 'written' : 'multiple_choice'}
          />
          {showFollowUpButtons ? (
            <div className="chat-followup flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  const request = buildQuestionGenerationRequest()
                  void handleSendChat(request.text, request.options)
                }}
                className="rounded-full bg-[#EAF1FC] px-4 py-2 text-sm font-bold text-[#4E75C8] transition-colors hover:bg-[#DBE7F8]"
              >
                次の問題を生成
              </button>
              {!(data as any).serverQuizId && (
                <button
                  type="button"
                  onClick={() => {
                    void handleSendChat(
                      explanationRequest.text,
                      explanationRequest.options
                    )
                  }}
                  className="rounded-full bg-[#EAF1FC] px-4 py-2 text-sm font-bold text-[#5B73A7] transition-colors hover:bg-[#DBE7F8]"
                >
                  {explanationRequest.buttonLabel}
                </button>
              )}
            </div>
          ) : null}
        </div>
        {finalMessage ? (
          <div className="rounded-xl border border-[#C7D7EA] bg-white/98 p-4 font-bold whitespace-pre-line text-[#24324A]">
            {insertSentenceLineBreaks(String(finalMessage))}
          </div>
        ) : null}
      </div>
    )
  }

  // Fallback: show pretty JSON
  return (
    <pre className="whitespace-pre-wrap break-words text-black text-sm">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

const ChatImage = ({
  role,
  imageUrl,
  characterName,
}: {
  role: string
  imageUrl: string
  characterName: string
}) => {
  const containerClass =
    role === 'user'
      ? 'mx-auto ml-0 md:ml-10 lg:ml-20 my-4 pl-40'
      : 'my-4 mr-20 md:mr-8 lg:mr-4'

  return (
    <div className={containerClass}>
      <Image
        src={imageUrl}
        alt="Generated Image"
        className="rounded-lg"
        width={512}
        height={512}
      />
    </div>
  )
}
