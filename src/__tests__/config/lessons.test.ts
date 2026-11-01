/** @jest-environment node */
import {
  enabledLessons,
  getLessonByDatasetId,
  getLessonById,
} from '@/config/lessons'

describe('lesson configuration', () => {
  it('registers the third and fourth lessons as separate learning targets', () => {
    expect(enabledLessons.map((lesson) => lesson.id)).toEqual([
      'computer-systems-2-03',
      'computer-systems-2-04',
    ])

    const lesson3 = getLessonById('computer-systems-2-03')
    const lesson4 = getLessonById('computer-systems-2-04')

    expect(lesson3?.datasetId).toBe('77c078e6-38c1-4037-86cd-c3b0591a7970')
    expect(lesson4).toMatchObject({
      lessonName: '第4回',
      materialPath: '/materials/computer-systems-2/lesson-04/material.pdf',
      datasetId: '6bc9b51b-f22e-49b3-bdfa-54021d5e9d7a',
      referenceDatasetIds: ['a4c88fb6-23f5-4d4a-89f0-fa2c51f7253a'],
    })
    expect(lesson3?.datasetId).not.toBe(lesson4?.datasetId)
  })

  it('resolves each question knowledge dataset to its own lesson', () => {
    expect(
      getLessonByDatasetId('77c078e6-38c1-4037-86cd-c3b0591a7970')?.id
    ).toBe('computer-systems-2-03')
    expect(
      getLessonByDatasetId('6bc9b51b-f22e-49b3-bdfa-54021d5e9d7a')?.id
    ).toBe('computer-systems-2-04')
  })
})
