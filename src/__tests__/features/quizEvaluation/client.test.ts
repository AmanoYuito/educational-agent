import {
  observeEvaluationDisplay,
  registerEvaluationResponse,
  clearEvaluationSettings,
  loadEvaluationSettings,
  saveEvaluationSettings,
} from '@/features/quizEvaluation/client'
import { saveQuizEvaluationTiming } from '../../../../app/lib/api/client'

jest.mock('../../../../app/lib/api/client', () => ({
  saveQuizEvaluationTiming: jest.fn().mockResolvedValue(undefined),
}))

describe('actual question display timing', () => {
  let frames: FrameRequestCallback[]
  beforeEach(() => {
    jest.clearAllMocks()
    clearEvaluationSettings()
    frames = []
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => {
      frames.push(fn)
      return frames.length
    })
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  })
  afterEach(() => jest.restoreAllMocks())
  it('waits for rendering and records a given question only once', () => {
    registerEvaluationResponse('question', performance.now() - 100, 80, true)
    observeEvaluationDisplay('question')
    expect(saveQuizEvaluationTiming).toHaveBeenCalledTimes(1)
    frames.shift()!(0)
    expect(saveQuizEvaluationTiming).toHaveBeenCalledTimes(1)
    frames.shift()!(0)
    expect(saveQuizEvaluationTiming).toHaveBeenLastCalledWith('question', {
      displayMs: expect.any(Number),
    })
    observeEvaluationDisplay('question')
    expect(frames).toHaveLength(0)
    expect(saveQuizEvaluationTiming).toHaveBeenCalledTimes(2)
  })
  it('never labels API failures or restored history as displayed questions', () => {
    registerEvaluationResponse('failure', performance.now(), 20, false)
    observeEvaluationDisplay('failure')
    observeEvaluationDisplay('restored')
    expect(frames).toHaveLength(0)
    expect(saveQuizEvaluationTiming).toHaveBeenCalledTimes(1)
  })
  it('leaves hidden-tab display time unknown', () => {
    jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    registerEvaluationResponse('hidden', performance.now(), 20, true)
    observeEvaluationDisplay('hidden')
    expect(frames).toHaveLength(0)
    expect(saveQuizEvaluationTiming).toHaveBeenCalledTimes(1)
  })
  it('keeps measurement opt-in and clears settings on logout', () => {
    expect(loadEvaluationSettings()).toBeNull()
    saveEvaluationSettings({
      ownerId: 'admin',
      enabled: true,
      runLabel: 'r',
      modelLabel: 'm',
      notes: '',
    })
    expect(loadEvaluationSettings()?.enabled).toBe(true)
    clearEvaluationSettings()
    expect(loadEvaluationSettings()).toBeNull()
  })
})
