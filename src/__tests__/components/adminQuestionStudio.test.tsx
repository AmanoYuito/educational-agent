import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { PoolGenerationError } from '@/features/questionPool/types'
import knowledgeSources from '@/config/questionKnowledge.json'
import { AdminQuestionStudio } from '@/components/adminQuestionStudio'
import { generatePoolQuestion } from '../../../app/lib/api/client'

jest.mock('../../../app/lib/api/client', () => ({
  generatePoolQuestion: jest.fn(),
}))
jest.mock('@/components/poolGenerationRecords', () => ({
  PoolGenerationRecords: () => <div>生成記録のCSV</div>,
}))
jest.mock('@/features/quizEvaluation/client', () => ({
  registerEvaluationResponse: jest.fn(),
  observeEvaluationDisplay: jest.fn(),
}))

const item = {
  id: 'draft1',
  questionType: 'multiple_choice',
  question: '生成した問題ですか？',
  choices: ['甲', '乙', '丙', '丁'],
  correctIndex: 1,
  correctAnswer: '乙',
  wrongAnswers: ['甲', '丙', '丁'],
  explanation: '説明です。',
  aiOutput: '{}',
}

const originalFetch = global.fetch

describe('batch model comparison', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stats: {
          total: 7,
          active: 7,
          multipleChoice: 4,
          writtenRemember: 2,
          writtenUnderstand: 1,
          writtenUnclassified: 0,
        },
        items: [],
      }),
    }) as any
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  it('shows the registered pool counts by question type', async () => {
    render(
      <AdminQuestionStudio
        username="admin"
        knowledgeSources={knowledgeSources}
      />
    )

    expect(await screen.findByText('4問')).toBeInTheDocument()
    expect(screen.getByText('2問', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('1問', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText(/登録数：7問/)).toBeInTheDocument()
  })

  it('requires only count and run/model labels and continues after a failed generation', async () => {
    ;(generatePoolQuestion as jest.Mock)
      .mockResolvedValueOnce({ item, evaluationId: 'record1' })
      .mockRejectedValueOnce(new Error('2問目の通信失敗'))
      .mockResolvedValueOnce({
        item: { ...item, id: 'draft3' },
        evaluationId: 'record3',
      })
    render(
      <AdminQuestionStudio
        username="admin"
        knowledgeSources={knowledgeSources}
      />
    )
    expect(screen.queryByLabelText('トピック')).not.toBeInTheDocument()
    expect(screen.queryByText('難易度と形式')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '問題プールへ保存' })
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('使用LLM（CSV用・手入力）'), {
      target: { value: 'model-a' },
    })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'まとめて問題を生成' }))
    expect(screen.getByRole('spinbutton')).toBeDisabled()
    await screen.findByText(
      /生成が完了しました。成功 2問・生成できなかった問題 1問/
    )
    expect(generatePoolQuestion).toHaveBeenCalledTimes(3)
    for (const [request] of (generatePoolQuestion as jest.Mock).mock.calls)
      expect(request).toEqual({
        datasetId: knowledgeSources[0].id,
        questionType: 'multiple_choice',
        difficultyLevel: 2,
        excludedSourceIds: [],
        rejectedSourceIds: [],
        evaluation: {
          runLabel: 'モデル比較1',
          modelLabel: 'model-a',
          notes: '',
        },
      })
    expect(screen.getByText('今回生成した問題（2問）')).toBeInTheDocument()
    expect(screen.getByText(/2問目の通信失敗/)).toBeInTheDocument()
  })
  it('locks written/Understand during retries and previews the model answer', async () => {
    ;(generatePoolQuestion as jest.Mock)
      .mockRejectedValueOnce(new PoolGenerationError('材料不足', true, ['old']))
      .mockResolvedValueOnce({
        item: {
          ...item,
          questionType: 'written',
          bloomLevel: 'understand',
          choices: [],
          correctIndex: null,
          correctAnswer: '教材に沿った模範回答です。',
        },
      })
    render(
      <AdminQuestionStudio
        username="admin"
        knowledgeSources={knowledgeSources}
      />
    )
    fireEvent.change(screen.getByLabelText('問題形式'), {
      target: { value: 'written' },
    })
    fireEvent.change(screen.getByLabelText('理解の問い方'), {
      target: { value: 'explain' },
    })
    fireEvent.change(screen.getByLabelText('使用LLM（CSV用・手入力）'), {
      target: { value: 'model-a' },
    })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'まとめて問題を生成' }))
    expect(screen.getByLabelText('問題形式')).toBeDisabled()
    expect(screen.getByLabelText('理解の問い方')).toBeDisabled()
    await screen.findByText('教材に沿った模範回答です。')
    expect(
      screen.getByRole('heading', { name: '模範回答' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    for (const [request] of (generatePoolQuestion as jest.Mock).mock.calls)
      expect(request).toMatchObject({
        questionType: 'written',
        bloomLevel: 'understand',
      })
    expect(screen.getByLabelText('問題形式')).not.toBeDisabled()
  })
  it('shows the understand-skill selector only for written questions', async () => {
    ;(generatePoolQuestion as jest.Mock).mockResolvedValue({ item })
    render(
      <AdminQuestionStudio
        username="admin"
        knowledgeSources={knowledgeSources}
      />
    )
    expect(screen.queryByLabelText('理解の問い方')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('問題形式'), {
      target: { value: 'written' },
    })
    fireEvent.change(screen.getByLabelText('理解の問い方'), {
      target: { value: 'compare' },
    })
    fireEvent.change(screen.getByLabelText('問題形式'), {
      target: { value: 'multiple_choice' },
    })
    expect(screen.queryByLabelText('理解の問い方')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('使用LLM（CSV用・手入力）'), {
      target: { value: 'model-a' },
    })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'まとめて問題を生成' }))
    await screen.findByText('今回生成した問題（1問）')
    expect(
      (generatePoolQuestion as jest.Mock).mock.calls[0][0]
    ).not.toHaveProperty('bloomLevel')
    expect(screen.queryByText(/4択問題 ·/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('問題形式'), {
      target: { value: 'written' },
    })
    expect(screen.getByLabelText('理解の問い方')).toHaveValue('compare')
  })
  it('validates run/model labels and the batch size before calling Dify', () => {
    render(
      <AdminQuestionStudio
        username="admin"
        knowledgeSources={knowledgeSources}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'まとめて問題を生成' }))
    expect(generatePoolQuestion).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('使用LLM（CSV用・手入力）'), {
      target: { value: 'model-a' },
    })
    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '101' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'まとめて問題を生成' }))
    expect(screen.getByRole('alert')).toHaveTextContent('1〜100')
    expect(generatePoolQuestion).not.toHaveBeenCalled()
  })
  it('retries material failures with a different source and carries batch exclusions forward', async () => {
    ;(generatePoolQuestion as jest.Mock)
      .mockRejectedValueOnce(
        new PoolGenerationError('材料不足', true, ['source-a'])
      )
      .mockResolvedValueOnce({ item, sourceIds: ['source-b'] })
      .mockResolvedValueOnce({
        item: { ...item, id: 'draft2' },
        sourceIds: ['source-c'],
      })
    render(
      <AdminQuestionStudio
        username="admin"
        knowledgeSources={knowledgeSources}
      />
    )
    fireEvent.change(screen.getByLabelText('使用LLM（CSV用・手入力）'), {
      target: { value: 'model-a' },
    })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'まとめて問題を生成' }))
    await screen.findByText(
      /成功 2問・生成できなかった問題 0問（追加の再試行 1回）/
    )
    const calls = (generatePoolQuestion as jest.Mock).mock.calls
    expect(calls[1][0]).toMatchObject({
      excludedSourceIds: ['source-a'],
      rejectedSourceIds: ['source-a'],
    })
    expect(calls[2][0]).toMatchObject({
      excludedSourceIds: ['source-a', 'source-b'],
      rejectedSourceIds: [],
    })
  })
  it('stops after three material failures for one requested question', async () => {
    ;(generatePoolQuestion as jest.Mock).mockRejectedValue(
      new PoolGenerationError('材料不足', true, ['source-a'])
    )
    render(
      <AdminQuestionStudio
        username="admin"
        knowledgeSources={knowledgeSources}
      />
    )
    fireEvent.change(screen.getByLabelText('使用LLM（CSV用・手入力）'), {
      target: { value: 'model-a' },
    })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'まとめて問題を生成' }))
    await screen.findByText(
      /成功 0問・生成できなかった問題 1問（追加の再試行 2回）/
    )
    expect(generatePoolQuestion).toHaveBeenCalledTimes(3)
  })
  it('keeps the selected knowledge for retries and locks selection during generation', async () => {
    ;(generatePoolQuestion as jest.Mock)
      .mockRejectedValueOnce(
        new PoolGenerationError('材料不足', true, ['source-a'])
      )
      .mockResolvedValueOnce({ item, sourceIds: ['source-b'] })
    render(
      <AdminQuestionStudio
        username="admin"
        knowledgeSources={knowledgeSources}
      />
    )
    fireEvent.change(screen.getByLabelText('出題するナレッジ'), {
      target: { value: knowledgeSources[1].id },
    })
    fireEvent.change(screen.getByLabelText('使用LLM（CSV用・手入力）'), {
      target: { value: 'model-a' },
    })
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'まとめて問題を生成' }))
    expect(screen.getByLabelText('出題するナレッジ')).toBeDisabled()
    await screen.findByText(/成功 1問・生成できなかった問題 0問/)
    for (const [request] of (generatePoolQuestion as jest.Mock).mock.calls)
      expect(request.datasetId).toBe(knowledgeSources[1].id)
    fireEvent.change(screen.getByLabelText('出題するナレッジ'), {
      target: { value: knowledgeSources[0].id },
    })
    expect(
      screen.queryByText('今回生成した問題（1問）')
    ).not.toBeInTheDocument()
  })
})
