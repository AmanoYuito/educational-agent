/** @jest-environment node */
import { createMocks } from 'node-mocks-http'
import knowledgeSources from '@/config/questionKnowledge.json'
import handler from '@/pages/api/question-pool/generate'
import {
  selectQuestionMaterial,
  QuestionMaterialError,
} from '@/lib/server/questionMaterial'
import { requireSession } from '@/lib/server/auth'
import { query } from '@/lib/server/db'
import { evaluationsCsv } from '@/lib/server/quizEvaluation'

jest.mock('@/lib/server/auth', () => ({ requireSession: jest.fn() }))
jest.mock('@/lib/server/db', () => ({ query: jest.fn() }))
jest.mock('@/lib/server/questionMaterial', () => ({
  ...jest.requireActual('@/lib/server/questionMaterial'),
  selectQuestionMaterial: jest.fn(),
}))

const quiz = {
  type: 'quiz',
  questionType: 'multiple_choice',
  public: { question: '送信に用いるものは？', choices: ['A', 'B', 'C', 'D'] },
  answerIndex: 1,
  answer: 'B',
  explanation: 'Bが送信を行います。',
}
const body = {
  evaluation: {
    runLabel: '比較1',
    modelLabel: '問題・正答: small、誤答・整形: large',
    notes: '',
  },
}

describe('question pool generation with a separate Dify key', () => {
  const oldFetch = global.fetch
  const oldEnv = { ...process.env }
  beforeEach(() => {
    jest.clearAllMocks()
    ;(selectQuestionMaterial as jest.Mock).mockResolvedValue({
      text: '教材本文: メールを送信します。',
      sourceIds: ['document:segment'],
      datasetId: 'dataset',
      documentId: 'document',
      documentName: '電子メール',
      recycled: false,
    })
    process.env.DIFY_API_KEY = 'normal-chat-secret'
    process.env.DIFY_QUESTION_POOL_API_KEY = 'pool-secret'
    process.env.DIFY_QUESTION_POOL_URL = 'https://pool.invalid/v1/'
    ;(requireSession as jest.Mock).mockReturnValue({
      userId: 'admin1',
      role: 'admin',
    })
    ;(query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 1 })
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          answer: JSON.stringify(quiz),
          message_id: 'message-1',
          metadata: {
            usage: { total_tokens: 123, total_price: '0.01', currency: 'USD' },
          },
        })
      )
    )
  })
  afterEach(() => {
    global.fetch = oldFetch
    process.env = { ...oldEnv }
  })
  const request = (overrides = {}) =>
    createMocks({ method: 'POST', body: { ...body, ...overrides } })
  const record = () => JSON.parse((query as jest.Mock).mock.calls[0][1][2])

  it('uses only the pool key, returns a preview and saves a scoped evaluation, not a pool item', async () => {
    const { req, res } = request({
      apiKey: 'browser-secret',
      url: 'https://evil.invalid',
      conversationId: 'old-chat',
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('https://pool.invalid/v1/chat-messages')
    expect(options.headers.Authorization).toBe('Bearer pool-secret')
    const sent = JSON.parse(options.body)
    expect(sent).not.toHaveProperty('conversation_id')
    expect(sent.inputs).toEqual({
      source_context: '教材本文: メールを送信します。',
      question_type: 'multiple_choice',
      bloom_level: 'remember',
      difficulty_level: '2',
    })
    expect(sent.query).toBe('問題を1問生成してください。')
    const output = res._getJSONData()
    expect(output.item).toMatchObject({
      questionType: 'multiple_choice',
      correctIndex: 1,
      correctAnswer: 'B',
      wrongAnswers: ['A', 'C', 'D'],
      bloomLevel: 'remember',
    })
    expect(output.evaluationId).toEqual(expect.any(String))
    expect(query).toHaveBeenCalledTimes(1)
    expect((query as jest.Mock).mock.calls[0][0]).toContain(
      'INSERT INTO quiz_evaluations'
    )
    expect(record()).toMatchObject({
      source: 'question_pool',
      status: 'success',
      modelLabel: body.evaluation.modelLabel,
      question: quiz.public.question,
      choices: quiz.public.choices,
      correctAnswer: 'B',
      attempts: 1,
      usage: { totalTokens: 123, totalPrice: 0.01 },
    })
    expect(JSON.stringify(record()) + res._getData()).not.toMatch(
      /pool-secret|browser-secret|normal-chat-secret/
    )
    const csv = evaluationsCsv([record()])
    for (const value of [
      quiz.public.question,
      body.evaluation.modelLabel,
      '選択肢A',
      'サーバー処理ms',
      '"0.01"',
      '"question_pool"',
    ])
      expect(csv).toContain(value)
  })
  it('generates written Understand questions and records model answers without choices', async () => {
    const written = {
      type: 'written',
      questionType: 'written',
      bloomLevel: 'understand',
      public: { question: 'メールを送信する仕組みってどんなもの？' },
      modelAnswer: '送信サーバーがメールを送ります。',
      explanation: '教材では送信サーバーの役割が説明されています。',
    }
    ;(global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          answer: JSON.stringify(written),
          metadata: { usage: { total_tokens: 100 } },
        })
      )
    )
    const { req, res } = request({
      questionType: 'written',
      bloomLevel: 'understand',
      understandSkill: 'explain',
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(
      JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).inputs
    ).toMatchObject({
      question_type: 'written',
      bloom_level: 'understand',
      understand_skill: 'explain',
      difficulty_level: '2',
    })
    expect(res._getJSONData().item).toMatchObject({
      questionType: 'written',
      bloomLevel: 'understand',
      understandSkill: 'explain',
      choices: [],
      correctIndex: null,
      correctAnswer: written.modelAnswer,
      sourceContext: '教材本文: メールを送信します。',
    })
    expect(record()).toMatchObject({
      status: 'success',
      correctAnswer: written.modelAnswer,
      choices: [],
      inputs: {
        question_type: 'written',
        bloom_level: 'understand',
        understand_skill: 'explain',
      },
    })
  })
  it('sets four-choice questions to Remember regardless of a stale browser value', async () => {
    const { req, res } = request({ bloomLevel: 'understand' })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    const sent = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(sent.inputs).toMatchObject({
      bloom_level: 'remember',
      difficulty_level: '2',
    })
    expect(record().inputs).toMatchObject({ bloom_level: 'remember' })
    expect(res._getJSONData().item).toMatchObject({ bloomLevel: 'remember' })
  })
  it('rejects a four-choice result when a written problem was requested', async () => {
    const { req, res } = request({
      questionType: 'written',
      bloomLevel: 'understand',
    })
    await handler(req, res)
    expect(res.statusCode).toBe(502)
    expect(record().status).toBe('error')
  })
  it('rejects a written result with a different cognitive level', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          answer: JSON.stringify({
            type: 'written',
            questionType: 'written',
            bloomLevel: 'remember',
            public: { question: '問題' },
            modelAnswer: '回答',
            explanation: '解説',
          }),
        })
      )
    )
    const { req, res } = request({
      questionType: 'written',
      bloomLevel: 'understand',
    })
    await handler(req, res)
    expect(res.statusCode).toBe(502)
    expect(record().status).toBe('error')
  })
  it('requires a cognitive level only for written problems', async () => {
    const { req, res } = request({ questionType: 'written' })
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(selectQuestionMaterial).not.toHaveBeenCalled()
  })
  it.each([
    { modelAnswer: '' },
    { public: { question: '問題', choices: ['a', 'b'] } },
    { answerIndex: 0 },
    { bloomLevel: 'apply' },
  ])('rejects malformed written outputs: %j', async (patch) => {
    const answer = {
      type: 'written',
      questionType: 'written',
      bloomLevel: 'understand',
      public: { question: '問題' },
      modelAnswer: '回答',
      explanation: '解説',
      ...patch,
    }
    ;(global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ answer: JSON.stringify(answer) }))
    )
    const { req, res } = request({
      questionType: 'written',
      bloomLevel: 'understand',
    })
    await handler(req, res)
    expect(res.statusCode).toBe(502)
    expect(record().status).toBe('error')
  })
  it.each([
    { bloomLevel: 'apply' },
    { bloomLevel: 'create' },
    { questionType: 'essay' },
  ])(
    'rejects unsupported conditions before generation: %j',
    async (conditions) => {
      const { req, res } = request(conditions)
      await handler(req, res)
      expect(res.statusCode).toBe(400)
      expect(global.fetch).not.toHaveBeenCalled()
      expect(selectQuestionMaterial).not.toHaveBeenCalled()
    }
  )
  it('preserves written conditions in a material failure record', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({ answer: '{"type":"insufficient_material"}' })
      )
    )
    const { req, res } = request({
      questionType: 'written',
      bloomLevel: 'understand',
    })
    await handler(req, res)
    expect(res.statusCode).toBe(422)
    expect(res._getJSONData().retryable).toBe(true)
    expect(record().inputs).toMatchObject({
      question_type: 'written',
      bloom_level: 'understand',
    })
  })
  it('does not fall back to the normal key when the pool key is missing', async () => {
    delete process.env.DIFY_QUESTION_POOL_API_KEY
    const { req, res } = request()
    await handler(req, res)
    expect(res.statusCode).toBe(503)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(record()).toMatchObject({
      source: 'question_pool',
      status: 'error',
      attempts: 0,
    })
  })
  it('blocks non-admin and anonymous requests before calling Dify or storing records', async () => {
    for (const session of [null, { userId: 'student', role: 'student' }]) {
      ;(requireSession as jest.Mock).mockReturnValue(session)
      const { req, res } = request()
      await handler(req, res)
      if (session) expect(res.statusCode).toBe(403)
    }
    expect(global.fetch).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })
  it.each([
    [{ ...quiz, answer: 'wrong' }, 502],
    [
      { ...quiz, public: { ...quiz.public, choices: ['A', 'B', 'B', 'D'] } },
      502,
    ],
    [{ ...quiz, answerIndex: -1 }, 502],
    [{ type: 'insufficient_material' }, 422],
  ])(
    'records invalid output without returning a savable item',
    async (answer, status) => {
      ;(global.fetch as jest.Mock).mockResolvedValue(
        new Response(JSON.stringify({ answer: JSON.stringify(answer) }))
      )
      const { req, res } = request()
      await handler(req, res)
      expect(res.statusCode).toBe(status)
      expect(res._getJSONData()).not.toHaveProperty('item')
      expect(record().status).toBe('error')
      expect(record().rawOutput).toBe(JSON.stringify(answer))
    }
  )
  it('records provider failures without leaking its raw response', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      new Response('private provider detail', { status: 401 })
    )
    const { req, res } = request()
    await handler(req, res)
    expect(res.statusCode).toBe(502)
    expect(record().error).toContain('認証')
    expect(res._getData()).not.toContain('private provider detail')
  })
  it('passes difficulty while ignoring old topic and history settings', async () => {
    const { req, res } = request({
      topic: 'old topic',
      difficultyLevel: 6,
      previousQuestions: [quiz.public.question],
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(
      JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).inputs
    ).toEqual({
      source_context: '教材本文: メールを送信します。',
      question_type: 'multiple_choice',
      bloom_level: 'remember',
      difficulty_level: '6',
    })
    expect(record().status).toBe('success')
  })
  it('keeps a successful draft when measurement storage fails and warns the user', async () => {
    ;(query as jest.Mock).mockRejectedValue(new Error('DB offline'))
    const { req, res } = request()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._getJSONData().item.question).toBe(quiz.public.question)
    expect(res._getJSONData().warning).toContain('CSVには含まれません')
  })
  it('rejects invalid conditions without spending tokens', async () => {
    const { req, res } = request({
      evaluation: { runLabel: '', modelLabel: '', notes: '' },
    })
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })
  it('passes only source exclusion IDs to material selection and records actual source', async () => {
    const { req, res } = request({
      excludedSourceIds: ['used'],
      rejectedSourceIds: ['rejected'],
      source_context: 'ignore this browser material',
    })
    await handler(req, res)
    expect(selectQuestionMaterial).toHaveBeenCalledWith(
      ['used'],
      ['rejected'],
      knowledgeSources[0].id
    )
    expect(record().inputs).toMatchObject({
      source_context: '教材本文: メールを送信します。',
      source_document_id: 'document',
      source_segment_ids: '["document:segment"]',
    })
    expect(res._getJSONData().sourceIds).toEqual(['document:segment'])
  })
  it('marks only insufficient material as retryable and preserves the failed attempt', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          answer: '{"type":"insufficient_material"}',
          metadata: { usage: { total_tokens: 50 } },
        })
      )
    )
    const { req, res } = request()
    await handler(req, res)
    expect(res._getJSONData()).toMatchObject({
      retryable: true,
      sourceIds: ['document:segment'],
    })
    expect(record()).toMatchObject({
      status: 'error',
      attempts: 1,
      usage: { totalTokens: 50 },
    })
  })
  it('fails clearly before spending tokens when knowledge is unavailable', async () => {
    ;(selectQuestionMaterial as jest.Mock).mockRejectedValue(
      new QuestionMaterialError('ナレッジ未設定')
    )
    const { req, res } = request()
    await handler(req, res)
    expect(res.statusCode).toBe(503)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(record().attempts).toBe(0)
    expect(res._getJSONData().retryable).not.toBe(true)
  })
  it('rejects unregistered knowledge before retrieval or generation', async () => {
    const { req, res } = request({
      datasetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(selectQuestionMaterial).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })
  it('records the selected knowledge even when retrieval fails', async () => {
    ;(selectQuestionMaterial as jest.Mock).mockRejectedValue(
      new QuestionMaterialError('取得失敗', 502)
    )
    const { req, res } = request({ datasetId: knowledgeSources[1].id })
    await handler(req, res)
    expect(record().inputs).toMatchObject({
      source_dataset_id: knowledgeSources[1].id,
      source_dataset_name: 'johokiso7',
    })
    expect(selectQuestionMaterial).toHaveBeenCalledWith(
      [],
      [],
      knowledgeSources[1].id
    )
  })
})
