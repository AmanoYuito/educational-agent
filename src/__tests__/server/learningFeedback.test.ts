/** @jest-environment node */
import type { LearningSetProgress } from '@/features/stores/home'
import { query } from '@/lib/server/db'
import { generateLearningFeedback } from '@/lib/server/learningFeedback'

jest.mock('@/lib/server/db', () => ({ query: jest.fn() }))

const queryMock = query as jest.MockedFunction<typeof query>
const fetchMock = jest.fn()

const progress: LearningSetProgress = {
  sessionId: 'session-1',
  total: 10,
  issued: 5,
  answered: 5,
  cumulativeAnswered: 15,
  completed: false,
  feedbackUpdated: true,
  feedback: {
    checkpointAnswered: 15,
    periodAnswered: 5,
    comprehensive: false,
    message: '直近5問の変化です。',
    memory: {
      answered: 4,
      correct: 3,
      trend: 'improved',
      message: '正答率が上がっています。',
    },
    genres: [
      {
        key: 'cpu_scheduling',
        label: 'CPUスケジューリング',
        answered: 3,
        correct: 2,
        status: 'review',
        trend: 'improved',
        message: '前回までより正答率が上がっています。',
      },
    ],
    understanding: [],
  },
}

describe('LLM learning feedback', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.DIFY_KEY = 'test-key'
    process.env.DIFY_URL = 'https://api.dify.test/v1'
    global.fetch = fetchMock as any
  })

  it('sends the trusted checkpoint evidence to Dify and stores its response', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ lesson_id: 'computer-systems-2-03' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: Array.from({ length: 15 }, (_, index) => ({
          question: `問題${index + 1}`,
          question_type: index % 4 === 3 ? 'written' : 'multiple_choice',
          understand_skill: index % 4 === 3 ? 'compare' : null,
          question_group: 'cpu_scheduling',
          correct_answer: '正答',
          user_answer: index >= 10 ? '今回の回答' : '以前の回答',
          is_correct: index >= 10,
          explanation: '教材に基づく解説',
        })),
        rowCount: 15,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        answer:
          'CPUスケジューリングは前回より正答が増えています。次の5問でも比較する問題を確かめてみよう。',
      }),
    })

    const result = await generateLearningFeedback(
      'user-1',
      'session-1',
      progress
    )

    expect(result?.feedback?.llmMessage).toContain(
      'CPUスケジューリングは前回より正答が増えています。'
    )
    const request = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(request.inputs.mode).toBe('learning_feedback')
    const evidence = JSON.parse(request.inputs.learning_feedback_json)
    expect(evidence.recentAttempts).toHaveLength(5)
    expect(evidence.recentAttempts[0].number).toBe(11)
    expect(evidence.aggregate.genres).toBeUndefined()
    expect(request.query).toContain('<learning_feedback_data>')
    expect(request.query).toContain('問題11')
    expect(request.query).toContain('今回の回答')
    expect(request.query).toContain('正答')
    expect(queryMock).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO learning_feedbacks'),
      expect.arrayContaining(['user-1', 'computer-systems-2-03', 15])
    )
  })

  it('does not call Dify between feedback checkpoints', async () => {
    const result = await generateLearningFeedback('user-1', 'session-1', {
      ...progress,
      feedbackUpdated: false,
    })

    expect(result).toMatchObject({ feedbackUpdated: false })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('shows specific missed content when Dify is temporarily unavailable', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ lesson_id: 'computer-systems-2-03' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: Array.from({ length: 15 }, (_, index) => ({
          question:
            index === 14
              ? 'ラウンドロビン方式でタイムスライスを短くした場合、何が起こりますか。'
              : `問題${index + 1}`,
          question_type: 'multiple_choice',
          understand_skill: null,
          question_group: 'cpu_scheduling',
          correct_answer: '文脈切り替えが増える',
          user_answer: index === 14 ? '待ち時間が必ずゼロになる' : '正答',
          is_correct: index !== 14,
          explanation:
            index === 14
              ? 'タイムスライスが短いほど文脈切り替えが頻発し、オーバーヘッドが増える。'
              : '教材に基づく解説',
        })),
        rowCount: 15,
      } as any)
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'temporarily unavailable',
    })

    const result = await generateLearningFeedback(
      'user-1',
      'session-1',
      progress
    )

    expect(result?.feedback?.llmMessage).toContain('ラウンドロビン方式')
    expect(result?.feedback?.llmMessage).toContain('文脈切り替え')
  })

  it('regenerates a cached response that incorrectly says attempt data is missing', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ lesson_id: 'computer-systems-2-03' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: Array.from({ length: 15 }, (_, index) => ({
          question: `問題${index + 1}`,
          question_type: 'multiple_choice',
          understand_skill: null,
          question_group: 'cpu_scheduling',
          correct_answer: '正答',
          user_answer: '回答',
          is_correct: true,
          explanation: '解説',
        })),
        rowCount: 15,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ answer: '実際の回答記録に基づくフィードバック' }),
    })

    const result = await generateLearningFeedback('user-1', 'session-1', {
      ...progress,
      feedback: {
        ...progress.feedback!,
        llmMessage: '問題の内容や正誤の情報がこちらにまだ届いていません。',
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result?.feedback?.llmMessage).toBe(
      '実際の回答記録に基づくフィードバック'
    )
  })
})
