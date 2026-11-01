/** @jest-environment node */
import { createMocks } from 'node-mocks-http'

import { requireSession } from '@/lib/server/auth'
import {
  ensureLearningLogSchema,
  getPool,
  isDatabaseConfigured,
} from '@/lib/server/db'
import handler from '@/pages/api/admin/activity-logs'

jest.mock('@/lib/server/auth', () => ({ requireSession: jest.fn() }))
const mockQuery = jest.fn()
jest.mock('@/lib/server/db', () => ({
  ensureLearningLogSchema: jest.fn(),
  getPool: jest.fn(),
  isDatabaseConfigured: jest.fn(),
}))

describe('admin activity logs', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(requireSession as jest.Mock).mockReturnValue({
      userId: 'admin-1',
      role: 'admin',
    })
    ;(isDatabaseConfigured as jest.Mock).mockReturnValue(true)
    ;(ensureLearningLogSchema as jest.Mock).mockResolvedValue(undefined)
    ;(getPool as jest.Mock).mockReturnValue({ query: mockQuery })
  })

  it('returns filtered learning activity to an administrator', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'attempt-1',
            event_type: 'quiz',
            user_id: 'student-1',
            username: 'student',
            lesson_id: 'computer-systems-2-03',
            created_at: '2026-10-16T00:00:00.000Z',
            subtype: 'written',
            content: '教材に基づく解説',
            question: 'プロセスの状態を比べてみよう。',
            user_answer: '回答',
            correct_answer: '模範回答',
            is_correct: false,
            assessment_level: 'partial',
            score: 55,
            response_time_ms: 42000,
            understand_skill: 'compare',
            difficulty_level: 4,
            question_group: 'プロセス状態',
            checkpoint_answered: null,
            feedback_text: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            total_count: '12',
            chat_count: '5',
            quiz_count: '6',
            feedback_count: '1',
            activity_count: '0',
            quiz_correct_count: '3',
            quiz_partial_count: '2',
            quiz_review_count: '1',
            average_response_ms: '35000',
            multiple_choice_count: '4',
            multiple_choice_correct_count: '3',
            written_count: '2',
            written_understood_count: '0',
            written_partial_count: '2',
            written_review_count: '0',
            active_time_ms: '0',
            material_time_ms: '0',
            avatar_time_ms: '0',
            quiz_time_ms: '0',
            conversation_time_ms: '0',
            material_page_views: '0',
            material_consults_during_quiz: '0',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'student-1', username: 'student' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            understand_skill: 'compare',
            attempts: '2',
            understood: '0',
            partial: '2',
            review: '0',
            average_response_ms: '42000',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
    const { req, res } = createMocks({
      method: 'GET',
      query: {
        lessonId: 'computer-systems-2-03',
        type: 'quiz',
        search: 'プロセス',
        page: '2',
      },
    })

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain("'chat'::text AS event_type")
    expect(sql).toContain("'quiz'::text AS event_type")
    expect(sql).toContain("'feedback'::text AS event_type")
    expect(sql).toContain('lesson_id = $1')
    expect(sql).toContain('event_type = $2')
    expect(params).toEqual([
      'computer-systems-2-03',
      'quiz',
      '%プロセス%',
      25,
      25,
    ])
    expect(res._getJSONData()).toMatchObject({
      stats: {
        total: 12,
        chat: 5,
        quiz: 6,
        feedback: 1,
        quizCorrect: 3,
        quizPartial: 2,
        quizReview: 1,
      },
      skills: [{ skill: 'compare', attempts: 2, partial: 2 }],
      pagination: { page: 2, pageSize: 25, total: 12 },
      items: [
        {
          id: 'attempt-1',
          type: 'quiz',
          username: 'student',
          isCorrect: false,
          assessmentLevel: 'partial',
          score: 55,
          responseTimeMs: 42000,
          understandSkill: 'compare',
          difficultyLevel: 4,
          questionGroup: 'プロセス状態',
        },
      ],
    })
  })

  it('exports the filtered logs as a UTF-8 CSV for administrators', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'attempt-1',
          event_type: 'quiz',
          user_id: 'student-1',
          username: 'student',
          lesson_id: 'computer-systems-2-03',
          created_at: '2026-10-16T00:00:00.000Z',
          subtype: 'written',
          content: '教材に基づく解説',
          question: '二つの状態を比べてみよう。',
          user_answer: '=危険な数式',
          correct_answer: '模範回答',
          is_correct: false,
          assessment_level: 'partial',
          score: 55,
          response_time_ms: 42000,
          understand_skill: 'compare',
          difficulty_level: 4,
          question_group: 'プロセス状態',
          checkpoint_answered: null,
          feedback_text: null,
        },
      ],
    })
    const { req, res } = createMocks({
      method: 'GET',
      query: {
        format: 'csv',
        lessonId: 'computer-systems-2-03',
        type: 'quiz',
      },
    })

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.getHeader('Content-Type')).toBe('text/csv; charset=utf-8')
    const csv = res._getData()
    expect(csv).toContain('問題文')
    expect(csv).toContain('一部理解')
    expect(csv).toContain('比較')
    expect(csv).toContain("'=危険な数式")
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('does not expose logs to a non-admin user', async () => {
    ;(requireSession as jest.Mock).mockReturnValue({
      userId: 'student-1',
      role: 'student',
    })
    const { req, res } = createMocks({ method: 'GET' })

    await handler(req, res)

    expect(res.statusCode).toBe(403)
    expect(mockQuery).not.toHaveBeenCalled()
  })
})
