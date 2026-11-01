import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QuizLearningSupport } from '@/components/quizLearningSupport'
import { getQuizExplanation } from '../../../app/lib/api/client'
jest.mock('../../../app/lib/api/client', () => ({
  getQuizExplanation: jest.fn(),
}))
describe('quiz learning controls', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getQuizExplanation as jest.Mock).mockResolvedValue({
      text: 'POP3は受信に使います。',
      basedOn: 'material',
    })
  })
  it('does not show the source material control', () => {
    render(<QuizLearningSupport quizId="old-quiz" graded />)
    expect(screen.queryByText('教材の根拠を見る')).not.toBeInTheDocument()
    expect(getQuizExplanation).not.toHaveBeenCalled()
  })
  it('explains an incorrect choice then allows a different explanation style', async () => {
    render(
      <QuizLearningSupport
        quizId="graded"
        graded
        incorrect
        autoExplain
        userLabel="B"
      />
    )
    expect(
      await screen.findByText('POP3は受信に使います。')
    ).toBeInTheDocument()
    expect(getQuizExplanation).toHaveBeenCalledWith('graded', 'mistake')
    fireEvent.click(screen.getByText('具体例で教えて'))
    await waitFor(() =>
      expect(getQuizExplanation).toHaveBeenCalledWith('graded', 'example')
    )
  })
  it('does not automatically generate or offer wrong-answer explanations for correct answers', () => {
    render(<QuizLearningSupport quizId="correct" graded autoExplain />)
    expect(getQuizExplanation).not.toHaveBeenCalled()
    expect(screen.queryByText('選んだ回答はなぜ違う？')).not.toBeInTheDocument()
  })
  it('uses written-answer wording without choice labels for a written question', async () => {
    render(
      <QuizLearningSupport
        quizId="written"
        graded
        incorrect
        questionType="written"
      />
    )
    expect(
      screen.getByRole('button', { name: '回答のどこを直せばよい？' })
    ).toBeInTheDocument()
    expect(screen.queryByText('選んだ回答はなぜ違う？')).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: '回答のどこを直せばよい？' })
    )
    expect(await screen.findByText('回答を見直そう')).toBeInTheDocument()
    expect(getQuizExplanation).toHaveBeenCalledWith('written', 'mistake')
  })
  it('keeps grading visible on explanation failure and offers retry', async () => {
    ;(getQuizExplanation as jest.Mock).mockRejectedValueOnce(
      new Error('offline')
    )
    render(<QuizLearningSupport quizId="failed" graded incorrect autoExplain />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '採点結果は保存されています'
    )
    fireEvent.click(screen.getByText('解説を再取得'))
    expect(
      await screen.findByText('POP3は受信に使います。')
    ).toBeInTheDocument()
  })
})
