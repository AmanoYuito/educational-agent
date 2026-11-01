/** @jest-environment node */
import { createMocks } from 'node-mocks-http'
import handler from '@/pages/api/quiz-learning'
import { requireSession } from '@/lib/server/auth'
import { isDatabaseConfigured, query } from '@/lib/server/db'
import { requestDifyLearningExplanation } from '../../../../app/lib/api/client'
import { publicQuiz } from '@/lib/server/quizGrading'
import { retrievalSources } from '@/lib/server/quizSources'

jest.mock('@/lib/server/auth', () => ({ requireSession: jest.fn() }))
jest.mock('@/lib/server/db', () => ({
  query: jest.fn(),
  isDatabaseConfigured: jest.fn(),
}))
jest.mock('../../../../app/lib/api/client', () => ({
  requestDifyLearningExplanation: jest.fn(),
}))
const record = () => ({
  quiz: {
    serverQuizId: 'issued',
    rawText: '',
    updatedAt: '',
    question: '送信に使うのは？',
    choices: ['SMTP', 'POP3', 'IMAP', 'HTTP'],
    answerIndex: 0,
    explanation: '送信はSMTPです。',
    sources: [
      {
        documentName: 'メール教材',
        content: '送信はSMTP、受信はPOP3。',
        kind: 'retrieval' as const,
      },
    ],
  },
  graded_result: { grade: { correct: false, userIndex: 1 } },
})
const call = async (
  method: any = 'POST',
  body: any = { quizId: 'issued', kind: 'mistake' }
) => {
  const { req, res } = createMocks({
    method,
    body,
    query: { quizId: 'issued' },
  })
  await handler(req, res)
  return res
}
describe('quiz learning support', () => {
  const original = process.env.DIFY_KEY
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.DIFY_KEY = 'server-test-key'
    ;(requireSession as jest.Mock).mockReturnValue({ userId: 'owner' })
    ;(isDatabaseConfigured as jest.Mock).mockReturnValue(true)
    ;(query as jest.Mock).mockResolvedValue({ rows: [record()] })
    ;(requestDifyLearningExplanation as jest.Mock).mockResolvedValue(
      'POP3は受信に使うため、送信を問うこの問題には当てはまりません。'
    )
  })
  afterAll(() => {
    if (original === undefined) delete process.env.DIFY_KEY
    else process.env.DIFY_KEY = original
  })
  it('returns only saved sources and scopes access to the authenticated owner', async () => {
    const res = await call('GET')
    expect(res.statusCode).toBe(200)
    expect(res._getJSONData()).toEqual({ sources: record().quiz.sources })
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('user_id = $2'),
      ['issued', 'owner']
    )
    expect(requestDifyLearningExplanation).not.toHaveBeenCalled()
  })
  it('does not return the correct answer or source text in an unanswered quiz payload', () => {
    expect(publicQuiz(record().quiz)).not.toHaveProperty('sources')
    expect(publicQuiz(record().quiz)).not.toHaveProperty('answerIndex')
  })
  it('uses server-owned question, answer and source even when the browser sends replacements', async () => {
    const res = await call('POST', {
      quizId: 'issued',
      kind: 'mistake',
      userIndex: 3,
      correctAnswer: 'FAKE',
      sources: ['FAKE'],
      userId: 'victim',
    })
    expect(res.statusCode).toBe(200)
    const body = (requestDifyLearningExplanation as jest.Mock).mock.calls[0][2]
    expect(body.inputs.latest_user_answer).toBe('B. POP3')
    expect(body.query).toContain('送信はSMTP、受信はPOP3。')
    expect(body.query).not.toContain('FAKE')
    expect(body.conversation_id).toBeUndefined()
    expect(res._getJSONData().basedOn).toBe('material')
  })
  it('sends a written answer without inventing an A-D choice label', async () => {
    ;(query as jest.Mock).mockResolvedValue({
      rows: [
        {
          quiz: {
            ...record().quiz,
            questionType: 'written',
            choices: undefined,
            answerIndex: undefined,
            answer: '送信に使うプロトコルはSMTPです。',
          },
          graded_result: {
            grade: {
              correct: false,
              userIndex: null,
              userAnswer: 'POP3だと思います。',
            },
            attempt: { userAnswer: 'POP3だと思います。' },
          },
        },
      ],
    })
    const res = await call()
    expect(res.statusCode).toBe(200)
    const body = (requestDifyLearningExplanation as jest.Mock).mock.calls[0][2]
    expect(body.inputs.question_type).toBe('written')
    expect(body.inputs.latest_user_answer).toBe('POP3だと思います。')
    expect(body.query).toContain('"questionType":"written"')
    expect(body.query).toContain('"userAnswer":"POP3だと思います。"')
    expect(body.query).not.toContain('"selected"')
    expect(body.query).not.toContain('A.')
  })
  it('blocks additional explanations before grading', async () => {
    ;(query as jest.Mock).mockResolvedValue({
      rows: [{ ...record(), graded_result: null }],
    })
    expect((await call()).statusCode).toBe(409)
    expect(requestDifyLearningExplanation).not.toHaveBeenCalled()
  })
  it('rejects access to another owner or a missing quiz', async () => {
    ;(query as jest.Mock).mockResolvedValue({ rows: [] })
    expect((await call()).statusCode).toBe(404)
    expect(requestDifyLearningExplanation).not.toHaveBeenCalled()
  })
  it('rejects anonymous and invalid requests', async () => {
    ;(requireSession as jest.Mock).mockImplementation((_req, res) => {
      res.status(401).json({})
      return null
    })
    expect((await call()).statusCode).toBe(401)
    expect(query).not.toHaveBeenCalled()
  })
  it('uses cached explanations without another LLM call', async () => {
    ;(query as jest.Mock).mockResolvedValue({
      rows: [
        {
          ...record(),
          quiz: {
            ...record().quiz,
            learningSupport: {
              mistake: { text: '保存済み', basedOn: 'material' },
            },
          },
        },
      ],
    })
    expect((await call())._getJSONData().text).toBe('保存済み')
    expect(requestDifyLearningExplanation).not.toHaveBeenCalled()
  })
  it('regenerates an old written-answer explanation that used choice wording', async () => {
    ;(query as jest.Mock).mockResolvedValue({
      rows: [
        {
          quiz: {
            ...record().quiz,
            questionType: 'written',
            choices: undefined,
            answerIndex: undefined,
            answer: '送信に使うプロトコルはSMTPです。',
            learningSupport: {
              mistake: {
                text: '選んだAがなぜ違うかを説明します。',
                basedOn: 'material',
              },
            },
          },
          graded_result: {
            grade: {
              correct: false,
              userIndex: null,
              userAnswer: 'POP3だと思います。',
            },
            attempt: { userAnswer: 'POP3だと思います。' },
          },
        },
      ],
    })
    await call()
    expect(requestDifyLearningExplanation).toHaveBeenCalledTimes(1)
    expect((query as jest.Mock).mock.calls[1][1][0]).toContain('"version":2')
  })
  it('honestly marks old questions without source snapshots', async () => {
    ;(query as jest.Mock).mockResolvedValue({
      rows: [{ ...record(), quiz: { ...record().quiz, sources: [] } }],
    })
    expect((await call('GET'))._getJSONData().sources).toEqual([])
    expect((await call())._getJSONData().basedOn).toBe('explanation')
  })
  it('does not replace grades or expose credentials on LLM failure', async () => {
    ;(requestDifyLearningExplanation as jest.Mock).mockRejectedValue(
      new Error('server-test-key')
    )
    const res = await call()
    expect(res.statusCode).toBe(502)
    expect(JSON.stringify(res._getJSONData())).not.toContain('server-test-key')
    expect((query as jest.Mock).mock.calls).toHaveLength(1)
  })
  it('keeps retrieval text separate from generated source claims', () => {
    expect(
      retrievalSources({
        retriever_resources: [
          { document_name: '教材', content: '本文' },
          { document_name: '教材', content: '本文' },
          { content: null },
        ],
      })
    ).toEqual([{ documentName: '教材', content: '本文', kind: 'retrieval' }])
    expect(retrievalSources({ source: 'invented' })).toEqual([])
  })
})
