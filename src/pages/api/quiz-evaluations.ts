import type { NextApiRequest, NextApiResponse } from 'next'
import { z } from 'zod'
import { getQuestionKnowledge } from '@/lib/server/questionKnowledge'
import { requireSession } from '@/lib/server/auth'
import { isDatabaseConfigured, query } from '@/lib/server/db'
import { evaluationsCsv } from '@/lib/server/quizEvaluation'
import type { QuizEvaluationRecord } from '@/features/quizEvaluation/types'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'PATCH'].includes(req.method || ''))
    return res.status(405).json({ message: 'Method not allowed' })
  const session = requireSession(req, res)
  if (!session) return
  if (session.role !== 'admin')
    return res.status(403).json({ message: '管理者のみ利用できます。' })
  if (!isDatabaseConfigured())
    return res.status(503).json({ message: '学習記録DBに接続できません。' })
  try {
    if (req.method === 'PATCH') {
      const { id, displayMs, requestMs } = req.body || {}
      const validMs = (value: unknown) =>
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 3600000
      if (
        typeof id !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(id) ||
        (!validMs(displayMs) && !validMs(requestMs)) ||
        (displayMs !== undefined && !validMs(displayMs)) ||
        (requestMs !== undefined && !validMs(requestMs))
      )
        return res.status(400).json({ message: '計測値が正しくありません。' })
      // Only the owner may acknowledge display; first value wins on remount/retry.
      const result = await query(
        `UPDATE quiz_evaluations SET record = record || jsonb_build_object(
        'displayMs', COALESCE(NULLIF(record->'displayMs', 'null'::jsonb), to_jsonb($3::double precision)),
        'requestMs', COALESCE(NULLIF(record->'requestMs', 'null'::jsonb), to_jsonb($4::double precision))
      ) WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, session.userId, displayMs ?? null, requestMs ?? null]
      )
      if (!result.rowCount)
        return res.status(404).json({ message: '記録が見つかりません。' })
      return res.status(200).json({ ok: true })
    }
    const runLabel = typeof req.query.run === 'string' ? req.query.run : ''
    if (runLabel.length > 200)
      return res.status(400).json({ message: '試行名が長すぎます。' })
    const dataset = req.query.dataset
    if (
      dataset !== undefined &&
      dataset !== 'unknown' &&
      !z.string().uuid().safeParse(dataset).success
    )
      return res
        .status(400)
        .json({ message: 'ナレッジの指定が正しくありません。' })
    const datasetFilter = typeof dataset === 'string' ? dataset : ''
    const csv = req.query.format === 'csv'
    const source =
      req.query.source === 'question_pool' ? 'question_pool' : 'realtime'
    const result = await query<{ record: QuizEvaluationRecord }>(
      `SELECT record FROM quiz_evaluations WHERE user_id = $1 AND ($2 = '' OR record->>'runLabel' = $2) AND COALESCE(record->>'source', 'realtime') = $4 AND ($5 = '' OR ($5 = 'unknown' AND COALESCE(record->'inputs'->>'source_dataset_id', '') = '') OR record->'inputs'->>'source_dataset_id' = $5) ORDER BY created_at DESC, id DESC LIMIT $3`,
      [session.userId, runLabel, csv ? 10001 : 100, source, datasetFilter]
    )
    if (csv && result.rows.length > 10000)
      return res
        .status(400)
        .json({ message: 'CSVは1万件までです。試行名で絞り込んでください。' })
    // Older records with an actual ID can be named without relabelling unknown sources.
    const items = result.rows.map(({ record }) => ({
      ...record,
      inputs: {
        ...record.inputs,
        source_dataset_name:
          record.inputs?.source_dataset_name ||
          getQuestionKnowledge(record.inputs?.source_dataset_id || '')?.name ||
          '',
      },
    }))
    if (csv) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="quiz-evaluations.csv"'
      )
      return res.status(200).send(evaluationsCsv(items))
    }
    return res.status(200).json({ items })
  } catch {
    return res
      .status(500)
      .json({ message: '計測記録の読み書きに失敗しました。' })
  }
}
