import { createHash, randomInt } from 'crypto'
import { z } from 'zod'
import { getQuestionKnowledge } from './questionKnowledge'
import { fetchDifyKnowledgePage } from '../../../app/lib/api/client'

const documentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  enabled: z.boolean(),
  archived: z.boolean().optional(),
  indexing_status: z.string(),
})
const segmentSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int(),
  content: z.string(),
  answer: z.string().nullable().optional(),
  enabled: z.boolean(),
  status: z.string(),
})
type Segment = z.infer<typeof segmentSchema>
type MaterialDocument = {
  id: string
  name: string
  segments: Segment[]
}
export type QuestionMaterial = {
  text: string
  sourceIds: string[]
  slideNumbers: number[]
  datasetId: string
  documentId: string
  documentName: string
  recycled: boolean
}

export type QuestionMaterialBundle = {
  material: QuestionMaterial
  references: QuestionMaterial[]
  /** LLMへ渡す本文。授業資料と補足根拠の役割を明示する。 */
  sourceContext: string
}
export class QuestionMaterialError extends Error {
  constructor(
    message: string,
    public status = 503
  ) {
    super(message)
  }
}

let cache:
  | { config: string; expires: number; documents: MaterialDocument[] }
  | undefined
const MAX_TEXT = 12000

/** 出題用教材の明示的な見出しだけを根拠にする。PDFの末尾の数字は推測しない。 */
export function slideNumbersFromMaterial(
  documentName: string,
  content: string
) {
  const numbers = new Set<number>()
  for (const match of content.matchAll(
    /スライドID:\s*cs2-lesson-\d+-slide-(\d{1,3})(?=\b)/g
  )) {
    numbers.add(Number(match[1]))
  }
  // A bundled document can contain many slides. Its explicit slide ID takes
  // precedence over any old single-slide filename retained by Dify on update.
  if (numbers.size) return [...numbers].sort((a, b) => a - b)
  const fromName = documentName.match(/lesson-\d+-slide-(\d{1,3})\.md$/i)
  if (fromName) numbers.add(Number(fromName[1]))
  for (const match of content.matchAll(
    /(?:^|\n)#{1,3}\s*第\d+回\s+スライド\s*(\d{1,3})(?=\s|$)/g
  )) {
    numbers.add(Number(match[1]))
  }
  return [...numbers].filter((number) => number > 0).sort((a, b) => a - b)
}

const isNavigationOnly = (text: string) =>
  /^(?:#{1,3}\s*)?(?:本日の講義内容|目次|講義の目次|アジェンダ)(?:\s|$)/m.test(
    text.trim()
  )

async function allPages<T>(
  base: string,
  key: string,
  schema: z.ZodType<T>,
  signal: AbortSignal
): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; page <= 100; page++) {
    const url = new URL(base)
    url.searchParams.set('limit', '100')
    url.searchParams.set('page', String(page))
    const result = z
      .object({ data: z.array(schema), has_more: z.boolean() })
      .safeParse(await fetchDifyKnowledgePage(url.toString(), key, signal))
    if (!result.success)
      throw new QuestionMaterialError(
        'ナレッジAPIの応答形式を確認できませんでした。',
        502
      )
    items.push(...result.data.data)
    if (!result.data.has_more) return items
    if (!result.data.data.length) break
  }
  // Never silently restrict randomness to the first page of the material.
  throw new QuestionMaterialError(
    '教材が多すぎるか、ページを取得できません。対象ナレッジを分けてください。',
    422
  )
}

export async function selectQuestionMaterial(
  excludedSourceIds: string[] = [],
  rejectedSourceIds: string[] = [],
  selectedDatasetId?: string,
  maxCharacters = MAX_TEXT
): Promise<QuestionMaterial> {
  const key = process.env.DIFY_KNOWLEDGE_API_KEY?.trim()
  const source = getQuestionKnowledge(selectedDatasetId)
  if (!source)
    throw new QuestionMaterialError('出題するナレッジを選択してください。', 400)
  const datasetId = source.id
  if (!key)
    throw new QuestionMaterialError(
      'ナレッジ用APIキーが未設定です。DIFY_KNOWLEDGE_API_KEYを設定してください。'
    )
  if (!z.string().uuid().safeParse(datasetId).success)
    throw new QuestionMaterialError(
      '登録一覧のナレッジIDはUUIDで設定してください。'
    )
  const base = (
    process.env.DIFY_KNOWLEDGE_URL?.trim() || 'https://api.dify.ai/v1'
  ).replace(/\/+$/, '')
  const parsedUrl = new URL(base)
  if (
    !['https:', 'http:'].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash
  )
    throw new QuestionMaterialError('ナレッジのAPI URLが正しくありません。')
  const config = createHash('sha256')
    .update(JSON.stringify([key, datasetId, base]))
    .digest('hex')
  let documents: MaterialDocument[]
  if (cache?.config === config && cache.expires > Date.now()) {
    documents = cache.documents
  } else {
    const signal = AbortSignal.timeout(25000)
    const listed = await allPages(
      `${base}/datasets/${datasetId}/documents`,
      key,
      documentSchema,
      signal
    )
    documents = []
    let count = 0
    for (const doc of listed) {
      if (!doc.enabled || doc.archived || doc.indexing_status !== 'completed')
        continue
      const segments = await allPages(
        `${base}/datasets/${datasetId}/documents/${doc.id}/segments`,
        key,
        segmentSchema,
        signal
      )
      const usable = [
        ...new Map(
          segments
            .filter(
              (s) => s.enabled && s.status === 'completed' && s.content.trim()
            )
            .map((s) => [s.id, s])
        ).values(),
      ].sort((a, b) => a.position - b.position)
      count += usable.length
      if (count > 10000)
        throw new QuestionMaterialError(
          '出題対象が1万区切りを超えています。ナレッジを分けてください。',
          422
        )
      documents.push({ id: doc.id, name: doc.name, segments: usable })
    }
    cache = { config, expires: Date.now() + 60000, documents }
  }

  const excluded = new Set(excludedSourceIds)
  const rejected = new Set(rejectedSourceIds)
  const sourceId = (doc: MaterialDocument, s: Segment) => `${doc.id}:${s.id}`
  const segmentText = (s: Segment) =>
    s.answer?.trim()
      ? `${s.content.trim()}\n${s.answer.trim()}`
      : s.content.trim()
  const candidates: Omit<QuestionMaterial, 'recycled'>[] = []
  for (const doc of documents) {
    const heading = `教材: ${doc.name.slice(0, 200)}\n`
    for (let i = 0; i < doc.segments.length; i++) {
      const center = doc.segments[i]
      if (rejected.has(sourceId(doc, center))) continue
      if (isNavigationOnly(segmentText(center))) continue
      const centerSlides = slideNumbersFromMaterial(
        doc.name,
        segmentText(center)
      )
      const chosen = [center]
      let length = heading.length + segmentText(center).length
      if (length > maxCharacters) continue // Do not cut a sentence midway.
      for (const index of [i - 1, i + 1]) {
        const neighbor = doc.segments[index]
        if (
          !neighbor ||
          isNavigationOnly(segmentText(neighbor)) ||
          Math.abs(neighbor.position - center.position) !== 1 ||
          rejected.has(sourceId(doc, neighbor))
        )
          continue
        const neighborSlides = slideNumbersFromMaterial(
          doc.name,
          segmentText(neighbor)
        )
        if (
          centerSlides.length &&
          neighborSlides.length &&
          (centerSlides.length !== neighborSlides.length ||
            centerSlides.some(
              (slide, position) => slide !== neighborSlides[position]
            ))
        )
          continue
        const extra = segmentText(neighbor).length + 2
        if (length + extra <= maxCharacters) {
          chosen.push(neighbor)
          length += extra
        }
      }
      chosen.sort((a, b) => a.position - b.position)
      const content = chosen.map(segmentText).join('\n\n')
      if (content.replace(/\s/g, '').length < 80) continue
      const bodyMarker = content.includes('## スライド本文')
        ? '## スライド本文'
        : content.includes('本文:')
          ? '本文:'
          : undefined
      if (slideNumbersFromMaterial(doc.name, content).length && bodyMarker) {
        const body = content.split(bodyMarker).slice(1).join('')
        if (body.replace(/\s/g, '').length < 80) continue
      }
      candidates.push({
        text: heading + content,
        sourceIds: chosen.map((s) => sourceId(doc, s)),
        slideNumbers: slideNumbersFromMaterial(doc.name, content),
        datasetId,
        documentId: doc.id,
        documentName: doc.name,
      })
    }
  }
  if (!candidates.length)
    throw new QuestionMaterialError(
      '出題に使える別の本文がありません。有効な教材本文と区切りの長さを確認してください。',
      422
    )
  // Prefer non-overlapping ranges; after exhausting them, allow reuse except
  // ranges already rejected during retries for this particular question.
  const fresh = candidates.filter((c) =>
    c.sourceIds.every((id) => !excluded.has(id))
  )
  const available = fresh.length ? fresh : candidates
  return { ...available[randomInt(available.length)], recycled: !fresh.length }
}

const relevanceTerms = (text: string) => {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('ja')
  const terms = new Set<string>()
  const words =
    normalized.match(/[a-z][a-z0-9_-]{1,}|[一-龯々〆〤ぁ-んァ-ヶー]{2,}/g) || []

  for (const word of words) {
    if (word.length <= 48) terms.add(word)
    // 日本語の文章には空白がないため、専門用語の一部も拾える二文字列を加える。
    for (let index = 0; index < word.length - 1 && terms.size < 500; index++)
      terms.add(word.slice(index, index + 2))
  }

  return [...terms].filter((term) => term.length >= 2)
}

const relevanceScore = (query: string, candidate: string) => {
  const candidateText = candidate.normalize('NFKC').toLocaleLowerCase('ja')
  return relevanceTerms(query).reduce(
    (score, term) => score + (candidateText.includes(term) ? term.length : 0),
    0
  )
}

/**
 * 補足ナレッジから、授業資料の抜粋と最も用語が近い本文を選ぶ。
 * ランダムな補足を混ぜて出題範囲を広げないため、ここでは関連度で選ぶ。
 */
export async function selectRelatedQuestionMaterial(
  queryText: string,
  selectedDatasetId: string,
  maxCharacters = 4500
): Promise<QuestionMaterial> {
  const seenSourceIds = new Set<string>()
  let best: QuestionMaterial | undefined
  let bestScore = -1

  // Difyの1資料は通常この回数以内で確認できる。キャッシュを使うためAPIの再取得はしない。
  for (let attempt = 0; attempt < 24; attempt++) {
    const candidate = await selectQuestionMaterial(
      [...seenSourceIds],
      [],
      selectedDatasetId,
      maxCharacters
    )
    const candidateKey = candidate.sourceIds.join('|')
    if (candidate.sourceIds.every((id) => seenSourceIds.has(id))) break
    candidate.sourceIds.forEach((id) => seenSourceIds.add(id))

    const score = relevanceScore(queryText, candidate.text)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
    if (candidate.recycled || !candidateKey) break
  }

  if (!best)
    throw new QuestionMaterialError(
      '補足ナレッジから出題範囲に対応する本文を取得できませんでした。',
      422
    )
  return best
}

export async function selectQuestionMaterialBundle(
  excludedSourceIds: string[] = [],
  rejectedSourceIds: string[] = [],
  primaryDatasetId?: string,
  referenceDatasetIds: string[] = []
): Promise<QuestionMaterialBundle> {
  // 12,000文字のDify入力上限内で、授業資料を優先して残す。
  const material = await selectQuestionMaterial(
    excludedSourceIds,
    rejectedSourceIds,
    primaryDatasetId,
    6500
  )
  const references = await Promise.all(
    referenceDatasetIds.map((datasetId) =>
      selectRelatedQuestionMaterial(material.text, datasetId)
    )
  )

  const sourceContext = [
    '【出題範囲（授業資料）】',
    material.text,
    ...references.flatMap((reference) => [
      `【補足根拠（${getQuestionKnowledge(reference.datasetId)?.name || '補足資料'}）】`,
      reference.text,
    ]),
  ].join('\n\n')

  if (sourceContext.length > MAX_TEXT)
    throw new QuestionMaterialError(
      '授業資料と補足根拠の合計が長すぎます。ナレッジのチャンク長を短くしてください。',
      422
    )

  return { material, references, sourceContext }
}
