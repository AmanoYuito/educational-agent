export type QuestionKnowledgeSource = { id: string; name: string }

export type PoolQuestionType = 'multiple_choice' | 'written'
export type PoolBloomLevel = 'remember' | 'understand'
export type UnderstandSkill =
  | 'interpret'
  | 'exemplify'
  | 'classify'
  | 'summarize'
  | 'infer'
  | 'compare'
  | 'explain'

export const understandSkillLabels: Record<UnderstandSkill, string> = {
  interpret: '解釈する',
  exemplify: '例示する',
  classify: '分類する',
  summarize: '要約する',
  infer: '推測する',
  compare: '比較する',
  explain: '説明する',
}
export const poolQuestionTypeLabels = {
  multiple_choice: '4択問題',
  written: '記述問題',
}
export const poolBloomLevelLabels = {
  remember: '記憶（Remember）',
  understand: '理解（Understand）',
}

export type PoolGenerationRequest = {
  datasetId?: string
  questionType?: PoolQuestionType
  bloomLevel?: PoolBloomLevel
  understandSkill?: UnderstandSkill
  difficultyLevel?: number
  evaluation: { runLabel: string; modelLabel: string; notes: string }
  excludedSourceIds?: string[]
  rejectedSourceIds?: string[]
  variantBase?: {
    familyId: string
    question: string
    correctAnswer: string
    wrongAnswers: string[]
    sourceContext: string
    sourceDatasetId: string
    sourceDatasetName?: string
    sourceDocumentId?: string
    sourceDocumentName?: string
    sourceSegmentIds: string[]
    sourceSlideNumbers?: number[]
    questionType: PoolQuestionType
    understandSkill?: UnderstandSkill
    variantIndex: number
  }
}

export class PoolGenerationError extends Error {
  constructor(
    message: string,
    public retryable = false,
    public sourceIds: string[] = []
  ) {
    super(message)
    this.name = 'PoolGenerationError'
  }
}

export type GeneratedPoolDraft = {
  lessonId?: string
  sourceContext?: string
  sourceDatasetId?: string
  sourceDatasetName?: string
  sourceDocumentId?: string
  sourceDocumentName?: string
  sourceSegmentIds?: string[]
  sourceSlideNumbers?: number[]
  id: string
  question: string
  correctAnswer: string
  explanation: string
  aiOutput: string
  evaluationId?: string
  difficultyLevel?: number
  questionGroup?: string
  topic?: string
  variantFamilyId?: string
  variantIndex?: number
} & (
  | {
      questionType: 'multiple_choice'
      bloomLevel: 'remember'
      choices: string[]
      correctIndex: number
      wrongAnswers: string[]
    }
  | {
      questionType: 'written'
      bloomLevel: 'understand'
      understandSkill?: UnderstandSkill
      choices: []
      correctIndex: null
      wrongAnswers: []
    }
)
