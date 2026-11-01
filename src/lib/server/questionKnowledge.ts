import configuredSources from '@/config/questionKnowledge.json'
import { lessons } from '@/config/lessons'
import type { QuestionKnowledgeSource } from '@/features/questionPool/types'

export const questionKnowledgeSources: QuestionKnowledgeSource[] =
  configuredSources

const referenceKnowledgeIds = new Set(
  lessons.flatMap((lesson) => lesson.referenceDatasetIds || [])
)

export const selectableQuestionKnowledgeSources =
  questionKnowledgeSources.filter(
    (source) => !referenceKnowledgeIds.has(source.id)
  )

// The browser may select only a registered source, never an arbitrary dataset.
export function getQuestionKnowledge(
  id?: string
): QuestionKnowledgeSource | undefined {
  return id === undefined
    ? selectableQuestionKnowledgeSources[0]
    : questionKnowledgeSources.find((source) => source.id === id)
}
