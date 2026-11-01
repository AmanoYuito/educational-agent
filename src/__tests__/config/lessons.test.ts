/** @jest-environment node */
import {
  enabledLessons,
  getLessonByDatasetId,
  getLessonById,
} from '@/config/lessons'
import {
  getQuestionKnowledge,
  selectableQuestionKnowledgeSources,
} from '@/lib/server/questionKnowledge'

describe('lesson configuration', () => {
  it('registers the third and fourth lessons as separate learning targets', () => {
    expect(enabledLessons.map((lesson) => lesson.id)).toEqual([
      'computer-systems-2-03',
      'computer-systems-2-04',
    ])

    const lesson3 = getLessonById('computer-systems-2-03')
    const lesson4 = getLessonById('computer-systems-2-04')

    expect(lesson3?.datasetId).toBe('af7274e8-81ab-47de-ba0f-75700f99e89f')
    expect(lesson4).toMatchObject({
      lessonName: '第4回',
      materialPath: '/materials/computer-systems-2/lesson-04/material.pdf',
      datasetId: '09b9b1b2-95c4-4c63-b5a7-95fc23a44721',
      referenceDatasetIds: ['a4c88fb6-23f5-4d4a-89f0-fa2c51f7253a'],
    })
    expect(lesson3?.datasetId).not.toBe(lesson4?.datasetId)
  })

  it('resolves each question knowledge dataset to its own lesson', () => {
    expect(
      getLessonByDatasetId('af7274e8-81ab-47de-ba0f-75700f99e89f')?.id
    ).toBe('computer-systems-2-03')
    expect(
      getLessonByDatasetId('09b9b1b2-95c4-4c63-b5a7-95fc23a44721')?.id
    ).toBe('computer-systems-2-04')
  })

  it('offers slide datasets for new questions while retaining old dataset labels', () => {
    const ids = selectableQuestionKnowledgeSources.map((source) => source.id)
    expect(ids).toContain('af7274e8-81ab-47de-ba0f-75700f99e89f')
    expect(ids).toContain('09b9b1b2-95c4-4c63-b5a7-95fc23a44721')
    expect(ids).not.toContain('29d449a2-dcd6-4b37-b81f-7ac210f7e8dc')
    expect(ids).not.toContain('77c078e6-38c1-4037-86cd-c3b0591a7970')
    expect(
      getQuestionKnowledge('77c078e6-38c1-4037-86cd-c3b0591a7970')?.name
    ).toContain('旧')
  })
})
