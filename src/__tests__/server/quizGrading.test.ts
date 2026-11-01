/** @jest-environment node */
import {
  buildServerGrade,
  getIssuedQuiz,
  gradeQuiz,
  issueQuiz,
  parseServerQuiz,
  publicQuiz,
  revealQuizAnswer,
  saveWrittenQuizGrade,
} from '@/lib/server/quizGrading'
import { ensureSchema, getPool, query } from '@/lib/server/db'

jest.mock('@/lib/server/db', () => ({
  ensureSchema: jest.fn(),
  getPool: jest.fn(),
  query: jest.fn(),
}))

const source = {
  type: 'quiz',
  public: {
    question: '送信プロトコルは？',
    choices: ['POP3', 'SMTP', 'HTTP', 'FTP'],
  },
  answerIndex: 1,
  answer: 'SMTP',
  explanation: '送信はSMTPです。',
}
const quiz = () => parseServerQuiz(JSON.stringify(source), source)!

describe('server-owned quiz grading', () => {
  beforeEach(() => jest.clearAllMocks())

  it('parses the current Dify flow output', () => {
    expect(quiz()).toMatchObject({
      question: source.public.question,
      choices: source.public.choices,
      answerIndex: 1,
      explanation: source.explanation,
    })
  })

  it.each(['B', 'Ｂ', '2', 'B. SMTP', 'SMTP'])(
    'resolves answer %s when no index is present',
    (answer) => {
      expect(
        parseServerQuiz('quiz', { ...source, answerIndex: undefined, answer })
          ?.answerIndex
      ).toBe(1)
    }
  )

  it('parses plain-text quizzes without retaining the answer in the public payload', () => {
    const parsed = parseServerQuiz(
      '【1/3問目】\n【問題】\n送信は？\n【選択肢】\nA. POP3\nB. SMTP\nC. HTTP\nD. FTP\n正解：B\n解説：送信はSMTPです。',
      null
    )!
    expect(parsed).toMatchObject({ quizIndex: 1, total: 3, answerIndex: 1 })
    const safe = publicQuiz(parsed)
    expect(safe).not.toHaveProperty('answer')
    expect(safe).not.toHaveProperty('answerIndex')
    expect(safe).not.toHaveProperty('explanation')
    expect(safe.rawText).not.toContain('正解')
    expect(safe.rawText).not.toContain('解説')
  })

  it.each([-1, 4, 1.5, '1', null])(
    'rejects an invalid correct index: %s',
    (answerIndex) => {
      expect(() =>
        parseServerQuiz('quiz', { ...source, answerIndex, answer: undefined })
      ).toThrow()
    }
  )

  it('rejects a quiz with no resolvable correct answer rather than marking it wrong', () => {
    expect(() =>
      parseServerQuiz('quiz', {
        ...source,
        answerIndex: undefined,
        answer: 'unknown',
      })
    ).toThrow()
  })

  it('does not treat normal conversation or written questions as MCQs', () => {
    expect(parseServerQuiz('こんにちは', null)).toBeNull()
    expect(
      parseServerQuiz('説明してください', { questionType: 'written' })
    ).toBeNull()
  })

  it('stores the complete quiz with the authenticated owner and returns only public fields', async () => {
    const safe = await issueQuiz('owner', quiz())
    const [sql, params] = (query as jest.Mock).mock.calls[0]
    expect(sql).toContain('INSERT INTO issued_quizzes')
    expect(params[1]).toBe('owner')
    expect(JSON.parse(params[2]).answerIndex).toBe(1)
    expect(safe.serverQuizId).toBe(params[0])
    expect(safe).not.toHaveProperty('answerIndex')
    expect(safe).not.toHaveProperty('explanation')
  })

  it('issues a written question while keeping its model answer private', async () => {
    const safe = await issueQuiz('owner', {
      rawText: '理由を説明してください。',
      question: '理由を説明してください。',
      questionType: 'written',
      answer: '教材に基づく模範回答です。',
      explanation: '教材の該当箇所を説明します。',
      updatedAt: new Date().toISOString(),
    })
    const snapshot = JSON.parse((query as jest.Mock).mock.calls[0][1][2])
    expect(snapshot.answer).toBe('教材に基づく模範回答です。')
    expect(safe).toMatchObject({
      questionType: 'written',
      question: '理由を説明してください。',
      choices: undefined,
    })
    expect(safe).not.toHaveProperty('answer')
    expect(safe).not.toHaveProperty('explanation')
  })

  it('reloads an issued quiz only for its authenticated learner and keeps answers private', async () => {
    ;(query as jest.Mock).mockResolvedValue({
      rows: [{ quiz: { ...quiz(), serverQuizId: 'issued-1' } }],
    })
    const safe = await getIssuedQuiz('owner', 'issued-1')
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM issued_quizzes'),
      ['issued-1', 'owner']
    )
    expect(safe).toMatchObject({ serverQuizId: 'issued-1' })
    expect(safe).not.toHaveProperty('answer')
    expect(safe).not.toHaveProperty('answerIndex')
    expect(safe).not.toHaveProperty('explanation')
  })

  it('preserves the happy / sweat emotion mapping', () => {
    expect(buildServerGrade(quiz(), 1, 'B')).toMatchObject({
      answerStatus: 'correct',
      correct: true,
      emotion: 'happy',
      correctIndex: 1,
    })
    expect(buildServerGrade(quiz(), 0, 'A')).toMatchObject({
      answerStatus: 'incorrect',
      correct: false,
      emotion: 'sweat',
      correctIndex: 1,
    })
  })

  function database(row: any, failInsert = false) {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.startsWith('SELECT')) return { rows: row ? [row] : [] }
        if (failInsert && sql.startsWith('INSERT'))
          throw new Error('DB failure')
        return { rows: [] }
      }),
      release: jest.fn(),
    }
    ;(getPool as jest.Mock).mockReturnValue({
      connect: jest.fn().mockResolvedValue(client),
    })
    return client
  }

  it('grades from the locked database snapshot and commits the canonical history', async () => {
    const db = database({ quiz: quiz(), graded_result: null })
    const result = await gradeQuiz('owner', 'quiz-id', 0, 'A')
    expect(ensureSchema).toHaveBeenCalled()
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      ['quiz-id', 'owner']
    )
    expect(result.grade.correct).toBe(false)
    expect(result.attempt).toMatchObject({
      id: 'quiz-id',
      correct: false,
      correctIndex: 1,
      question: source.public.question,
    })
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO quiz_attempts'),
      expect.arrayContaining(['owner', false])
    )
    expect(db.query).toHaveBeenLastCalledWith('COMMIT')
    expect(db.release).toHaveBeenCalled()
  })

  it('returns the first result on a retry without inserting again', async () => {
    const previous = {
      grade: buildServerGrade(quiz(), 1, 'B'),
      attempt: { id: 'quiz-id' },
    }
    const db = database({ quiz: quiz(), graded_result: previous })
    expect(await gradeQuiz('owner', 'quiz-id', 1, 'B')).toEqual(previous)
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(
      false
    )
  })

  it('reveals the canonical answer as unanswered without adding an attempt', async () => {
    const db = database({
      quiz: { ...quiz(), serverQuizId: 'quiz-id' },
      graded_result: null,
    })
    const result = await revealQuizAnswer('owner', 'quiz-id')

    expect(result.grade).toMatchObject({
      answerStatus: 'unanswered',
      correct: false,
      correctIndex: 1,
      userIndex: null,
      userAnswer: 'ー',
      correctAnswer: 'B. SMTP',
      explanation: '送信はSMTPです。',
      emotion: 'neutral',
    })
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(
      false
    )
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE issued_quizzes SET graded_result'),
      [expect.any(String), 'quiz-id', 'owner']
    )
    expect(db.query).toHaveBeenLastCalledWith('COMMIT')
  })

  it('does not reveal an already answered quiz as unanswered', async () => {
    const db = database({
      quiz: quiz(),
      graded_result: { grade: { answerStatus: 'correct', userIndex: 1 } },
    })
    await expect(revealQuizAnswer('owner', 'quiz-id')).rejects.toMatchObject({
      status: 409,
    })
    expect(db.query).toHaveBeenLastCalledWith('ROLLBACK')
  })

  it('does not allow changing the answer after the first submission', async () => {
    const db = database({
      quiz: quiz(),
      graded_result: { grade: { userIndex: 1 } },
    })
    await expect(gradeQuiz('owner', 'quiz-id', 0, 'A')).rejects.toMatchObject({
      status: 409,
    })
    expect(db.query).toHaveBeenLastCalledWith('ROLLBACK')
  })

  it("rejects missing or other users' questions", async () => {
    const db = database(null)
    await expect(
      gradeQuiz('other-owner', 'quiz-id', 1, 'B')
    ).rejects.toMatchObject({ status: 404 })
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(
      false
    )
    expect(db.release).toHaveBeenCalled()
  })

  it.each([-1, 4, 0.5])('rejects invalid selected index %s', async (index) => {
    database({ quiz: quiz(), graded_result: null })
    await expect(
      gradeQuiz('owner', 'quiz-id', index, 'x')
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rolls back and releases the connection if history saving fails', async () => {
    const db = database({ quiz: quiz(), graded_result: null }, true)
    await expect(gradeQuiz('owner', 'quiz-id', 1, 'B')).rejects.toThrow(
      'DB failure'
    )
    expect(db.query).toHaveBeenLastCalledWith('ROLLBACK')
    expect(db.release).toHaveBeenCalled()
  })

  it('stores a Dify-evaluated written answer in the same attempt history', async () => {
    const writtenQuiz = {
      rawText: '理由を説明してください。',
      serverQuizId: 'written-id',
      questionPoolId: 'pool-written',
      lessonId: 'lesson-1',
      question: '理由を説明してください。',
      questionType: 'written' as const,
      answer: '教材に基づく模範回答です。',
      explanation: '教材の該当箇所です。',
      updatedAt: new Date().toISOString(),
    }
    const db = database({ quiz: writtenQuiz, graded_result: null })
    const result = await saveWrittenQuizGrade(
      'owner',
      'written-id',
      '自分の言葉による回答',
      {
        correct: true,
        score: 85,
        message: '要点を説明できています。',
        explanation: '必要な関係が含まれています。',
        aiOutput: '{"correct":true,"score":85}',
      }
    )
    expect(result.grade).toMatchObject({
      correct: true,
      score: 85,
      emotion: 'neutral',
      correctIndex: null,
      correctAnswer: '教材に基づく模範回答です。',
    })
    expect(result.attempt).toMatchObject({
      questionType: 'written',
      userIndex: null,
      correct: true,
    })
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO quiz_attempts'),
      expect.arrayContaining(['lesson-1', 'written', true])
    )
    expect(db.query).toHaveBeenLastCalledWith('COMMIT')
  })
})
