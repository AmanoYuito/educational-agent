import { tryParseDifyJson } from '@/features/messages/assistantMode'

describe('tryParseDifyJson', () => {
  it('連結されたJSONメッセージを出現順に返す', () => {
    const result = tryParseDifyJson(
      '{"type":"quiz","question":"Q"}{"type":"grade","correct":true}'
    )

    expect(result).toEqual([
      { type: 'quiz', question: 'Q' },
      { type: 'grade', correct: true },
    ])
  })

  it('answer内のエスケープ済みJSONを解析する', () => {
    const result = tryParseDifyJson(
      '{"answer":"{\\"type\\":\\"grade\\",\\"correct\\":false}"}'
    )

    expect(result).toEqual({ type: 'grade', correct: false })
  })

  it('同じJSONを重複して返さない', () => {
    const result = tryParseDifyJson('{"type":"quiz","question":"Q"}')

    expect(result).toEqual({ type: 'quiz', question: 'Q' })
  })

  it('通常の会話文はJSONメッセージとして扱わない', () => {
    expect(tryParseDifyJson('こんにちは')).toBeNull()
  })
})
