import {
  handleSendChatFn,
  processAIResponse,
} from '../../../features/chat/handlers'
import { getAIChatResponseStream } from '../../../features/chat/aiChatFactory'
import { speakCharacter } from '../../../features/messages/speakCharacter'
import homeStore from '../../../features/stores/home'
import settingsStore from '../../../features/stores/settings'
import slideStore from '../../../features/stores/slide'
import webSocketStore from '../../../features/stores/websocketStore'
import toastStore from '../../../features/stores/toast'
import i18next from 'i18next'
import { Message } from '../../../features/messages/messages'
import {
  revealQuizAnswer,
  submitQuizAnswer,
} from '../../../../app/lib/api/client'
import { getDifyChatResponse } from '@/features/chat/difyChat'

jest.mock('@/features/chat/difyChat', () => ({
  getDifyChatResponse: jest.fn(),
  syncDifyConversationVariables: jest.fn(),
}))

jest.mock('../../../../app/lib/api/client', () => ({
  revealQuizAnswer: jest.fn(),
  submitQuizAnswer: jest.fn(),
}))

jest.mock('../../../features/chat/aiChatFactory', () => ({
  getAIChatResponseStream: jest.fn(),
}))

jest.mock('../../../features/messages/speakCharacter', () => ({
  speakCharacter: jest.fn(),
}))

jest.mock('../../../features/stores/home', () => ({
  getState: jest.fn(),
  setState: jest.fn(),
  upsertMessage: jest.fn(),
}))

jest.mock('../../../features/stores/settings', () => ({
  getState: jest.fn(),
}))

jest.mock('../../../features/stores/slide', () => ({
  getState: jest.fn(),
}))

jest.mock('../../../features/stores/websocketStore', () => ({
  getState: jest.fn(),
}))

jest.mock('../../../features/stores/toast', () => ({
  getState: jest.fn(),
}))

jest.mock('i18next', () => ({
  t: jest.fn((key) => key),
}))

describe('handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('handleSendChatFn', () => {
    it('メッセージが空の場合は処理を行わない', async () => {
      const handleSendChat = handleSendChatFn()
      await handleSendChat(null as unknown as string)

      expect(homeStore.setState).not.toHaveBeenCalled()
    })

    it('externalLinkageModeがtrueの場合、WebSocketを使用してメッセージを送信する', async () => {
      const mockWebSocket = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
      }
      const mockWsManager = {
        websocket: mockWebSocket,
      }
      ;(webSocketStore.getState as jest.Mock).mockReturnValue({
        wsManager: mockWsManager,
      })
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        externalLinkageMode: true,
      })
      ;(homeStore.getState as jest.Mock).mockReturnValue({
        chatLog: [],
        upsertMessage: jest.fn(),
      })

      const handleSendChat = handleSendChatFn()
      await handleSendChat('テストメッセージ')

      expect(homeStore.setState).toHaveBeenCalledWith({ chatProcessing: true })
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ content: 'テストメッセージ', type: 'chat' })
      )
      expect((homeStore.getState() as any).upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'user',
          content: 'テストメッセージ',
        })
      )
    })

    it('externalLinkageModeがtrueだがWebSocketが接続されていない場合、エラーを表示する', async () => {
      const mockAddToast = jest.fn()
      const mockWebSocket = {
        readyState: WebSocket.CLOSED,
      }
      const mockWsManager = {
        websocket: mockWebSocket,
      }
      ;(webSocketStore.getState as jest.Mock).mockReturnValue({
        wsManager: mockWsManager,
      })
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        externalLinkageMode: true,
      })
      ;(toastStore.getState as jest.Mock).mockReturnValue({
        addToast: mockAddToast,
      })

      const handleSendChat = handleSendChatFn()
      await handleSendChat('テストメッセージ')

      expect(homeStore.setState).toHaveBeenCalledWith({ chatProcessing: true })
      expect(mockAddToast).toHaveBeenCalledWith({
        message: 'NotConnectedToExternalAssistant',
        type: 'error',
        tag: 'not-connected-to-external-assistant',
      })
      expect(homeStore.setState).toHaveBeenCalledWith({
        chatProcessing: false,
      })
    })

    it('通常モードの場合、AIチャットレスポンスを処理する', async () => {
      const mockChatLog: Message[] = []
      const mockReader = {
        read: jest
          .fn()
          .mockResolvedValueOnce({ value: 'テスト応答', done: false })
          .mockResolvedValueOnce({ value: undefined, done: true }),
        releaseLock: jest.fn(),
      }
      const mockStream = {
        getReader: jest.fn().mockReturnValue(mockReader),
      } as unknown as ReadableStream<string>
      ;(getAIChatResponseStream as jest.Mock).mockResolvedValue(mockStream)
      const mockHomeStore = {
        chatLog: mockChatLog,
        chatProcessing: false,
        modalImage: '',
        setState: jest.fn(),
        upsertMessage: jest.fn((newMessage: Message) => {
          const existingIndex = mockChatLog.findIndex(
            (msg) =>
              msg.audio?.id === newMessage.audio?.id &&
              newMessage.audio?.id !== undefined
          )
          if (existingIndex !== -1) {
            mockChatLog[existingIndex] = {
              ...mockChatLog[existingIndex],
              ...newMessage,
            }
          } else {
            mockChatLog.push({ content: '', ...newMessage })
          }
        }),
      }
      ;(homeStore.getState as jest.Mock).mockReturnValue(mockHomeStore)
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        externalLinkageMode: false,
        realtimeAPIMode: false,
        slideMode: false,
        systemPrompt: 'テストプロンプト',
        includeTimestampInUserMessage: false,
      })

      const handleSendChat = handleSendChatFn()
      await handleSendChat('テストメッセージ')

      expect(homeStore.setState).toHaveBeenCalledWith({ chatProcessing: true })
      expect(mockHomeStore.upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'user',
          content: 'テストメッセージ',
        })
      )
      expect(getAIChatResponseStream).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: 'テストプロンプト',
          }),
        ])
      )
    })
  })

  describe('processAIResponse', () => {
    it('AIレスポンスストリームがnullの場合、処理を終了する', async () => {
      ;(getAIChatResponseStream as jest.Mock).mockResolvedValue(null)

      await processAIResponse([])

      expect(homeStore.setState).toHaveBeenCalledWith({ chatProcessing: false })
      expect(speakCharacter).not.toHaveBeenCalled()
    })
  })

  describe('server grading', () => {
    let state: any
    const addToast = jest.fn()
    beforeEach(() => {
      state = {
        chatLog: [],
        modalImage: '',
        chatProcessing: false,
        upsertMessage: jest.fn(),
        appendQuizHistory: jest.fn(),
        latestGeneratedQuizMemory: {
          serverQuizId: 'issued-id',
          question: 'どれ？',
          rawText: 'どれ？',
          choices: ['a', 'b', 'c', 'd'],
          awaitingAnswer: true,
          // Deliberately wrong browser data: the server response must take precedence.
          answerIndex: 0,
          updatedAt: new Date().toISOString(),
        },
      }
      ;(homeStore.getState as jest.Mock).mockImplementation(() => state)
      ;(homeStore.setState as jest.Mock).mockImplementation((patch) =>
        Object.assign(state, patch)
      )
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        externalLinkageMode: false,
        slideMode: false,
        systemPrompt: '',
      })
      ;(slideStore.getState as jest.Mock).mockReturnValue({})
      ;(webSocketStore.getState as jest.Mock).mockReturnValue({ wsManager: {} })
      ;(toastStore.getState as jest.Mock).mockReturnValue({ addToast })
    })

    it('uses the server verdict and already-persisted history, not the browser correct index', async () => {
      const attempt = {
        id: 'issued-id',
        choices: ['a', 'b', 'c', 'd'],
        correct: false,
      }
      ;(submitQuizAnswer as jest.Mock).mockResolvedValue({
        grade: {
          type: 'grade',
          correct: false,
          correctIndex: 1,
          userIndex: 0,
          emotion: 'sweat',
          explanation: 'SERVER_EXPLANATION',
          message: '',
          correctAnswer: 'B. b',
          userAnswer: 'A',
        },
        attempt,
      })
      await handleSendChatFn()('A')
      expect(submitQuizAnswer).toHaveBeenCalledWith('issued-id', 0, 'A')
      expect(state.latestGeneratedQuizMemory).toMatchObject({
        awaitingAnswer: false,
        lastIsCorrect: false,
        answerIndex: 1,
        explanation: 'SERVER_EXPLANATION',
      })
      expect(state.appendQuizHistory).toHaveBeenCalledWith(attempt, true)
      expect(state.chatProcessing).toBe(false)
    })

    it('answers a question about an option and then redisplays the same quiz', async () => {
      ;(getDifyChatResponse as jest.Mock).mockResolvedValue({
        text: 'aについての説明です。',
        segments: [
          {
            text: 'aについての説明です。',
            html: null,
            is_html: false,
          },
        ],
      })

      await handleSendChatFn()('aについて教えて')

      expect(submitQuizAnswer).not.toHaveBeenCalled()
      expect(getDifyChatResponse).toHaveBeenCalled()
      expect(state.latestGeneratedQuizMemory).toMatchObject({
        serverQuizId: 'issued-id',
        awaitingAnswer: true,
      })
      const reminderCall = state.upsertMessage.mock.calls.find(
        ([message]: any[]) => {
          if (message.role !== 'assistant') return false
          try {
            return JSON.parse(message.content).quizReminder === true
          } catch {
            return false
          }
        }
      )
      const reminderMessage = reminderCall?.[0]
      expect(reminderMessage).toMatchObject({
        role: 'assistant',
        meta: expect.objectContaining({ serverQuizId: 'issued-id' }),
      })
      expect(JSON.parse(String(reminderMessage?.content))).toMatchObject({
        type: 'quiz',
        serverQuizId: 'issued-id',
        question: 'どれ？',
        choices: ['a', 'b', 'c', 'd'],
        quizReminder: true,
      })
    })

    it('answers a slide-location question from the issued quiz without grading it', async () => {
      state.latestGeneratedQuizMemory.lessonId = 'computer-systems-2-04'
      state.latestGeneratedQuizMemory.sourceSlideNumbers = [13]

      await handleSendChatFn()('先ほどの問題は何スライド目を見ればいい？')

      expect(submitQuizAnswer).not.toHaveBeenCalled()
      expect(getDifyChatResponse).not.toHaveBeenCalled()
      expect(state.upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          content: 'この問題は第4回の13枚目のスライドを参照しています。',
        })
      )
      expect(state.latestGeneratedQuizMemory.awaitingAnswer).toBe(true)
    })

    it('adds a revealed unanswered quiz to history and review candidates', async () => {
      const attempt = {
        id: 'issued-id',
        question: 'どれ？',
        choices: ['a', 'b', 'c', 'd'],
        correct: false,
        answerStatus: 'unanswered',
        userAnswer: 'ー',
      }
      ;(revealQuizAnswer as jest.Mock).mockResolvedValue({
        grade: {
          type: 'grade',
          answerStatus: 'unanswered',
          correct: false,
          correctIndex: 1,
          userIndex: null,
          userAnswer: 'ー',
          emotion: 'neutral',
          message: '',
          explanation: 'SERVER_EXPLANATION',
          correctAnswer: 'B. b',
        },
        attempt,
      })

      await handleSendChatFn()('答えと解説を教えてください。', {
        quizAction: 'reveal_answer',
      })

      expect(revealQuizAnswer).toHaveBeenCalledWith('issued-id')
      expect(submitQuizAnswer).not.toHaveBeenCalled()
      expect(state.appendQuizHistory).toHaveBeenCalledWith(attempt, true)
      expect(state.latestGeneratedQuizMemory).toMatchObject({
        awaitingAnswer: false,
        lastUserAnswer: 'ー',
        lastUserAnswerIndex: null,
        lastIsCorrect: null,
        answerIndex: 1,
        explanation: 'SERVER_EXPLANATION',
      })
      expect(state.upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'user',
          content: '答えと解説を教えてください。',
        })
      )
      expect(state.upsertMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'assistant',
          meta: expect.objectContaining({
            grade: expect.objectContaining({ answerStatus: 'unanswered' }),
          }),
        })
      )
      expect(state.chatProcessing).toBe(false)
    })

    it('routes the first lesson question to Dify with fresh browser settings', async () => {
      state.selectedLessonId = 'computer-systems-2-03'
      state.latestGeneratedQuizMemory = null
      ;(settingsStore.getState as jest.Mock).mockReturnValue({
        selectAIService: 'openai',
        difyConversationId: '',
      })
      ;(getDifyChatResponse as jest.Mock).mockResolvedValue({
        text: '',
        segments: [],
      })
      const messages: Message[] = [
        { role: 'user', content: 'プロセスとは何ですか？' },
      ]

      await processAIResponse(messages)

      expect(getDifyChatResponse).toHaveBeenCalledWith(
        messages,
        '',
        expect.any(String),
        '',
        undefined
      )
      expect(getAIChatResponseStream).not.toHaveBeenCalled()
      expect(state.chatProcessing).toBe(false)
    })

    it('preserves the pending question and does not append history on network failure', async () => {
      ;(submitQuizAnswer as jest.Mock).mockRejectedValue(
        new Error('network failure')
      )
      await handleSendChatFn()('A')
      expect(state.latestGeneratedQuizMemory.awaitingAnswer).toBe(true)
      expect(state.appendQuizHistory).not.toHaveBeenCalled()
      expect(state.chatProcessing).toBe(false)
      expect(addToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' })
      )
    })

    it('does not locally grade an old question without a server-issued ID', async () => {
      delete state.latestGeneratedQuizMemory.serverQuizId
      await handleSendChatFn()('A')
      expect(submitQuizAnswer).not.toHaveBeenCalled()
      expect(state.appendQuizHistory).not.toHaveBeenCalled()
      expect(state.latestGeneratedQuizMemory.awaitingAnswer).toBe(true)
      expect(state.chatProcessing).toBe(false)
    })

    it('can replace an unanswered old question with a new server-issued question', async () => {
      delete state.latestGeneratedQuizMemory.serverQuizId
      const memory = {
        ...state.latestGeneratedQuizMemory,
        serverQuizId: 'new-id',
        answerIndex: undefined,
      }
      ;(getDifyChatResponse as jest.Mock).mockResolvedValue({
        text: '【問題】どれ？',
        html: null,
        is_html: false,
        quizMemory: memory,
      })
      await handleSendChatFn()('問題を1問生成してください。', {
        dify: { mode: 'generate_question' },
      })
      expect(submitQuizAnswer).not.toHaveBeenCalled()
      expect(getDifyChatResponse).toHaveBeenCalled()
      expect(state.latestGeneratedQuizMemory.serverQuizId).toBe('new-id')
    })
  })
})
