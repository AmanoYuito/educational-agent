import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { PoolGenerationRecords } from '@/components/poolGenerationRecords'
import {
  loadQuizEvaluations,
  downloadQuizEvaluations,
} from '../../../app/lib/api/client'
import knowledgeSources from '@/config/questionKnowledge.json'

jest.mock('../../../app/lib/api/client', () => ({
  loadQuizEvaluations: jest.fn(),
  downloadQuizEvaluations: jest.fn(),
}))
const record = {
  id: 'record',
  createdAt: '2026-09-25T01:00:00Z',
  runLabel: 'run',
  modelLabel: 'model',
  status: 'success',
  serverMs: 1000,
  usage: { totalTokens: 2, totalPrice: 0.01, currency: 'USD' },
  question: '教材7の問題',
  choices: ['選択肢1', '選択肢2', '選択肢3', '選択肢4'],
  inputs: {
    source_dataset_id: knowledgeSources[1].id,
    source_dataset_name: 'johokiso7',
  },
}
beforeEach(() => jest.resetAllMocks())
it('uses the selected dataset for both records and CSV, and displays choices', async () => {
  ;(loadQuizEvaluations as jest.Mock).mockResolvedValue([record])
  ;(downloadQuizEvaluations as jest.Mock).mockResolvedValue(undefined)
  render(
    <PoolGenerationRecords refreshKey={0} knowledge={knowledgeSources[1]} />
  )
  await screen.findByText('教材7の問題')
  expect(loadQuizEvaluations).toHaveBeenCalledWith(
    '',
    'question_pool',
    knowledgeSources[1].id
  )
  expect(screen.getByText('選択肢4')).toBeInTheDocument()
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: '生成記録のCSVをダウンロード' })
    )
  })
  expect(downloadQuizEvaluations).toHaveBeenCalledWith(
    '',
    'question_pool',
    knowledgeSources[1].id
  )
})
it('does not show a late response for a different dataset filter', async () => {
  let resolveOld!: (rows: unknown[]) => void
  ;(loadQuizEvaluations as jest.Mock)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        })
    )
    .mockResolvedValueOnce([])
  render(
    <PoolGenerationRecords refreshKey={0} knowledge={knowledgeSources[1]} />
  )
  fireEvent.change(screen.getByLabelText('記録のナレッジ'), {
    target: { value: 'unknown' },
  })
  await screen.findByText('まだ生成記録がありません。')
  await act(async () => resolveOld([record]))
  expect(screen.queryByText('教材7の問題')).not.toBeInTheDocument()
  expect(loadQuizEvaluations).toHaveBeenLastCalledWith(
    '',
    'question_pool',
    'unknown'
  )
})
it('shows written model answers and selected cognitive level without fake choices', async () => {
  ;(loadQuizEvaluations as jest.Mock).mockResolvedValue([
    {
      ...record,
      choices: [],
      correctAnswer: '受信者が用件を把握しやすくなるからです。',
      explanation: '教材に記載された件名の役割です。',
      inputs: {
        ...record.inputs,
        question_type: 'written',
        bloom_level: 'understand',
      },
    },
  ])
  render(
    <PoolGenerationRecords refreshKey={0} knowledge={knowledgeSources[1]} />
  )
  await screen.findByText('教材7の問題')
  expect(screen.getByText('記述問題 · 理解（Understand）')).toBeInTheDocument()
  expect(screen.getByText('模範回答')).toBeInTheDocument()
  expect(
    screen.getByText('受信者が用件を把握しやすくなるからです。')
  ).toBeInTheDocument()
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
})
it('does not assign a cognitive level to historical records', async () => {
  ;(loadQuizEvaluations as jest.Mock).mockResolvedValue([record])
  render(
    <PoolGenerationRecords refreshKey={0} knowledge={knowledgeSources[1]} />
  )
  await screen.findByText('教材7の問題')
  expect(screen.getByText('4択問題 · 認知レベル未記録')).toBeInTheDocument()
})
