import type {
  QuizSource,
  QuizExplanationResponse,
} from '@/features/messages/quizLearning'
import type { UnderstandSkill } from '@/features/questionPool/types'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { withBasePath } from '@/utils/basePath'

import { Message } from '@/features/messages/messages'
import { Viewer } from '../vrmViewer/viewer'
import { messageSelectors } from '../messages/messageSelectors'
import { Live2DModel } from 'pixi-live2d-display-lipsyncpatch'
import { generateMessageId } from '@/utils/messageUtils'

export type WrittenAssessmentLevel = 'understood' | 'partial' | 'review'

export type GeneratedQuizMemory = {
  sources?: QuizSource[]
  learningSupport?: Partial<Record<string, QuizExplanationResponse>>
  rawText: string
  serverQuizId?: string
  questionPoolId?: string
  learningSessionId?: string
  lessonId?: string
  questionType?: 'multiple_choice' | 'written'
  understandSkill?: UnderstandSkill
  question?: string
  choices?: string[]
  quizIndex?: number
  total?: number
  difficultyLevel?: number
  questionGroup?: string
  sourceDatasetId?: string
  sourceDatasetName?: string
  answerIndex?: number
  answer?: string
  explanation?: string
  explanationLevel?: number
  awaitingAnswer?: boolean
  lastUserAnswer?: string
  lastUserAnswerIndex?: number | null
  lastIsCorrect?: boolean | null
  updatedAt: string
}

export type QuizHistoryItem = {
  id: string
  questionPoolId?: string
  learningSessionId?: string
  questionType?: 'multiple_choice' | 'written'
  understandSkill?: UnderstandSkill
  question: string
  choices?: string[]
  quizIndex?: number
  total?: number
  difficultyLevel?: number
  questionGroup?: string
  correctIndex?: number
  correctAnswer?: string
  userAnswer: string
  userIndex?: number | null
  correct: boolean
  assessmentLevel?: WrittenAssessmentLevel
  score?: number
  responseTimeMs?: number
  explanation?: string
  aiOutput?: string
  answeredAt: string
}

export type LearningFeedbackItem = {
  skill: UnderstandSkill
  label: string
  answered: number
  correct: number
  partial?: number
  status: 'achieved' | 'review' | 'not_attempted'
  trend: 'improved' | 'stable' | 'declined' | 'new'
  message: string
}

export type LearningGenreFeedbackItem = {
  key: string
  label: string
  answered: number
  correct: number
  partial?: number
  status: 'achieved' | 'review'
  trend: 'improved' | 'stable' | 'declined' | 'new'
  message: string
}

export type LearningSetFeedback = {
  memory: {
    answered: number
    correct: number
    partial?: number
    trend: 'improved' | 'stable' | 'declined' | 'new'
    message: string
  }
  genres: LearningGenreFeedbackItem[]
  understanding: LearningFeedbackItem[]
  checkpointAnswered: number
  periodAnswered: number
  comprehensive: boolean
  llmMessage?: string
  message: string
}

export type LearningSetProgress = {
  sessionId: string
  total: number
  issued: number
  answered: number
  cumulativeAnswered: number
  completed: boolean
  feedbackUpdated: boolean
  feedback?: LearningSetFeedback
}

export type LearningActivitySummary = {
  totalActiveMs: number
  materialActiveMs: number
  avatarActiveMs: number
  quizActiveMs: number
  conversationActiveMs: number
  lastMaterialPage: number | null
}

export type QuestionPoolItem = {
  id: string
  lessonId?: string
  questionNumber?: number
  serverQuizId?: string
  learningSessionId?: string
  questionType: 'multiple_choice' | 'written'
  bloomLevel?: 'remember' | 'understand'
  understandSkill?: UnderstandSkill
  question: string
  quizIndex?: number
  total?: number
  choices?: string[]
  correctIndex?: number
  correctAnswer?: string
  wrongAnswers?: string[]
  explanation?: string
  difficultyLevel: number
  questionGroup: string
  topic?: string
  sourceDatasetId?: string
  sourceDatasetName?: string
  sourceDocumentId?: string
  sourceDocumentName?: string
  sourceSegmentIds?: string[]
  sourceContext?: string
  variantFamilyId?: string
  variantIndex?: number
}

export interface PersistedState {
  userOnboarded: boolean
  chatLog: Message[]
  latestGeneratedQuizMemory: GeneratedQuizMemory | null
  quizHistory: QuizHistoryItem[]
  learningSetProgress: LearningSetProgress | null
  showIntroduction: boolean
}

export interface TransientState {
  selectedLessonId?: string
  learningActivitySummary: LearningActivitySummary | null
  activeLessonQuestionCount: number | null
  activeLessonMasteredQuestionIds: string[]

  viewer: Viewer
  live2dViewer: any
  slideMessages: string[]
  chatProcessing: boolean
  chatProcessingCount: number
  incrementChatProcessingCount: () => void
  decrementChatProcessingCount: () => void
  upsertMessage: (message: Partial<Message>) => void
  backgroundImageUrl: string
  modalImage: string
  triggerShutter: boolean
  webcamStatus: boolean
  captureStatus: boolean
  isCubismCoreLoaded: boolean
  setIsCubismCoreLoaded: (loaded: boolean) => void
  isLive2dLoaded: boolean
  setIsLive2dLoaded: (loaded: boolean) => void
  isSpeaking: boolean
  appendQuizHistory: (item: QuizHistoryItem, savedOnServer?: boolean) => void
  clearQuizHistory: () => void
}

export type HomeState = PersistedState & TransientState

// 更新の一時的なバッファリングを行うための変数
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null
const SAVE_DEBOUNCE_DELAY = 2000 // 2秒
let lastSavedLogLength = 0 // 最後に保存したログの長さを記録
// 履歴削除後に次回保存で新規ファイルを作成するかどうかを示すフラグ
let shouldCreateNewFile = false
let isRestoringServerState = false

// ログ保存状態をリセットする共通関数
const resetSaveState = () => {
  console.log('Chat log was cleared, resetting save state.')
  lastSavedLogLength = 0
  shouldCreateNewFile = true
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer)
  }
}

const homeStore = create<HomeState>()(
  persist(
    (set, get) => ({
      // persisted states
      userOnboarded: false,
      chatLog: [],
      latestGeneratedQuizMemory: null,
      quizHistory: [],
      learningSetProgress: null,
      showIntroduction: process.env.NEXT_PUBLIC_SHOW_INTRODUCTION === 'true',

      // transient states
      selectedLessonId: undefined,
      learningActivitySummary: null,
      activeLessonQuestionCount: null,
      activeLessonMasteredQuestionIds: [],
      viewer: new Viewer(),
      live2dViewer: null,
      slideMessages: [],
      chatProcessing: false,
      chatProcessingCount: 0,
      incrementChatProcessingCount: () => {
        set(({ chatProcessingCount }) => ({
          chatProcessingCount: chatProcessingCount + 1,
        }))
      },
      decrementChatProcessingCount: () => {
        set(({ chatProcessingCount }) => ({
          chatProcessingCount: chatProcessingCount - 1,
        }))
      },
      upsertMessage: (message) => {
        set((state) => {
          const currentChatLog = state.chatLog
          const messageId = message.id ?? generateMessageId()
          const existingMessageIndex = currentChatLog.findIndex(
            (msg) => msg.id === messageId
          )

          let updatedChatLog: Message[]

          if (existingMessageIndex > -1) {
            updatedChatLog = [...currentChatLog]
            const existingMessage = updatedChatLog[existingMessageIndex]

            updatedChatLog[existingMessageIndex] = {
              ...existingMessage,
              ...message,
              id: messageId,
            }
            console.log(`Message updated: ID=${messageId}`)
          } else {
            if (!message.role || message.content === undefined) {
              console.error(
                'Cannot add message without role or content',
                message
              )
              return { chatLog: currentChatLog }
            }
            const newMessage: Message = {
              id: messageId,
              role: message.role,
              content: message.content,
              ...(message.html !== undefined && { html: message.html }),
              ...(message.is_html !== undefined && {
                is_html: message.is_html,
              }),
              ...(message.meta !== undefined && { meta: message.meta }),
              ...(message.audio && { audio: message.audio }),
              ...(message.timestamp && { timestamp: message.timestamp }),
            }
            updatedChatLog = [...currentChatLog, newMessage]
            console.log(`Message added: ID=${messageId}`)
          }

          return { chatLog: updatedChatLog }
        })
      },
      backgroundImageUrl:
        process.env.NEXT_PUBLIC_BACKGROUND_IMAGE_PATH ?? 'white',
      modalImage: '',
      triggerShutter: false,
      webcamStatus: false,
      captureStatus: false,
      isCubismCoreLoaded: false,
      setIsCubismCoreLoaded: (loaded) =>
        set(() => ({ isCubismCoreLoaded: loaded })),
      isLive2dLoaded: false,
      setIsLive2dLoaded: (loaded) => set(() => ({ isLive2dLoaded: loaded })),
      isSpeaking: false,
      appendQuizHistory: (item, savedOnServer = false) => {
        if (!savedOnServer)
          void fetch(withBasePath('/api/save-quiz-attempt/'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify(item),
          }).catch((error) => {
            console.error('回答履歴の保存中にエラーが発生しました:', error)
          })
        set((state) => ({
          quizHistory: state.quizHistory.some(
            (previous) => previous.id === item.id
          )
            ? state.quizHistory
            : [...state.quizHistory, item],
        }))
      },
      clearQuizHistory: () => set(() => ({ quizHistory: [] })),
    }),
    {
      name: 'aitube-kit-home',
      partialize: ({ userOnboarded, showIntroduction }) => ({
        userOnboarded,
        showIntroduction,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (process.env.NEXT_PUBLIC_SHOW_INTRODUCTION !== 'true') {
            state.showIntroduction = false
          }
        }
        lastSavedLogLength = 0
      },
    }
  )
)

// chatLogの変更を監視して差分を保存
homeStore.subscribe((state, prevState) => {
  if (isRestoringServerState) {
    return
  }

  if (state.chatLog !== prevState.chatLog && state.chatLog.length > 0) {
    if (lastSavedLogLength > state.chatLog.length) {
      resetSaveState()
    }

    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer)
    }

    saveDebounceTimer = setTimeout(() => {
      // 新規追加 or 更新があったメッセージだけを抽出
      const newMessagesToSave = state.chatLog.filter(
        (msg, idx) =>
          idx >= lastSavedLogLength || // 追加分
          prevState.chatLog.find((p) => p.id === msg.id)?.content !==
            msg.content // 更新分
      )

      if (newMessagesToSave.length > 0) {
        const processedMessages = newMessagesToSave.map((msg) =>
          messageSelectors.sanitizeMessageForStorage(msg)
        )

        console.log(`Saving ${processedMessages.length} new messages...`)

        void fetch(withBasePath('/api/save-chat-log/'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            messages: processedMessages,
            lessonId: state.selectedLessonId,
            isNewFile: shouldCreateNewFile,
          }),
        })
          .then((response) => {
            if (response.ok) {
              lastSavedLogLength = state.chatLog.length
              // 新規ファイルが作成された場合はフラグをリセット
              shouldCreateNewFile = false
              console.log(
                'Messages saved successfully. New saved length:',
                lastSavedLogLength
              )
            } else {
              console.error('Failed to save chat log:', response.statusText)
            }
          })
          .catch((error) => {
            console.error('チャットログの保存中にエラーが発生しました:', error)
          })
      } else {
        console.log('No new messages to save.')
      }
    }, SAVE_DEBOUNCE_DELAY)
  } else if (
    state.chatLog !== prevState.chatLog &&
    state.chatLog.length === 0
  ) {
    resetSaveState()
    if (
      state.latestGeneratedQuizMemory !== null ||
      state.quizHistory.length > 0
    ) {
      homeStore.setState({ latestGeneratedQuizMemory: null, quizHistory: [] })
    }
  }
})

export const restoreServerHomeState = (state: {
  chatLog?: Message[]
  latestGeneratedQuizMemory?: GeneratedQuizMemory | null
  quizHistory?: QuizHistoryItem[]
  learningSetProgress?: LearningSetProgress | null
}) => {
  isRestoringServerState = true
  homeStore.setState({
    ...(state.chatLog ? { chatLog: state.chatLog } : {}),
    ...(state.latestGeneratedQuizMemory !== undefined
      ? { latestGeneratedQuizMemory: state.latestGeneratedQuizMemory }
      : {}),
    ...(state.quizHistory ? { quizHistory: state.quizHistory } : {}),
    ...(state.learningSetProgress !== undefined
      ? { learningSetProgress: state.learningSetProgress }
      : {}),
  })
  lastSavedLogLength = state.chatLog?.length || 0
  shouldCreateNewFile = false
  isRestoringServerState = false
}

export default homeStore
