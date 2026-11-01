/** @jest-environment node */
import { evaluateWrittenQuizAnswer } from '@/lib/server/writtenQuizGrading'

describe('written quiz grading', () => {
  const originalFetch = global.fetch
  const originalKey = process.env.DIFY_KEY
  const originalUrl = process.env.DIFY_URL

  afterEach(() => {
    global.fetch = originalFetch
    process.env.DIFY_KEY = originalKey
    process.env.DIFY_URL = originalUrl
    jest.restoreAllMocks()
  })

  it('accepts a different valid real-life example for exemplify questions', async () => {
    process.env.DIFY_KEY = 'test-key'
    process.env.DIFY_URL = 'https://example.test/v1'
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: JSON.stringify({
          assessmentLevel: 'understood',
          correct: true,
          score: 90,
          explanation: '教材の条件と結びつけて説明できています。',
        }),
      }),
    }) as jest.Mock

    await evaluateWrittenQuizAnswer(
      'learner-1',
      {
        rawText: '身近な場面から例を考えてみよう。',
        question: '身近な場面から例を考えてみよう。',
        questionType: 'written',
        understandSkill: 'exemplify',
        answer: 'ブラウザを起動する場面。',
        explanation: '動作中のプログラムがプロセスです。',
        updatedAt: '2026-10-16T00:00:00.000Z',
      },
      '音楽アプリを動かしている場面。実行中だから。'
    )

    const request = JSON.parse(
      String((global.fetch as jest.Mock).mock.calls[0][1].body)
    )
    expect(request.query).toContain(
      '模範回答の具体例だけを唯一の正解にしないでください。'
    )
    expect(request.query).toContain('学習者が自分で考えた実生活・身近な場面')
    expect(request.query).toContain('教材のどの条件に当てはまるか')
  })
})
