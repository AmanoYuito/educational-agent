/** @jest-environment node */
import {
  csvCell,
  evaluationSettings,
  evaluationsCsv,
  readEvaluationUsage,
  saveQuizEvaluation,
} from '@/lib/server/quizEvaluation'
import { query } from '@/lib/server/db'

jest.mock('@/lib/server/db', () => ({ query: jest.fn() }))

describe('quiz evaluation records', () => {
  beforeEach(() => jest.clearAllMocks())
  const settings = {
    ownerId: 'admin',
    enabled: true,
    runLabel: '比較1',
    modelLabel: '全ノード model-a',
    notes: '',
  }

  it('keeps missing usage unknown, including blank values and invalid numbers', () => {
    expect(readEvaluationUsage({}).totalPrice).toBeNull()
    expect(
      readEvaluationUsage({
        metadata: {
          usage: {
            total_price: '',
            total_tokens: null,
            prompt_tokens: false,
            completion_tokens: -1,
            latency: 'NaN',
          },
        },
      })
    ).toMatchObject({
      totalPrice: null,
      totalTokens: null,
      promptTokens: null,
      completionTokens: null,
      latencyMs: null,
    })
    expect(
      readEvaluationUsage({
        metadata: {
          usage: { total_price: '0', prompt_tokens: 0, latency: '1.25' },
        },
      })
    ).toMatchObject({
      totalPrice: 0,
      promptTokens: 0,
      latencyMs: 1250,
      scope: 'dify_response_unverified',
    })
  })

  it('rejects stale owner settings and invalid labels', () => {
    expect(evaluationSettings(settings, 'other')).toBeNull()
    expect(
      evaluationSettings({ ...settings, runLabel: ' ' }, 'admin')
    ).toBeNull()
    expect(
      evaluationSettings({ ...settings, enabled: false }, 'admin')
    ).toBeNull()
    expect(evaluationSettings(settings, 'admin')).toEqual(settings)
  })

  it('records malformed output and billed usage without persisting credentials or unrelated metadata', async () => {
    await saveQuizEvaluation({
      ownerId: 'admin',
      settings,
      capture: {
        attempts: 1,
        difyMs: 2100,
        rawOutput: 'invalid quiz',
        inputs: {
          mode: 'generate_question',
          topic: 'メール',
          apiKey: 'DO_NOT_SAVE',
        },
        data: {
          message_id: 'message',
          conversation_id: 'conversation',
          secret: 'DO_NOT_SAVE',
          metadata: {
            usage: {
              total_price: '0.0123',
              currency: 'USD',
              total_tokens: 321,
            },
          },
        },
      },
      queryText: '問題を作って',
      conversationId: '',
      response: new Response(JSON.stringify({ error: '形式エラー' }), {
        status: 502,
      }),
      serverMs: 2400,
    })
    const record = JSON.parse((query as jest.Mock).mock.calls[0][1][2])
    expect(record).toMatchObject({
      status: 'error',
      rawOutput: 'invalid quiz',
      error: '形式エラー',
      displayMs: null,
      messageId: 'message',
      usage: { totalPrice: 0.0123, totalTokens: 321 },
    })
    expect(JSON.stringify(record)).not.toContain('DO_NOT_SAVE')
    const csv = evaluationsCsv([record])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('採用可否')
    expect(csv).toContain('dify_response_unverified')
  })

  it.each(['=SUM(A1)', ' +cmd', '@formula', '-1+2', '\ttext', '\nformula'])(
    'escapes a spreadsheet formula: %s',
    (value) => {
      expect(csvCell(value)).toBe(`"'${value}"`)
    }
  )
  it('preserves multiline Japanese, quotes, zero and missing metrics', () => {
    expect(csvCell('問題,"引用"\n次の行')).toBe('"問題,""引用""\n次の行"')
    expect(csvCell(null)).toBe('""')
    expect(csvCell(0)).toBe('"0"')
  })
})
