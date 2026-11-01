import { randomUUID } from 'crypto'
import type {
  GeneratedQuizMemory,
  QuizHistoryItem,
  WrittenAssessmentLevel,
} from '@/features/stores/home'
import { ensureSchema, getPool, query } from './db'
import { getLessonByDatasetId } from '@/config/lessons'

export class QuizError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

const responseTimeMs = (issuedAt: string | Date | null | undefined) => {
  if (!issuedAt) return undefined
  const elapsed = Date.now() - new Date(issuedAt).getTime()
  return Number.isFinite(elapsed) && elapsed >= 0
    ? Math.min(elapsed, 24 * 60 * 60 * 1000)
    : undefined
}

// Only call this with output received from Dify, never with browser-supplied data.
export function parseServerQuiz(
  text: string,
  parsed: any
): GeneratedQuizMemory | null {
  const question =
    parsed?.public?.question ??
    parsed?.question ??
    text
      .match(/【問題】\s*([\s\S]*?)(?=【選択肢】|正解[:：]|解説[:：]|$)/)?.[1]
      ?.trim()
  const choices =
    parsed?.public?.choices ??
    parsed?.choices ??
    text
      .match(/【選択肢】\s*([\s\S]*?)(?=正解[:：]|解説[:：]|$)/)?.[1]
      ?.split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[A-DＡ-Ｄ1-4][.)．、:：\s]+/u, '').trim())
  const type = parsed?.questionType ?? parsed?.question_type ?? parsed?.format
  if (['written', 'descriptive', 'free_text', 'short_answer'].includes(type))
    return null
  if (!Array.isArray(choices) || choices.length === 0) return null
  if (
    typeof question !== 'string' ||
    !question.trim() ||
    choices.length !== 4 ||
    choices.some((choice) => typeof choice !== 'string' || !choice.trim())
  ) {
    throw new QuizError(
      502,
      '問題の形式を確認できませんでした。もう一度問題を生成してください。'
    )
  }
  const answer =
    parsed?.answer ??
    parsed?.correctAnswer ??
    parsed?.secret?.answer ??
    text.match(/正解[:：]\s*([^\n]+)/)?.[1]?.trim()
  let answerIndex =
    parsed?.answerIndex ??
    parsed?.correctIndex ??
    parsed?.secret?.answerIndex ??
    parsed?.secret?.correctIndex
  if (answerIndex === undefined && typeof answer === 'string') {
    const normalized = answer.normalize('NFKC').trim()
    const label = normalized
      .match(/^([A-D1-4])(?:[.)、:：\s]|$)/i)?.[1]
      ?.toUpperCase()
    if (label)
      answerIndex = /^[A-D]$/.test(label)
        ? label.charCodeAt(0) - 65
        : Number(label) - 1
    else
      answerIndex = choices.findIndex((choice) => choice.trim() === normalized)
  }
  if (
    !Number.isInteger(answerIndex) ||
    answerIndex < 0 ||
    answerIndex >= choices.length
  ) {
    throw new QuizError(
      502,
      '正答を確認できませんでした。もう一度問題を生成してください。'
    )
  }
  const progress = text.match(/【\s*(\d+)\s*\/\s*(\d+)\s*問目\s*】/)
  return {
    rawText: text,
    questionType: 'multiple_choice',
    question: question.trim(),
    choices,
    answerIndex,
    answer: choices[answerIndex],
    explanation: String(
      parsed?.explanation ??
        parsed?.secret?.explanation ??
        text.match(/解説[:：]\s*([\s\S]+)$/)?.[1]?.trim() ??
        ''
    ),
    quizIndex:
      parsed?.quizIndex ??
      parsed?.quizIndexNext ??
      parsed?.questionIndex ??
      parsed?.questionNo ??
      (progress ? Number(progress[1]) : undefined),
    total:
      parsed?.total ??
      parsed?.totalNext ??
      (progress ? Number(progress[2]) : undefined),
    awaitingAnswer: true,
    updatedAt: new Date().toISOString(),
  }
}

export function publicQuiz(memory: GeneratedQuizMemory): GeneratedQuizMemory {
  const {
    serverQuizId,
    questionPoolId,
    learningSessionId,
    question,
    choices,
    quizIndex,
    total,
    difficultyLevel,
    questionGroup,
    understandSkill,
  } = memory
  const questionType =
    memory.questionType === 'written' ? 'written' : 'multiple_choice'
  return {
    serverQuizId,
    questionPoolId,
    learningSessionId,
    lessonId: memory.lessonId,
    questionType,
    understandSkill,
    question,
    choices: questionType === 'multiple_choice' ? choices : undefined,
    quizIndex,
    total,
    difficultyLevel,
    questionGroup,
    rawText:
      questionType === 'written'
        ? ['【記述問題】', question].join('\n')
        : [
            '【問題】',
            question,
            '【選択肢】',
            ...(choices || []).map(
              (choice, i) => `${String.fromCharCode(65 + i)}. ${choice}`
            ),
          ].join('\n'),
    awaitingAnswer: true,
    updatedAt: memory.updatedAt,
  }
}

export async function issueQuiz(userId: string, memory: GeneratedQuizMemory) {
  const isWritten = memory.questionType === 'written'
  const invalidMultipleChoice =
    !isWritten &&
    (!memory.choices ||
      memory.choices.length !== 4 ||
      !Number.isInteger(memory.answerIndex) ||
      memory.answerIndex! < 0 ||
      memory.answerIndex! >= memory.choices.length)
  const invalidWritten = isWritten && !String(memory.answer || '').trim()
  if (!memory.question?.trim() || invalidMultipleChoice || invalidWritten) {
    throw new QuizError(
      502,
      '正答を確認できませんでした。もう一度問題を生成してください。'
    )
  }
  const serverQuizId = randomUUID()
  const snapshot = { ...memory, serverQuizId }
  await query(
    `INSERT INTO issued_quizzes (id, user_id, quiz, learning_session_id)
     VALUES ($1, $2, $3, $4)`,
    [
      serverQuizId,
      userId,
      JSON.stringify(snapshot),
      memory.learningSessionId || null,
    ]
  )
  return publicQuiz(snapshot)
}

export async function getIssuedQuizForGrading(
  userId: string,
  serverQuizId: string
): Promise<{
  quiz: GeneratedQuizMemory
  gradedResult: any | null
} | null> {
  const result = await query<{
    quiz: GeneratedQuizMemory
    graded_result: any | null
  }>(
    'SELECT quiz, graded_result FROM issued_quizzes WHERE id = $1 AND user_id = $2 LIMIT 1',
    [serverQuizId, userId]
  )
  const row = result.rows[0]
  return row
    ? { quiz: row.quiz, gradedResult: row.graded_result || null }
    : null
}

export async function getIssuedQuiz(
  userId: string,
  serverQuizId: string
): Promise<GeneratedQuizMemory | null> {
  const result = await query<{ quiz: GeneratedQuizMemory }>(
    'SELECT quiz FROM issued_quizzes WHERE id = $1 AND user_id = $2 LIMIT 1',
    [serverQuizId, userId]
  )
  const quiz = result.rows[0]?.quiz
  return quiz ? publicQuiz(quiz) : null
}

export function buildServerGrade(
  quiz: GeneratedQuizMemory,
  userIndex: number,
  userAnswer: string
) {
  const correctIndex = quiz.answerIndex!
  const correct = userIndex === correctIndex
  return {
    type: 'grade' as const,
    answerStatus: (correct ? 'correct' : 'incorrect') as
      | 'correct'
      | 'incorrect',
    serverQuizId: quiz.serverQuizId,
    correct,
    correctIndex,
    userIndex,
    userAnswer,
    emotion: (correct ? 'happy' : 'sweat') as 'happy' | 'sweat',
    message: '',
    explanation: quiz.explanation || '',
    correctAnswer: `${String.fromCharCode(65 + correctIndex)}. ${quiz.choices![correctIndex]}`,
  }
}

export async function revealQuizAnswer(userId: string, quizId: string) {
  await ensureSchema()
  const db = await getPool().connect()
  try {
    await db.query('BEGIN')
    const result = await db.query<{
      quiz: GeneratedQuizMemory
      graded_result: any | null
    }>(
      'SELECT quiz, graded_result FROM issued_quizzes WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [quizId, userId]
    )
    const row = result.rows[0]
    if (!row)
      throw new QuizError(
        404,
        '問題が見つかりません。新しく問題を生成してください。'
      )
    if (row.quiz.questionType === 'written' || !row.quiz.choices?.length)
      throw new QuizError(400, 'この問題は4択問題ではありません。')

    if (row.graded_result) {
      if (row.graded_result.grade?.answerStatus !== 'unanswered')
        throw new QuizError(409, 'この問題は回答済みです。')
      await db.query('COMMIT')
      return { ...row.graded_result, quiz: row.quiz }
    }

    const correctIndex = row.quiz.answerIndex
    if (
      !Number.isInteger(correctIndex) ||
      correctIndex! < 0 ||
      correctIndex! >= row.quiz.choices.length
    ) {
      throw new QuizError(500, '正答情報を確認できませんでした。')
    }

    const grade = {
      type: 'grade' as const,
      answerStatus: 'unanswered' as const,
      serverQuizId: quizId,
      correct: false,
      correctIndex: correctIndex!,
      userIndex: null,
      userAnswer: 'ー',
      emotion: 'neutral' as const,
      message: '',
      explanation: row.quiz.explanation || '',
      correctAnswer: `${String.fromCharCode(65 + correctIndex!)}. ${row.quiz.choices[correctIndex!]}`,
    }
    const storedResult = { grade }
    await db.query(
      'UPDATE issued_quizzes SET graded_result = $1 WHERE id = $2 AND user_id = $3',
      [JSON.stringify(storedResult), quizId, userId]
    )
    await db.query('COMMIT')
    return { ...storedResult, quiz: row.quiz }
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  } finally {
    db.release()
  }
}

export async function gradeQuiz(
  userId: string,
  quizId: string,
  userIndex: number,
  userAnswer: string
) {
  await ensureSchema()
  const db = await getPool().connect()
  try {
    await db.query('BEGIN')
    // Lock the issued question so double clicks and retries create just one attempt.
    const result = await db.query<{
      quiz: GeneratedQuizMemory
      graded_result: any
      created_at: string
    }>(
      'SELECT quiz, graded_result, created_at FROM issued_quizzes WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [quizId, userId]
    )
    const row = result.rows[0]
    if (!row)
      throw new QuizError(
        404,
        '問題が見つかりません。新しく問題を生成してください。'
      )
    if (
      !Number.isInteger(userIndex) ||
      userIndex < 0 ||
      userIndex >= (row.quiz.choices?.length || 0)
    ) {
      throw new QuizError(400, '選択肢を確認してください。')
    }
    if (row.graded_result) {
      if (row.graded_result.grade.userIndex !== userIndex)
        throw new QuizError(
          409,
          'この問題は回答済みです。画面を更新してください。'
        )
      await db.query('COMMIT')
      return row.graded_result as {
        grade: ReturnType<typeof buildServerGrade>
        attempt: QuizHistoryItem
      }
    }
    const quiz = row.quiz
    const lessonId =
      quiz.lessonId ||
      getLessonByDatasetId(quiz.sourceDatasetId)?.id ||
      'legacy'
    const grade = buildServerGrade(quiz, userIndex, userAnswer)
    const attempt: QuizHistoryItem = {
      id: quizId,
      questionPoolId: quiz.questionPoolId,
      learningSessionId: quiz.learningSessionId,
      questionType: 'multiple_choice',
      understandSkill: quiz.understandSkill,
      question: quiz.question!,
      choices: quiz.choices,
      quizIndex: quiz.quizIndex,
      total: quiz.total,
      difficultyLevel: quiz.difficultyLevel,
      questionGroup: quiz.questionGroup,
      correctIndex: grade.correctIndex,
      correctAnswer: grade.correctAnswer,
      userAnswer,
      userIndex,
      correct: grade.correct,
      responseTimeMs: responseTimeMs(row.created_at),
      explanation: grade.explanation,
      aiOutput: JSON.stringify(grade),
      answeredAt: new Date().toISOString(),
    }
    await db.query(
      `INSERT INTO quiz_attempts
      (id, user_id, lesson_id, question_pool_id, learning_session_id, understand_skill, question, question_type, choices, quiz_index, total_questions,
       difficulty_level, question_group, correct_index, correct_answer, user_answer, user_index,
       is_correct, assessment_level, score, response_time_ms, explanation, ai_output, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [
        attempt.id,
        userId,
        lessonId,
        attempt.questionPoolId ?? null,
        attempt.learningSessionId ?? null,
        attempt.understandSkill ?? null,
        attempt.question,
        attempt.questionType,
        JSON.stringify(attempt.choices),
        attempt.quizIndex ?? null,
        attempt.total ?? null,
        attempt.difficultyLevel ?? null,
        attempt.questionGroup ?? null,
        attempt.correctIndex,
        attempt.correctAnswer,
        userAnswer,
        userIndex,
        attempt.correct,
        null,
        null,
        attempt.responseTimeMs ?? null,
        attempt.explanation,
        attempt.aiOutput,
        attempt.answeredAt,
      ]
    )
    const response = { grade, attempt }
    await db.query(
      'UPDATE issued_quizzes SET graded_result = $1 WHERE id = $2 AND user_id = $3',
      [JSON.stringify(response), quizId, userId]
    )
    await db.query('COMMIT')
    return response
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  } finally {
    db.release()
  }
}

export type WrittenGradeEvaluation = {
  correct: boolean
  score?: number
  assessmentLevel?: WrittenAssessmentLevel
  message?: string
  explanation: string
  aiOutput: string
}

export async function saveWrittenQuizGrade(
  userId: string,
  quizId: string,
  userAnswer: string,
  evaluation: WrittenGradeEvaluation
) {
  await ensureSchema()
  const db = await getPool().connect()
  try {
    await db.query('BEGIN')
    const result = await db.query<{
      quiz: GeneratedQuizMemory
      graded_result: any
      created_at: string
    }>(
      'SELECT quiz, graded_result, created_at FROM issued_quizzes WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [quizId, userId]
    )
    const row = result.rows[0]
    if (!row)
      throw new QuizError(
        404,
        '問題が見つかりません。新しく問題を生成してください。'
      )
    if (row.quiz.questionType !== 'written')
      throw new QuizError(400, 'この問題は記述問題ではありません。')
    if (row.graded_result) {
      if (row.graded_result.attempt?.userAnswer !== userAnswer)
        throw new QuizError(
          409,
          'この問題は回答済みです。画面を更新してください。'
        )
      await db.query('COMMIT')
      return row.graded_result
    }

    const quiz = row.quiz
    const lessonId =
      quiz.lessonId ||
      getLessonByDatasetId(quiz.sourceDatasetId)?.id ||
      'legacy'
    const assessmentLevel: WrittenAssessmentLevel =
      evaluation.assessmentLevel ||
      (typeof evaluation.score === 'number'
        ? evaluation.score >= 80
          ? 'understood'
          : evaluation.score >= 40
            ? 'partial'
            : 'review'
        : evaluation.correct
          ? 'understood'
          : 'review')
    const grade = {
      type: 'grade' as const,
      answerStatus: (assessmentLevel === 'understood'
        ? 'correct'
        : 'incorrect') as 'correct' | 'incorrect',
      serverQuizId: quiz.serverQuizId,
      correct: assessmentLevel === 'understood',
      score: evaluation.score,
      assessmentLevel,
      correctIndex: null,
      userIndex: null,
      userAnswer,
      emotion: 'neutral' as const,
      message: evaluation.message || '',
      explanation: evaluation.explanation,
      correctAnswer: quiz.answer || '',
    }
    const attempt: QuizHistoryItem = {
      id: quizId,
      questionPoolId: quiz.questionPoolId,
      learningSessionId: quiz.learningSessionId,
      questionType: 'written',
      understandSkill: quiz.understandSkill,
      question: quiz.question!,
      choices: undefined,
      quizIndex: quiz.quizIndex,
      total: quiz.total,
      difficultyLevel: quiz.difficultyLevel,
      questionGroup: quiz.questionGroup,
      correctIndex: undefined,
      correctAnswer: grade.correctAnswer,
      userAnswer,
      userIndex: null,
      correct: grade.correct,
      assessmentLevel,
      score: evaluation.score,
      responseTimeMs: responseTimeMs(row.created_at),
      explanation: grade.explanation,
      aiOutput: evaluation.aiOutput,
      answeredAt: new Date().toISOString(),
    }
    await db.query(
      `INSERT INTO quiz_attempts
      (id, user_id, lesson_id, question_pool_id, learning_session_id, understand_skill, question, question_type, choices, quiz_index, total_questions,
       difficulty_level, question_group, correct_index, correct_answer, user_answer, user_index,
       is_correct, assessment_level, score, response_time_ms, explanation, ai_output, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [
        attempt.id,
        userId,
        lessonId,
        attempt.questionPoolId ?? null,
        attempt.learningSessionId ?? null,
        attempt.understandSkill ?? null,
        attempt.question,
        attempt.questionType,
        null,
        attempt.quizIndex ?? null,
        attempt.total ?? null,
        attempt.difficultyLevel ?? null,
        attempt.questionGroup ?? null,
        null,
        attempt.correctAnswer,
        userAnswer,
        null,
        attempt.correct,
        attempt.assessmentLevel,
        attempt.score ?? null,
        attempt.responseTimeMs ?? null,
        attempt.explanation,
        attempt.aiOutput,
        attempt.answeredAt,
      ]
    )
    const response = { grade, attempt }
    await db.query(
      'UPDATE issued_quizzes SET graded_result = $1 WHERE id = $2 AND user_id = $3',
      [JSON.stringify(response), quizId, userId]
    )
    await db.query('COMMIT')
    return response
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  } finally {
    db.release()
  }
}
