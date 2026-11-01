import type { QuizSource } from '@/features/messages/quizLearning'

// Only use server-selected material or Dify retrieval metadata. Never read
// source claims from the LLM's generated quiz JSON or the learner's request.
export function retrievalSources(metadata: unknown): QuizSource[] {
  const resources = (metadata as { retriever_resources?: unknown })
    ?.retriever_resources
  if (!Array.isArray(resources)) return []
  const seen = new Set<string>()
  return resources
    .flatMap((item): QuizSource[] => {
      if (!item || typeof item.content !== 'string' || !item.content.trim())
        return []
      const content = item.content.trim().slice(0, 20000)
      if (seen.has(content)) return []
      seen.add(content)
      return [
        {
          documentName:
            typeof item.document_name === 'string'
              ? item.document_name.slice(0, 200)
              : '参照教材',
          content,
          kind: 'retrieval',
        },
      ]
    })
    .slice(0, 5)
}

export function savedMaterialSource(
  content: string | null | undefined
): QuizSource[] {
  if (!content?.trim()) return []
  return [
    {
      documentName:
        content.match(/^教材[:：]\s*([^\n]+)/)?.[1] || '保存された教材',
      content: content.trim().slice(0, 20000),
      kind: 'saved',
    },
  ]
}
