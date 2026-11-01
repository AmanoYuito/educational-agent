/** @jest-environment node */
import { query } from '@/lib/server/db'
import {
  getLearningSetProgress,
  questionTypeForSetIndex,
} from '@/lib/server/learningSessions'

jest.mock('@/lib/server/db', () => ({
  ensureSchema: jest.fn(),
  query: jest.fn(),
}))

const queryMock = query as jest.MockedFunction<typeof query>

beforeEach(() => {
  queryMock.mockReset()
})

describe('learning question sequence', () => {
  it('repeats two multiple-choice questions followed by one written question', () => {
    expect(
      Array.from({ length: 12 }, (_, index) =>
        questionTypeForSetIndex(index + 1)
      )
    ).toEqual([
      'multiple_choice',
      'multiple_choice',
      'written',
      'multiple_choice',
      'multiple_choice',
      'written',
      'multiple_choice',
      'multiple_choice',
      'written',
      'multiple_choice',
      'multiple_choice',
      'written',
    ])
  })

  it('summarizes the actual genres and question types in the completed set', async () => {
    const attempts = [
      ...Array.from({ length: 4 }, (_, index) => ({
        question_type: 'multiple_choice',
        understand_skill: null,
        question_group: 'process_management',
        is_correct: index < 3,
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        question_type: 'multiple_choice',
        understand_skill: null,
        question_group: 'cpu_scheduling',
        is_correct: index === 0,
      })),
      {
        question_type: 'written',
        understand_skill: 'compare',
        question_group: 'memory_layout',
        is_correct: true,
      },
      {
        question_type: 'written',
        understand_skill: 'classify',
        question_group: 'memory_layout',
        is_correct: false,
      },
    ]
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'session-1',
            lesson_id: 'lesson-1',
            total_questions: 10,
            completed_at: '2026-10-14T00:00:00.000Z',
          },
        ],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: [{ count: '10' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: attempts,
        rowCount: 10,
      } as any)
      .mockResolvedValueOnce({
        rows: attempts,
        rowCount: 10,
      } as any)
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any)

    const progress = await getLearningSetProgress('user-1', 'session-1')

    expect(progress?.feedback?.genres).toEqual([
      expect.objectContaining({
        key: 'cpu_scheduling',
        label: 'CPUスケジューリング',
        answered: 4,
        correct: 1,
        status: 'review',
      }),
      expect.objectContaining({
        key: 'process_management',
        label: 'プロセス管理',
        answered: 4,
        correct: 3,
        status: 'achieved',
      }),
      expect.objectContaining({
        key: 'memory_layout',
        label: 'プロセスのメモリ構成',
        answered: 2,
        correct: 1,
        status: 'review',
      }),
    ])
    expect(progress?.feedback?.memory).toMatchObject({
      answered: 8,
      correct: 4,
    })
    expect(progress).toMatchObject({
      cumulativeAnswered: 10,
      feedbackUpdated: true,
    })
    expect(progress?.feedback).toMatchObject({
      checkpointAnswered: 10,
      periodAnswered: 10,
      comprehensive: true,
    })
    expect(
      progress?.feedback?.understanding.find((item) => item.skill === 'compare')
    ).toMatchObject({
      answered: 1,
      correct: 1,
      status: 'achieved',
      message: expect.stringContaining('共通点と違い'),
    })
    expect(
      progress?.feedback?.understanding.find(
        (item) => item.skill === 'classify'
      )
    ).toMatchObject({
      answered: 1,
      correct: 0,
      status: 'review',
      message: expect.stringContaining('どの分類に当てはまるか'),
    })
  })

  it('updates feedback after five more answers and reports improvement', async () => {
    const firstTen = [
      ...Array.from({ length: 8 }, (_, index) => ({
        question_type: 'multiple_choice',
        understand_skill: null,
        question_group: 'cpu_scheduling',
        is_correct: index < 2,
      })),
      {
        question_type: 'written',
        understand_skill: 'compare',
        question_group: 'process_management',
        is_correct: false,
      },
      {
        question_type: 'written',
        understand_skill: 'explain',
        question_group: 'process_management',
        is_correct: false,
      },
    ]
    const latestFive = [
      ...Array.from({ length: 4 }, () => ({
        question_type: 'multiple_choice',
        understand_skill: null,
        question_group: 'cpu_scheduling',
        is_correct: true,
      })),
      {
        question_type: 'written',
        understand_skill: 'compare',
        question_group: 'process_management',
        is_correct: true,
      },
    ]
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'session-2',
            lesson_id: 'lesson-1',
            total_questions: 10,
            completed_at: null,
          },
        ],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: [{ count: '5' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: latestFive, rowCount: 5 } as any)
      .mockResolvedValueOnce({
        rows: [...firstTen, ...latestFive],
        rowCount: 15,
      } as any)
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      } as any)

    const progress = await getLearningSetProgress('user-1', 'session-2')

    expect(progress).toMatchObject({
      answered: 5,
      cumulativeAnswered: 15,
      feedbackUpdated: true,
    })
    expect(progress?.feedback).toMatchObject({
      checkpointAnswered: 15,
      periodAnswered: 5,
      comprehensive: false,
      memory: { answered: 4, correct: 4, trend: 'improved' },
    })
    expect(
      progress?.feedback?.genres.find((item) => item.key === 'cpu_scheduling')
    ).toMatchObject({ trend: 'improved' })
    expect(
      progress?.feedback?.understanding.find((item) => item.skill === 'compare')
    ).toMatchObject({ trend: 'improved', answered: 1, correct: 1 })
  })

  it('counts unanswered quizzes as issued but excludes them from scored feedback', async () => {
    const attempts = [
      {
        question_type: 'multiple_choice',
        understand_skill: null,
        question_group: 'process_management',
        is_correct: true,
        answer_status: 'correct',
        assessment_level: null,
      },
      {
        question_type: 'multiple_choice',
        understand_skill: null,
        question_group: 'cpu_scheduling',
        is_correct: false,
        answer_status: 'unanswered',
        assessment_level: null,
      },
    ]
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'session-3',
            lesson_id: 'lesson-1',
            total_questions: 2,
            completed_at: null,
          },
        ],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [{ count: '2' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: attempts, rowCount: 2 } as any)
      .mockResolvedValueOnce({ rows: attempts, rowCount: 2 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)

    const progress = await getLearningSetProgress('user-1', 'session-3')

    expect(progress).toMatchObject({
      issued: 2,
      answered: 1,
      cumulativeAnswered: 1,
      completed: true,
    })
    expect(progress?.feedback).toBeUndefined()
  })
})
