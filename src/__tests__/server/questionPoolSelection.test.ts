/** @jest-environment node */
import { query } from '@/lib/server/db'
import { issueQuiz } from '@/lib/server/quizGrading'
import {
  issueQuestionPoolItem,
  selectLearningSetQuestionPoolRow,
  selectQuestionPoolRow,
  type QuestionPoolRow,
} from '@/lib/server/questionPoolSelection'

jest.mock('@/lib/server/db', () => ({ query: jest.fn() }))
jest.mock('@/lib/server/quizGrading', () => ({ issueQuiz: jest.fn() }))

const row: QuestionPoolRow = {
  id: 'pool-1',
  lesson_id: 'lesson-1',
  question_type: 'multiple_choice',
  question_text: '送信に使うものはどれですか。',
  choices: ['POP3', 'SMTP', 'HTTP', 'FTP'],
  correct_index: 1,
  correct_answer: 'SMTP',
  wrong_answers: ['POP3', 'HTTP', 'FTP'],
  explanation: 'SMTPは送信に使います。',
  difficulty_level: 2,
  question_group: 'mail',
  topic: '電子メール',
  source_context: '教材: 電子メール\nSMTPは送信に使う。',
  source_dataset_id: 'dataset-1',
  source_dataset_name: '教材1',
  source_segment_ids: ['document-1:parent-chunk-1'],
}

describe('question pool selection', () => {
  beforeEach(() => jest.clearAllMocks())

  it('selects an active four-choice or written format at random within the lesson', async () => {
    ;(query as jest.Mock).mockResolvedValue({ rows: [row] })
    await expect(
      selectQuestionPoolRow({
        learnerId: 'learner-1',
        lessonId: 'lesson-1',
        datasetId: 'dataset-1',
      })
    ).resolves.toEqual(row)
    const [sql, params] = (query as jest.Mock).mock.calls[0]
    expect(sql).toContain("qp.question_type = 'multiple_choice'")
    expect(sql).toContain("qp.question_type = 'written'")
    expect(sql).toContain('chosen_type AS')
    expect(sql).toContain('qp.source_dataset_id = $1')
    expect(sql).toContain('qp.lesson_id = $2')
    expect(sql).toContain('qa.question_pool_id = candidate_pool.id')
    expect(sql).toContain('qa.is_correct = TRUE')
    expect(sql).toContain('last_attempt_source AS')
    expect(sql).toContain('previous_attempt.created_at DESC')
    expect(sql).toContain('jsonb_array_elements_text')
    expect(sql).toContain('attempted_pool.source_segment_ids')
    expect(params).toEqual(['dataset-1', 'lesson-1', 'learner-1'])
  })

  it('allows a used question again only after stricter pool passes are empty', async () => {
    ;(query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row] })

    await expect(
      selectLearningSetQuestionPoolRow({
        learnerId: 'learner-1',
        lessonId: 'lesson-1',
        datasetId: 'dataset-1',
        questionType: 'written',
        excludeQuestionPoolIds: ['pool-1'],
        excludeUnderstandSkills: ['explain'],
      })
    ).resolves.toEqual(row)

    expect(query).toHaveBeenCalledTimes(4)
    expect((query as jest.Mock).mock.calls[0][1]).toEqual([
      'dataset-1',
      'lesson-1',
      'learner-1',
      'written',
      ['pool-1'],
      ['explain'],
    ])
    expect((query as jest.Mock).mock.calls[3][1]).toEqual([
      'dataset-1',
      'lesson-1',
      'learner-1',
      'written',
    ])
  })

  it('issues from the saved server snapshot and returns public fields only', async () => {
    ;(issueQuiz as jest.Mock).mockResolvedValue({
      serverQuizId: 'issued-1',
      question: row.question_text,
      choices: row.choices,
    })
    const result = await issueQuestionPoolItem('learner-1', row)
    expect(issueQuiz).toHaveBeenCalledWith(
      'learner-1',
      expect.objectContaining({
        questionPoolId: 'pool-1',
        lessonId: 'lesson-1',
        answerIndex: 1,
        answer: 'SMTP',
        explanation: row.explanation,
      })
    )
    expect(result).toMatchObject({
      serverQuizId: 'issued-1',
      question: row.question_text,
      choices: row.choices,
    })
    expect(result).not.toHaveProperty('answer')
    expect(result).not.toHaveProperty('answerIndex')
    expect(result).not.toHaveProperty('explanation')
  })

  it('issues a written question without exposing its model answer', async () => {
    const writtenRow: QuestionPoolRow = {
      ...row,
      id: 'written-1',
      question_type: 'written',
      question_text: 'タイムスライスが短い場合の影響を説明してください。',
      choices: null,
      correct_index: null,
      correct_answer: '文脈切り替えが増え、オーバーヘッドが大きくなる。',
      wrong_answers: null,
    }
    ;(issueQuiz as jest.Mock).mockResolvedValue({
      serverQuizId: 'issued-written-1',
      questionType: 'written',
      question: writtenRow.question_text,
    })

    const result = await issueQuestionPoolItem('learner-1', writtenRow)
    expect(issueQuiz).toHaveBeenCalledWith(
      'learner-1',
      expect.objectContaining({
        questionType: 'written',
        answer: writtenRow.correct_answer,
        choices: undefined,
      })
    )
    expect(result).toMatchObject({
      serverQuizId: 'issued-written-1',
      questionType: 'written',
      question: writtenRow.question_text,
    })
    expect(result).not.toHaveProperty('correctAnswer')
    expect(result).not.toHaveProperty('explanation')
  })
})
