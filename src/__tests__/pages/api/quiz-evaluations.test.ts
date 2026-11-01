/** @jest-environment node */
import { createMocks } from 'node-mocks-http'
import handler from '@/pages/api/quiz-evaluations'
import { requireSession } from '@/lib/server/auth'
import { isDatabaseConfigured, query } from '@/lib/server/db'

jest.mock('@/lib/server/auth', () => ({ requireSession: jest.fn() }))
jest.mock('@/lib/server/db', () => ({
  isDatabaseConfigured: jest.fn(),
  query: jest.fn(),
}))

describe('quiz evaluation access and timing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(requireSession as jest.Mock).mockReturnValue({
      userId: 'admin-owner',
      role: 'admin',
    })
    ;(isDatabaseConfigured as jest.Mock).mockReturnValue(true)
    ;(query as jest.Mock).mockResolvedValue({ rowCount: 1, rows: [] })
  })
  it('blocks students from reading correct answers or updating timings', async () => {
    ;(requireSession as jest.Mock).mockReturnValue({
      userId: 'student',
      role: 'student',
    })
    for (const method of ['GET', 'PATCH']) {
      const { req, res } = createMocks({ method: method as 'GET' | 'PATCH' })
      await handler(req, res)
      expect(res.statusCode).toBe(403)
      expect(res.getHeader('Cache-Control')).toBe('no-store')
    }
    expect(query).not.toHaveBeenCalled()
  })
  it('does not access data for an unauthenticated request', async () => {
    ;(requireSession as jest.Mock).mockReturnValue(null)
    const { req, res } = createMocks({ method: 'GET' })
    await handler(req, res)
    expect(query).not.toHaveBeenCalled()
  })
  it('scopes CSV to the authenticated owner and exact run filter', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { format: 'csv', run: '比較1', userId: 'someone-else' },
    })
    await handler(req, res)
    expect((query as jest.Mock).mock.calls[0][1]).toEqual([
      'admin-owner',
      '比較1',
      10001,
      'realtime',
      '',
    ])
    expect(res.getHeader('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res._getData()).toContain('正確さ_1から5')
  })
  it('separates pool generation records from realtime generation', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { source: 'question_pool', format: 'csv' },
    })
    await handler(req, res)
    const [sql, params] = (query as jest.Mock).mock.calls[0]
    expect(sql).toContain("COALESCE(record->>'source', 'realtime') = $4")
    expect(params).toEqual(['admin-owner', '', 10001, 'question_pool', ''])
    expect(res._getData()).toContain('生成元')
  })
  it('returns an error instead of silently truncating a CSV', async () => {
    ;(query as jest.Mock).mockResolvedValue({ rows: Array(10001).fill({}) })
    const { req, res } = createMocks({
      method: 'GET',
      query: { format: 'csv' },
    })
    await handler(req, res)
    expect(res.statusCode).toBe(400)
  })
  it('does not overwrite timings on duplicate reports and scopes updates to owner', async () => {
    const { req, res } = createMocks({
      method: 'PATCH',
      body: {
        id: '00000000-0000-4000-8000-000000000000',
        displayMs: 1234,
        userId: 'someone-else',
        correctAnswer: 'injected',
      },
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    const [sql, params] = (query as jest.Mock).mock.calls[0]
    expect(sql).toContain('COALESCE')
    expect(sql).toContain('user_id = $2')
    expect(params).toEqual([
      '00000000-0000-4000-8000-000000000000',
      'admin-owner',
      1234,
      null,
    ])
    expect(params).not.toContain('injected')
  })
  it.each([-1, Infinity, '123', 3600001, null])(
    'rejects invalid timing %s',
    async (displayMs) => {
      const { req, res } = createMocks({
        method: 'PATCH',
        body: { id: '00000000-0000-4000-8000-000000000000', displayMs },
      })
      await handler(req, res)
      expect(res.statusCode).toBe(400)
      expect(query).not.toHaveBeenCalled()
    }
  )
  it.each(['csv', undefined])(
    'filters both CSV and screen records by exact dataset ID (%s)',
    async (format) => {
      const dataset = '8a85cfc6-364c-420e-90a5-065e06596caf'
      const { req, res } = createMocks({
        method: 'GET',
        query: {
          source: 'question_pool',
          dataset,
          ...(format ? { format } : {}),
        },
      })
      await handler(req, res)
      expect(res.statusCode).toBe(200)
      const [sql, values] = (query as jest.Mock).mock.calls[0]
      expect(sql).toContain("record->'inputs'->>'source_dataset_id' = $5")
      expect(values[0]).toBe('admin-owner')
      expect(values[4]).toBe(dataset)
    }
  )
  it('keeps missing source records separate and refuses invalid filter values', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { dataset: 'unknown', source: 'question_pool' },
    })
    await handler(req, res)
    expect((query as jest.Mock).mock.calls[0][1][4]).toBe('unknown')
    expect((query as jest.Mock).mock.calls[0][0]).toContain(
      "COALESCE(record->'inputs'->>'source_dataset_id', '') = ''"
    )
    jest.clearAllMocks()
    const bad = createMocks({
      method: 'GET',
      query: { dataset: ['one', 'two'] },
    })
    await handler(bad.req, bad.res)
    expect(bad.res.statusCode).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('names records with known source IDs but leaves old unknown records unassigned', async () => {
    ;(query as jest.Mock).mockResolvedValue({
      rows: [
        {
          record: {
            id: 'known',
            inputs: {
              source_dataset_id: '6c1f831e-9649-49e8-8d3d-acfc646487b9',
            },
          },
        },
        { record: { id: 'unknown', inputs: {} } },
      ],
    })
    const { req, res } = createMocks({
      method: 'GET',
      query: { source: 'question_pool' },
    })
    await handler(req, res)
    const items = res._getJSONData().items
    expect(items[0].inputs.source_dataset_name).toBe('johokiso3-1')
    expect(items[1].inputs.source_dataset_name).toBe('')
    expect(items[1].inputs.source_dataset_id).toBeUndefined()
  })
})
