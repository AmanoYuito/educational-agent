/** @jest-environment node */
import { createMocks } from 'node-mocks-http'

import handler from '@/pages/api/question-pool/dify-next'
import { isDatabaseConfigured } from '@/lib/server/db'
import { createQuestionPoolRequestToken } from '@/lib/server/questionPoolRequest'
import { getLearningSessionForIssue } from '@/lib/server/learningSessions'
import {
  issueQuestionPoolItem,
  selectLearningSetQuestionPoolRow,
} from '@/lib/server/questionPoolSelection'

jest.mock('@/lib/server/db', () => ({ isDatabaseConfigured: jest.fn() }))
jest.mock('@/lib/server/questionPoolSelection', () => ({
  issueQuestionPoolItem: jest.fn(),
  selectLearningSetQuestionPoolRow: jest.fn(),
}))
jest.mock('@/lib/server/learningSessions', () => ({
  getLearningSessionForIssue: jest.fn(),
}))

describe('Dify question-pool callback', () => {
  const datasetId = '6c1f831e-9649-49e8-8d3d-acfc646487b9'
  const originalSecret = process.env.AUTH_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.AUTH_SECRET = 'callback-test-secret'
    ;(isDatabaseConfigured as jest.Mock).mockReturnValue(true)
    ;(getLearningSessionForIssue as jest.Mock).mockResolvedValue({
      sessionId: 'session-1',
      quizIndex: 1,
      total: 10,
      questionType: 'multiple_choice',
      issuedQuestionPoolIds: [],
      issuedUnderstandSkills: [],
    })
  })

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = originalSecret
  })

  const request = (token?: string, body: Record<string, unknown> = {}) =>
    createMocks({
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: { source_dataset_id: datasetId, ...body },
    })

  it('rejects requests without a valid short-lived token', async () => {
    const { req, res } = request('invalid')
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(selectLearningSetQuestionPoolRow).not.toHaveBeenCalled()
  })

  it('rejects a dataset different from the signed dataset', async () => {
    const token = createQuestionPoolRequestToken('learner-1', datasetId)
    const { req, res } = request(token, {
      source_dataset_id: '8a85cfc6-364c-420e-90a5-065e06596caf',
    })
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(selectLearningSetQuestionPoolRow).not.toHaveBeenCalled()
  })

  it('returns an issued public quiz without the answer or explanation', async () => {
    const row = { id: 'pool-1' }
    ;(selectLearningSetQuestionPoolRow as jest.Mock).mockResolvedValue(row)
    ;(issueQuestionPoolItem as jest.Mock).mockResolvedValue({
      id: 'pool-1',
      serverQuizId: 'issued-1',
      questionType: 'multiple_choice',
      question: 'どれですか。',
      choices: ['A1', 'B1', 'C1', 'D1'],
      difficultyLevel: 2,
      questionGroup: 'mail',
    })
    const token = createQuestionPoolRequestToken('learner-1', datasetId)
    const { req, res } = request(token)
    await handler(req, res)

    expect(selectLearningSetQuestionPoolRow).toHaveBeenCalledWith({
      learnerId: 'learner-1',
      lessonId: 'legacy',
      datasetId,
      topic: undefined,
      difficulty: undefined,
      questionType: 'multiple_choice',
      excludeQuestionPoolIds: [],
      excludeUnderstandSkills: [],
    })
    expect(issueQuestionPoolItem).toHaveBeenCalledWith(
      'learner-1',
      row,
      expect.objectContaining({ sessionId: 'session-1', quizIndex: 1 })
    )
    expect(res.statusCode).toBe(200)
    const output = JSON.parse(res._getData())
    expect(output).toMatchObject({
      type: 'quiz',
      serverQuizId: 'issued-1',
      public: {
        question: 'どれですか。',
        choices: ['A1', 'B1', 'C1', 'D1'],
      },
    })
    expect(output).not.toHaveProperty('answer')
    expect(output).not.toHaveProperty('answerIndex')
    expect(output).not.toHaveProperty('explanation')
  })

  it('returns a normal workflow result when the selected pool is empty', async () => {
    ;(selectLearningSetQuestionPoolRow as jest.Mock).mockResolvedValue(null)
    const token = createQuestionPoolRequestToken('learner-1', datasetId)
    const { req, res } = request(token)
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res._getData())).toMatchObject({
      type: 'question_pool_empty',
    })
  })
})
