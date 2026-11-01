/** @jest-environment node */
import { createMocks } from 'node-mocks-http'

import handler from '@/pages/api/question-pool/manage'
import { requireSession } from '@/lib/server/auth'
import { isDatabaseConfigured, query } from '@/lib/server/db'

jest.mock('@/lib/server/auth', () => ({ requireSession: jest.fn() }))
jest.mock('@/lib/server/db', () => ({
  isDatabaseConfigured: jest.fn(),
  query: jest.fn(),
}))

describe('question pool management', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(requireSession as jest.Mock).mockReturnValue({ role: 'admin' })
    ;(isDatabaseConfigured as jest.Mock).mockReturnValue(true)
    ;(query as jest.Mock)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'written-1',
            lesson_id: 'computer-systems-2-03',
            topic: null,
            question_group: '生成履歴',
            difficulty_level: 3,
            question_text: 'CPUスケジューリングを説明してください。',
            question_type: 'written',
            bloom_level: 'understand',
            understand_skill: 'explain',
            correct_answer: '実行可能状態のプロセスから選びます。',
            correct_index: null,
            wrong_answers: [],
            choices: [],
            explanation: '教材の説明です。',
            source_context: '教材本文',
            question_number: 12,
            source_dataset_id: 'dataset-1',
            source_dataset_name: 'コンシス第3回',
            source_document_id: 'document-1',
            source_document_name: 'コンシス第3回.pdf',
            source_segment_ids: ['segment-1'],
            ai_output: '{}',
            is_active: true,
            created_at: '2026-10-13T00:00:00.000Z',
            updated_at: '2026-10-13T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            total: '8',
            active: '7',
            multiple_choice: '4',
            written_remember: '2',
            written_understand: '1',
            written_unclassified: '1',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ understand_skill: 'explain', count: '1' }],
      })
  })

  it('returns registered questions and counts by question type for a lesson', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { lessonId: 'computer-systems-2-03' },
    })

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    const [itemsSql, itemsParams] = (query as jest.Mock).mock.calls[0]
    const [countsSql, countsParams] = (query as jest.Mock).mock.calls[1]
    const [skillCountsSql, skillCountsParams] = (query as jest.Mock).mock
      .calls[2]
    expect(itemsSql).toContain('bloom_level')
    expect(itemsSql).toContain('WHERE lesson_id = $1')
    expect(countsSql).toContain('written_remember')
    expect(skillCountsSql).toContain('understand_skill')
    expect(itemsParams).toEqual(['computer-systems-2-03'])
    expect(countsParams).toEqual(['computer-systems-2-03'])
    expect(skillCountsParams).toEqual(['computer-systems-2-03'])
    expect(res._getJSONData()).toMatchObject({
      stats: {
        total: 8,
        active: 7,
        multipleChoice: 4,
        writtenRemember: 2,
        writtenUnderstand: 1,
        writtenUnclassified: 1,
        understandBySkill: { explain: 1 },
      },
      items: [
        {
          id: 'written-1',
          questionType: 'written',
          bloomLevel: 'understand',
          understandSkill: 'explain',
          questionNumber: 12,
        },
      ],
    })
  })

  it('blocks non-admin users', async () => {
    ;(requireSession as jest.Mock).mockReturnValue({ role: 'student' })
    const { req, res } = createMocks({ method: 'GET' })

    await handler(req, res)

    expect(res.statusCode).toBe(403)
    expect(query).not.toHaveBeenCalled()
  })

  it('deletes a question while keeping deletion admin-only', async () => {
    ;(query as jest.Mock).mockReset().mockResolvedValue({
      rowCount: 1,
      rows: [{ id: 'pool-1' }],
    })
    const { req, res } = createMocks({
      method: 'DELETE',
      body: { id: 'pool-1' },
    })

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM question_pool'),
      ['pool-1']
    )
    expect(res._getJSONData()).toEqual({ id: 'pool-1', deleted: true })
  })

  it('returns not found when the question has already been deleted', async () => {
    ;(query as jest.Mock).mockReset().mockResolvedValue({
      rowCount: 0,
      rows: [],
    })
    const { req, res } = createMocks({
      method: 'DELETE',
      body: { id: 'missing' },
    })

    await handler(req, res)

    expect(res.statusCode).toBe(404)
    expect(res._getJSONData()).toEqual({
      message: '問題が見つかりません。',
    })
  })
})
