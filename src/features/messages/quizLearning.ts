/** Snapshots of material actually supplied to generation, not model-written citations. */
export type QuizSource = {
  documentName: string
  content: string
  kind: 'generation' | 'retrieval' | 'saved'
}
export type QuizExplanationKind = 'mistake' | 'simple' | 'example'
export type QuizSourceResponse = { sources: QuizSource[] }
export type QuizExplanationResponse = {
  text: string
  basedOn: 'material' | 'explanation'
  version?: number
}
