export type LessonDefinition = {
  id: string
  courseId: string
  courseName: string
  lessonNumber: number
  lessonName: string
  title: string
  description: string
  materialPath: string
  materialLabel: string
  materialPageCount?: number
  datasetId: string
  datasetName: string
  /** 出題範囲は datasetId。補足資料は定義・説明の確認だけに使う。 */
  referenceDatasetIds?: string[]
  enabled: boolean
}

export const lessons: LessonDefinition[] = [
  {
    id: 'computer-systems-2-03',
    courseId: 'computer-systems-2',
    courseName: 'コンピュータシステム2',
    lessonNumber: 3,
    lessonName: '第3回',
    title: 'コンピュータシステム2：第3回',
    description: '授業資料を確認しながら、会話と問題演習に取り組みます。',
    materialPath: '/materials/computer-systems-2/lesson-03/material.pdf',
    materialLabel: 'コンシス第3回.pdf',
    materialPageCount: 38,
    datasetId: '77c078e6-38c1-4037-86cd-c3b0591a7970',
    datasetName: 'コンシス第3回',
    referenceDatasetIds: ['c619b5fb-e475-4184-9f3c-c04c693be07f'],
    enabled: true,
  },
  {
    id: 'computer-systems-2-04',
    courseId: 'computer-systems-2',
    courseName: 'コンピュータシステム2',
    lessonNumber: 4,
    lessonName: '第4回',
    title: 'コンピュータシステム2：第4回',
    description: '授業資料を確認しながら、会話と問題演習に取り組みます。',
    materialPath: '/materials/computer-systems-2/lesson-04/material.pdf',
    materialLabel: 'コンシス第4回.pdf',
    materialPageCount: 37,
    datasetId: '6bc9b51b-f22e-49b3-bdfa-54021d5e9d7a',
    datasetName: 'コンシス第4回.pdf',
    referenceDatasetIds: ['a4c88fb6-23f5-4d4a-89f0-fa2c51f7253a'],
    enabled: true,
  },
]

export const enabledLessons = lessons.filter((lesson) => lesson.enabled)

export const getLessonById = (lessonId: string | undefined) =>
  enabledLessons.find((lesson) => lesson.id === lessonId)

export const getLessonByDatasetId = (datasetId: string | undefined) =>
  enabledLessons.find((lesson) => lesson.datasetId === datasetId)
