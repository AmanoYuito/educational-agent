/** @jest-environment node */
import knowledgeSources from '@/config/questionKnowledge.json'
import {
  selectQuestionMaterial,
  selectQuestionMaterialBundle,
  slideNumbersFromMaterial,
} from '@/lib/server/questionMaterial'
import { fetchDifyKnowledgePage } from '../../../app/lib/api/client'

jest.mock('../../../app/lib/api/client', () => ({
  fetchDifyKnowledgePage: jest.fn(),
}))
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomInt: () => 0,
}))
const datasetId = knowledgeSources[0].id
const docId = '22222222-2222-4222-8222-222222222222'
const id = (n: number) =>
  `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`
const segment = (n: number, overrides = {}) => ({
  id: id(n),
  position: n,
  content: `本文${n}。` + '電子メールの送信にはSMTPを使用します。'.repeat(8),
  enabled: true,
  status: 'completed',
  ...overrides,
})
const doc = {
  id: docId,
  name: '教材',
  enabled: true,
  archived: false,
  indexing_status: 'completed',
}
const page = (data: unknown[], has_more = false) => ({ data, has_more })
const sourceId = (n: number) => `${docId}:${id(n)}`

describe('random material selection from real knowledge content', () => {
  it('extracts explicit slide numbers without guessing from unrelated page text', () => {
    expect(
      slideNumbersFromMaterial(
        'cs2-lesson-04-slide-13.md',
        '# 第4回 スライド13 共有資源'
      )
    ).toEqual([13])
    expect(
      slideNumbersFromMaterial('コンシス第4回.pdf', '共有資源について\n13')
    ).toEqual([])
    expect(
      slideNumbersFromMaterial(
        '資料.md',
        '# 第4回 スライド13 共有資源\n# 第4回 スライド14 同期'
      )
    ).toEqual([13, 14])
    expect(
      slideNumbersFromMaterial(
        'cs2-lesson-04-slide-03.md',
        '第4回 スライド13 共有資源\nスライドID: cs2-lesson-04-slide-13\n本文: 共有資源'
      )
    ).toEqual([13])
  })
  const oldEnv = { ...process.env }
  let serial = 0
  beforeEach(() => {
    jest.resetAllMocks()
    process.env.DIFY_KNOWLEDGE_API_KEY = `knowledge-key-${++serial}`
    process.env.DIFY_KNOWLEDGE_DATASET_ID = datasetId
    process.env.DIFY_KNOWLEDGE_URL = 'https://knowledge.invalid/v1'
  })
  afterEach(() => {
    process.env = { ...oldEnv }
  })
  const mockPages = (...pages: unknown[]) => {
    for (const p of pages)
      (fetchDifyKnowledgePage as jest.Mock).mockResolvedValueOnce(p)
  }
  it('loads every page, includes only enabled completed documents/chunks, and combines contiguous context', async () => {
    mockPages(
      page([{ ...doc, enabled: false }], true),
      page([doc]),
      page([segment(1), segment(2)], true),
      page([segment(3, { enabled: false }), segment(4, { status: 'indexing' })])
    )
    const selected = await selectQuestionMaterial()
    expect(selected.sourceIds).toEqual([sourceId(1), sourceId(2)])
    expect(selected.text).toContain('本文1')
    expect(selected.text).toContain('本文2')
    expect(selected.text).not.toContain('本文3')
    const calls = (fetchDifyKnowledgePage as jest.Mock).mock.calls
    expect(calls).toHaveLength(4)
    expect(calls[1][0]).toContain('page=2')
    expect(calls[3][0]).toContain('page=2')
    expect(calls[0][1]).toBe(process.env.DIFY_KNOWLEDGE_API_KEY)
  })
  it('excludes an agenda chunk and does not mix it into adjacent slide context', async () => {
    mockPages(
      page([doc]),
      page([
        segment(1, {
          content: '本日の講義内容\n1. プロセス\n2. 資源'.repeat(5),
        }),
        segment(2, {
          content: '# 第4回 スライド13 共有資源\n共有資源の説明です。'.repeat(
            7
          ),
        }),
      ])
    )
    const selected = await selectQuestionMaterial()
    expect(selected.sourceIds).toEqual([sourceId(2)])
    expect(selected.slideNumbers).toEqual([13])
    expect(selected.text).not.toContain('本日の講義内容')
  })
  it('skips slides whose extracted body is too short despite a long source header', async () => {
    mockPages(
      page([{ ...doc, name: 'cs2-lesson-04-slide-13.md' }]),
      page([
        segment(1, {
          content:
            '# 第4回 スライド13 同期\n講義: コンピュータシステム2 第4回\n出典: コンシス第4回.pdf、スライド13枚目\nスライドID: cs2-lesson-04-slide-13\n本文:\n図のみ',
        }),
      ])
    )
    await expect(selectQuestionMaterial()).rejects.toThrow(
      '別の本文がありません'
    )
  })
  it('keeps neighboring chunks from different slides separate in a bundled document', async () => {
    mockPages(
      page([{ ...doc, name: 'cs2-lesson-04-slides.md' }]),
      page([
        segment(1, {
          content:
            '第4回 スライド3 同期\nスライドID: cs2-lesson-04-slide-03\n本文: ' +
            '共有資源を管理する。'.repeat(12),
        }),
        segment(2, {
          content:
            '第4回 スライド4 排他制御\nスライドID: cs2-lesson-04-slide-04\n本文: ' +
            '同時実行を制御する。'.repeat(12),
        }),
      ])
    )
    const selected = await selectQuestionMaterial()
    expect(selected.sourceIds).toEqual([sourceId(1)])
    expect(selected.slideNumbers).toEqual([3])
  })
  it('prefers unused ranges and reuses them only after exhausting fresh material', async () => {
    mockPages(
      page([doc]),
      page([segment(1), segment(2), segment(4), segment(5)])
    )
    const first = await selectQuestionMaterial()
    const second = await selectQuestionMaterial(first.sourceIds)
    expect(second.sourceIds).toEqual([sourceId(4), sourceId(5)])
    expect(second.recycled).toBe(false)
    const third = await selectQuestionMaterial([
      ...first.sourceIds,
      ...second.sourceIds,
    ])
    expect(third.recycled).toBe(true)
    expect(fetchDifyKnowledgePage).toHaveBeenCalledTimes(2) // short-lived cache
  })
  it('does not retry a previously rejected range even when all material was used', async () => {
    mockPages(page([doc]), page([segment(1), segment(2)]))
    await expect(
      selectQuestionMaterial([], [sourceId(1), sourceId(2)])
    ).rejects.toThrow('別の本文がありません')
  })
  it('does not cross disabled gaps or truncate large chunks, and retains QA answers', async () => {
    mockPages(
      page([doc]),
      page([
        segment(1, { content: '短い見出し' }),
        segment(2, { enabled: false }),
        segment(3, { content: 'x'.repeat(12001) }),
        segment(5, { answer: '教材の回答' }),
      ])
    )
    const result = await selectQuestionMaterial()
    expect(result.sourceIds).toEqual([sourceId(5)])
    expect(result.text).toContain('教材の回答')
    expect(result.text.length).toBeLessThanOrEqual(12000)
  })
  it('rejects missing credentials and opaque YAML IDs before sending any request', async () => {
    delete process.env.DIFY_KNOWLEDGE_API_KEY
    await expect(selectQuestionMaterial()).rejects.toThrow('未設定')
    process.env.DIFY_KNOWLEDGE_API_KEY = 'knowledge-secret'
    await expect(
      selectQuestionMaterial([], [], 'encrypted+dataset/id')
    ).rejects.toThrow('ナレッジを選択')
    expect(fetchDifyKnowledgePage).not.toHaveBeenCalled()
  })
  it('rejects malformed or empty responses without fabricating material', async () => {
    mockPages({ data: [doc] })
    await expect(selectQuestionMaterial()).rejects.toThrow('応答形式')
    mockPages(page([doc]), page([]))
    await expect(selectQuestionMaterial()).rejects.toThrow('別の本文')
  })
  it('isolates cached material and API paths by selected knowledge, without fallback on access errors', async () => {
    mockPages(
      page([doc]),
      page([segment(1)]),
      page([doc]),
      page([segment(1, { content: '新教材の本文'.repeat(30) })])
    )
    const old = await selectQuestionMaterial([], [], datasetId)
    const next = await selectQuestionMaterial([], [], knowledgeSources[1].id)
    expect(old.text).toContain('電子メール')
    expect(next.text).toContain('新教材')
    expect(next.text).not.toContain('電子メール')
    expect(next.datasetId).toBe(knowledgeSources[1].id)
    const calls = (fetchDifyKnowledgePage as jest.Mock).mock.calls
    expect(calls[0][0]).toContain('/datasets/' + datasetId + '/')
    expect(calls[2][0]).toContain('/datasets/' + knowledgeSources[1].id + '/')
    ;(fetchDifyKnowledgePage as jest.Mock).mockRejectedValue(new Error('403'))
    await expect(selectQuestionMaterial([], [], datasetId)).rejects.toThrow(
      '403'
    )
  })
  it('keeps the lecture material as the question scope and adds a related reference', async () => {
    const referenceDatasetId = knowledgeSources.find(
      (source) => source.id === 'c619b5fb-e475-4184-9f3c-c04c693be07f'
    )!.id
    mockPages(
      page([doc]),
      page([
        segment(1, {
          content:
            'CPUスケジューリングではプロセスにCPUを割り当てます。'.repeat(8),
        }),
      ]),
      page([{ ...doc, name: '補足資料' }]),
      page([
        segment(2, {
          content:
            'プロセスの実行可能状態とCPUスケジューリングを説明します。'.repeat(
              8
            ),
        }),
      ])
    )

    const result = await selectQuestionMaterialBundle([], [], datasetId, [
      referenceDatasetId,
    ])

    expect(result.material.datasetId).toBe(datasetId)
    expect(result.references).toHaveLength(1)
    expect(result.references[0].datasetId).toBe(referenceDatasetId)
    expect(result.sourceContext).toContain('【出題範囲（授業資料）】')
    expect(result.sourceContext).toContain(
      '【補足根拠（オペレーティングシステムの基礎（第3回補足））】'
    )
  })
})
