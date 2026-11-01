/** @jest-environment node */
import { createMocks } from 'node-mocks-http'
import { EventEmitter } from 'events'
import handler from '@/pages/api/difyChat'
import { requireSession } from '@/lib/server/auth'
import { query } from '@/lib/server/db'
import { verifyQuestionPoolRequestToken } from '@/lib/server/questionPoolRequest'

jest.mock('@/lib/server/auth', () => ({ requireSession: jest.fn() }))
jest.mock('@/lib/server/db', () => ({ query: jest.fn() }))

describe('Dify quiz issuance', () => {
  const originalFetch = global.fetch
  const originalDifyUrl = process.env.DIFY_URL
  const originalAuthSecret = process.env.AUTH_SECRET
  const originalPoolCallback = process.env.DIFY_QUESTION_POOL_CALLBACK_URL
  let log: jest.SpyInstance
  let errorLog: jest.SpyInstance
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn()
    process.env.AUTH_SECRET = 'test-secret'
    process.env.DIFY_QUESTION_POOL_CALLBACK_URL =
      'https://app.example/api/question-pool/dify-next/'
    ;(requireSession as jest.Mock).mockReturnValue({ userId: 'owner' })
    log = jest.spyOn(console, 'log').mockImplementation(() => {})
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    global.fetch = originalFetch
    if (originalDifyUrl === undefined) delete process.env.DIFY_URL
    else process.env.DIFY_URL = originalDifyUrl
    if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = originalAuthSecret
    if (originalPoolCallback === undefined)
      delete process.env.DIFY_QUESTION_POOL_CALLBACK_URL
    else process.env.DIFY_QUESTION_POOL_CALLBACK_URL = originalPoolCallback
    log.mockRestore()
    errorLog.mockRestore()
  })

  const request = (
    inputs: any = { mode: 'generate_question' },
    stream = false
  ) =>
    createMocks(
      {
        method: 'POST',
        body: {
          query: '問題を生成してください',
          apiKey: 'test-key',
          url: 'https://dify.invalid/v1',
          inputs,
          stream,
        },
      },
      { eventEmitter: EventEmitter }
    )
  const quiz = {
    type: 'quiz',
    public: { question: 'どれ？', choices: ['a', 'b', 'c', 'd'] },
    answerIndex: 1,
    answer: 'b',
    explanation: 'PRIVATE_EXPLANATION',
  }
  const reply = (answer: string, extra = {}) =>
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          answer,
          conversation_id: 'conversation',
          extraPrivateField: 'PRIVATE_METADATA',
          ...extra,
        }),
        { status: 200 }
      )
    )

  const issuedSnapshot = {
    rawText: 'stored',
    questionType: 'multiple_choice',
    question: 'どれ？',
    choices: ['a', 'b', 'c', 'd'],
    answerIndex: 1,
    answer: 'b',
    explanation: 'PRIVATE_EXPLANATION',
    questionPoolId: 'pool-1',
    serverQuizId: 'issued-1',
    awaitingAnswer: true,
    updatedAt: '2026-10-09T00:00:00.000Z',
  }

  const replyFromPool = () => {
    reply(
      JSON.stringify({
        type: 'quiz',
        serverQuizId: 'issued-1',
        public: { question: 'どれ？', choices: ['a', 'b', 'c', 'd'] },
      })
    )
    ;(query as jest.Mock).mockResolvedValue({
      rows: [{ quiz: issuedSnapshot }],
    })
  }

  it('sends only a short-lived pool request and uses the issued server quiz', async () => {
    replyFromPool()
    const { req, res } = request({
      mode: 'generate_question',
      source_context: 'ATTACKER_MATERIAL',
      latest_question: 'OLD_QUESTION',
    })
    req.body.conversationId = 'old-conversation'
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    const sent = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(sent).not.toHaveProperty('conversation_id')
    expect(sent.inputs.source_dataset_id).toBe(
      '6c1f831e-9649-49e8-8d3d-acfc646487b9'
    )
    expect(sent.inputs.question_pool_api_url).toContain(
      '/api/question-pool/dify-next/'
    )
    expect(
      verifyQuestionPoolRequestToken(sent.inputs.question_pool_request_token)
    ).toMatchObject({
      userId: 'owner',
      datasetId: '6c1f831e-9649-49e8-8d3d-acfc646487b9',
    })
    expect(JSON.stringify(sent)).not.toMatch(/ATTACKER_MATERIAL|OLD_QUESTION/)
    const output = JSON.parse(res._getBuffer().toString())
    expect(output.quizMemory.serverQuizId).toBe('issued-1')
    expect(JSON.stringify(output)).not.toContain('PRIVATE_EXPLANATION')
  })

  it('rejects unregistered datasets without calling Dify', async () => {
    const { req, res } = request({
      mode: 'generate_question',
      source_dataset_id: 'unknown',
    })
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('passes the selected registered dataset to the pool request flow', async () => {
    replyFromPool()
    const id = '8a85cfc6-364c-420e-90a5-065e06596caf'
    const { req, res } = request({
      mode: 'generate_question',
      source_dataset_id: id,
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    const sent = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(sent.inputs.source_dataset_id).toBe(id)
    expect(
      verifyQuestionPoolRequestToken(sent.inputs.question_pool_request_token)
    ).toMatchObject({ datasetId: id })
  })

  it('derives the dataset from the selected lesson', async () => {
    replyFromPool()
    const { req, res } = request({
      mode: 'generate_question',
      lesson_id: 'computer-systems-2-03',
      source_dataset_id: '6c1f831e-9649-49e8-8d3d-acfc646487b9',
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    const sent = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(sent.inputs.source_dataset_id).toBe(
      '77c078e6-38c1-4037-86cd-c3b0591a7970'
    )
    expect(sent.inputs).not.toHaveProperty('lesson_id')
  })

  it('does not issue an ungrounded quiz produced on the normal conversation route', async () => {
    reply(JSON.stringify(quiz))
    const { req, res } = request({})
    await handler(req, res)
    expect(res.statusCode).toBe(502)
    expect(query).not.toHaveBeenCalled()
  })

  it('stores the original answer but excludes it from every response representation', async () => {
    reply(JSON.stringify(quiz))
    const { req, res } = request()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    const output = JSON.parse(res._getBuffer().toString())
    expect(output.quizMemory.serverQuizId).toEqual(expect.any(String))
    expect(output.quizMemory.awaitingAnswer).toBe(true)
    expect(output.parsed.choices).toEqual(quiz.public.choices)
    expect(output).not.toHaveProperty('data')
    const serialized = JSON.stringify(output)
    expect(serialized).not.toContain('answerIndex')
    expect(serialized).not.toContain('PRIVATE_EXPLANATION')
    expect(serialized).not.toContain('PRIVATE_METADATA')
    const params = (query as jest.Mock).mock.calls[0][1]
    expect(params[1]).toBe('owner')
    expect(JSON.parse(params[2])).toMatchObject({
      answerIndex: 1,
      explanation: 'PRIVATE_EXPLANATION',
    })
  })

  it('keeps fallback generation metadata private', async () => {
    reply(JSON.stringify(quiz), {
      metadata: {
        retriever_resources: [
          { document_name: '教材.html', content: 'SOURCE_SNAPSHOT' },
        ],
      },
    })
    const { req, res } = request()
    await handler(req, res)
    const output = JSON.parse(res._getBuffer().toString())
    expect(output.parsed.serverQuizId).toBe(output.quizMemory.serverQuizId)
    expect(JSON.stringify(output)).not.toContain('SOURCE_SNAPSHOT')
    const stored = JSON.parse((query as jest.Mock).mock.calls[0][1][2])
    expect(stored.sources).toEqual([
      {
        documentName: '教材.html',
        content: 'SOURCE_SNAPSHOT',
        kind: 'retrieval',
      },
    ])
  })

  it('does not issue a question if the database save fails', async () => {
    reply(JSON.stringify(quiz))
    ;(query as jest.Mock).mockRejectedValueOnce(new Error('DB offline'))
    const { req, res } = request()
    await handler(req, res)
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res._getBuffer().toString())).not.toHaveProperty(
      'quizMemory'
    )
  })

  it('rejects a malformed generated answer', async () => {
    reply(JSON.stringify({ ...quiz, answerIndex: -1 }))
    const { req, res } = request()
    await handler(req, res)
    expect(res.statusCode).toBe(502)
    expect(JSON.parse(res._getBuffer().toString()).errorCode).toBe(
      'QuizGenerationFailed'
    )
    expect(query).not.toHaveBeenCalled()
  })

  it('reports insufficient material without issuing or saving a quiz', async () => {
    reply(JSON.stringify({ type: 'insufficient_material' }))
    const { req, res } = request()
    await handler(req, res)
    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res._getBuffer().toString()).errorCode).toBe(
      'QuizMaterialInsufficient'
    )
    expect(query).not.toHaveBeenCalled()
  })

  it('keeps normal conversation working without issuing a quiz', async () => {
    reply('こんにちは。何を学びますか？')
    const { req, res } = request({})
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res._getBuffer().toString()).text).toContain('こんにちは')
    expect(query).not.toHaveBeenCalled()
  })

  it('forwards a normal streaming response', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      new Response('data: {"answer":"hello"}\n\n')
    )
    const { req, res } = request({}, true)
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._getBuffer().toString()).toContain('hello')
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects streaming generation and unimplemented written grading', async () => {
    for (const [inputs, stream] of [
      [{ mode: 'generate_question' }, true],
      [{ mode: 'grade_written_answer' }, false],
    ] as const) {
      const { req, res } = request(inputs, stream)
      await handler(req, res)
      expect(res.statusCode).toBe(400)
    }
    expect(global.fetch).not.toHaveBeenCalled()
  })

  const measuredRequest = () => {
    ;(requireSession as jest.Mock).mockReturnValue({
      userId: 'owner',
      role: 'admin',
    })
    const result = request()
    result.req.body.evaluation = {
      ownerId: 'owner',
      enabled: true,
      runLabel: 'run-1',
      modelLabel: 'all-model-a',
      notes: 'temperature fixed',
    }
    return result
  }
  const measurement = () => {
    const call = (query as jest.Mock).mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO quiz_evaluations')
    )
    return call ? JSON.parse(call[1][2]) : null
  }

  const missingConversation = {
    code: 'not_found',
    message: 'Conversation Not Exists.',
    status: 404,
  }
  const staleConversationRequest = () => {
    process.env.DIFY_URL = 'https://api.dify.ai/v1'
    const result = measuredRequest()
    result.req.body.url = 'https://api.dify.ai/v1'
    result.req.body.conversationId = 'old-app-conversation'
    result.req.body.inputs.mode = 'explain_quiz'
    result.req.body.inputs.latest_question = '前の問題'
    return result
  }
  const postBodies = () =>
    (global.fetch as jest.Mock).mock.calls
      .filter(([, options]) => options.method === 'POST')
      .map(([, options]) => JSON.parse(options.body))

  it('recovers an old app conversation once, preserving inputs and reporting the new conversation', async () => {
    const { req, res } = staleConversationRequest()
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(missingConversation), { status: 404 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            answer: '前の問題の解説です。',
            conversation_id: 'new-app-conversation',
          })
        )
      )
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    const [first, retry] = postBodies()
    expect(first.conversation_id).toBe('old-app-conversation')
    expect(retry).not.toHaveProperty('conversation_id')
    expect(retry).toEqual({ ...first, conversation_id: undefined })
    expect(retry.inputs.latest_question).toBe('前の問題')
    expect(postBodies()).toHaveLength(2)
    expect(JSON.parse(res._getBuffer().toString()).conversation_id).toBe(
      'new-app-conversation'
    )
  })

  it.each([
    [401, { code: 'unauthorized', message: 'Invalid API key' }],
    [404, { code: 'not_found', message: 'App Not Exists.' }],
    [500, missingConversation],
  ])(
    'does not reset a conversation for unrelated error %s',
    async (status, failure) => {
      const { req, res } = staleConversationRequest()
      ;(global.fetch as jest.Mock)
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(failure), { status })
        )
      await handler(req, res)
      expect(res.statusCode).toBe(status)
      expect(postBodies()).toHaveLength(1)
      expect(postBodies()[0].conversation_id).toBe('old-app-conversation')
    }
  )

  it('stops after a failed recovery instead of looping', async () => {
    const { req, res } = staleConversationRequest()
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify(missingConversation), { status: 404 })
        )
      )
    await handler(req, res)
    expect(res.statusCode).toBe(404)
    expect(postBodies()).toHaveLength(2)
  })

  it('records measured generation and usage without exposing answers in the response', async () => {
    reply(JSON.stringify(quiz), {
      message_id: 'dify-msg',
      metadata: {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          total_price: '0.0005',
          currency: 'USD',
        },
      },
    })
    const { req, res } = measuredRequest()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    const record = measurement()
    expect(record).toMatchObject({
      status: 'success',
      runLabel: 'run-1',
      modelLabel: 'all-model-a',
      correctAnswer: 'b',
      explanation: 'PRIVATE_EXPLANATION',
      attempts: 1,
      usage: { totalTokens: 150, totalPrice: 0.0005 },
    })
    expect(record.serverMs).toBeGreaterThanOrEqual(0)
    expect(res.getHeader('X-Quiz-Evaluation-Id')).toBe(record.id)
    expect(res._getBuffer().toString()).not.toContain('PRIVATE_EXPLANATION')
    const sent = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(sent).not.toHaveProperty('evaluation')
    expect(sent.inputs).not.toHaveProperty('modelLabel')
  })

  it('records malformed generated output and its cost as a failure', async () => {
    reply(JSON.stringify({ ...quiz, answerIndex: -1 }), {
      metadata: { usage: { total_price: '0.002', currency: 'USD' } },
    })
    const { req, res } = measuredRequest()
    await handler(req, res)
    expect(res.statusCode).toBe(502)
    expect(measurement()).toMatchObject({
      status: 'error',
      usage: { totalPrice: 0.002 },
    })
    expect(measurement().rawOutput).toContain('PRIVATE_EXPLANATION')
    expect(res.getHeader('X-Quiz-Evaluation-Id')).toBeTruthy()
  })

  it('records upstream errors without inventing free usage', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      new Response('upstream failed', { status: 401 })
    )
    const { req, res } = measuredRequest()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(measurement()).toMatchObject({
      status: 'error',
      attempts: 1,
      usage: { totalPrice: null, totalTokens: null },
    })
  })

  it('continues serving the quiz when measurement storage fails', async () => {
    reply(JSON.stringify(quiz))
    ;(query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('measurement DB failed'))
    const { req, res } = measuredRequest()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.getHeader('X-Quiz-Evaluation-Error')).toBe('save_failed')
    expect(JSON.parse(res._getBuffer().toString()).quizMemory).toBeTruthy()
  })

  it('does not instrument ordinary conversation or requests from students', async () => {
    reply('こんにちは')
    const { req, res } = measuredRequest()
    req.body.inputs = {}
    await handler(req, res)
    expect(measurement()).toBeNull()
    reply(JSON.stringify(quiz))
    const student = measuredRequest()
    ;(requireSession as jest.Mock).mockReturnValue({
      userId: 'owner',
      role: 'student',
    })
    await handler(student.req, student.res)
    expect(measurement()).toBeNull()
  })
})
