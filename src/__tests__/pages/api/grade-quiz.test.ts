/** @jest-environment node */
import { createMocks } from 'node-mocks-http'
import handler from '@/pages/api/grade-quiz'
import saveHandler from '@/pages/api/save-quiz-attempt'
import { requireSession } from '@/lib/server/auth'
import { isDatabaseConfigured, query } from '@/lib/server/db'
import { gradeQuiz, QuizError } from '@/lib/server/quizGrading'

jest.mock('@/lib/server/auth', () => ({ requireSession: jest.fn() }))
jest.mock('@/lib/server/db', () => ({
  isDatabaseConfigured: jest.fn(),
  query: jest.fn(),
}))
jest.mock('@/lib/server/quizGrading', () => ({
  ...jest.requireActual('@/lib/server/quizGrading'),
  gradeQuiz: jest.fn(),
}))

describe('grading endpoint', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(requireSession as jest.Mock).mockReturnValue({
      userId: 'authenticated-owner',
    })
    ;(isDatabaseConfigured as jest.Mock).mockReturnValue(true)
  })
  const request = (body: any, method: any = 'POST') =>
    createMocks({ method, body })

  it('passes only the authenticated owner, question ID and answer to grading', async () => {
    const { req, res } = request({
      quizId: 'id',
      userIndex: 0,
      userAnswer: 'A',
      correct: true,
      answerIndex: 0,
      userId: 'victim',
    })
    ;(gradeQuiz as jest.Mock).mockResolvedValue({ grade: { correct: false } })
    await handler(req, res)
    expect(gradeQuiz).toHaveBeenCalledWith('authenticated-owner', 'id', 0, 'A')
    expect(res._getJSONData().grade.correct).toBe(false)
  })

  it('rejects anonymous calls', async () => {
    ;(requireSession as jest.Mock).mockImplementation((_req, res) => {
      res.status(401).json({ message: 'Unauthorized' })
      return null
    })
    const { req, res } = request({
      quizId: 'id',
      userIndex: 0,
      userAnswer: 'A',
    })
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(gradeQuiz).not.toHaveBeenCalled()
  })

  it.each([
    {},
    { quizId: 'id', userIndex: '0', userAnswer: 'A' },
    { quizId: 'id', userIndex: 4, userAnswer: 'A' },
    { quizId: 'id', userIndex: 0, userAnswer: '' },
  ])('rejects malformed input', async (body) => {
    const { req, res } = request(body)
    await handler(req, res)
    expect(res.statusCode).toBe(400)
    expect(gradeQuiz).not.toHaveBeenCalled()
  })

  it('rejects unsupported HTTP methods', async () => {
    const { req, res } = request({}, 'GET')
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('fails closed if the DB is unavailable', async () => {
    ;(isDatabaseConfigured as jest.Mock).mockReturnValue(false)
    const { req, res } = request({
      quizId: 'id',
      userIndex: 0,
      userAnswer: 'A',
    })
    await handler(req, res)
    expect(res.statusCode).toBe(503)
    expect(gradeQuiz).not.toHaveBeenCalled()
  })

  it('returns question ownership and already-answered errors without a grade', async () => {
    ;(gradeQuiz as jest.Mock).mockRejectedValue(new QuizError(404, 'not found'))
    const { req, res } = request({
      quizId: 'id',
      userIndex: 0,
      userAnswer: 'A',
    })
    await handler(req, res)
    expect(res.statusCode).toBe(404)
    expect(res._getJSONData()).not.toHaveProperty('grade')
  })

  it.each(['multiple_choice', 'written'])(
    'blocks forged results via the legacy save route (%s)',
    async (questionType) => {
      const { req, res } = request({
        id: 'fake',
        question: 'fake',
        userAnswer: 'A',
        correct: true,
        questionType,
      })
      await saveHandler(req, res)
      expect(res.statusCode).toBe(400)
      expect(query).not.toHaveBeenCalled()
    }
  )
})
