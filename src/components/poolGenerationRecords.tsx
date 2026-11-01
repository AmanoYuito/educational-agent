import { useCallback, useEffect, useState, useRef } from 'react'
import {
  downloadQuizEvaluations,
  loadQuizEvaluations,
  saveQuestionPoolItems,
} from '../../app/lib/api/client'
import {
  poolQuestionTypeLabels,
  poolBloomLevelLabels,
  type UnderstandSkill,
  type PoolQuestionType,
  type PoolBloomLevel,
  type QuestionKnowledgeSource,
} from '@/features/questionPool/types'
import type { QuizEvaluationRecord } from '@/features/quizEvaluation/types'
import type { QuestionPoolItem } from '@/features/stores/home'

export function PoolGenerationRecords({
  refreshKey,
  knowledge,
  onPoolSaved,
}: {
  refreshKey: number
  knowledge: QuestionKnowledgeSource
  onPoolSaved?: () => void
}) {
  const [items, setItems] = useState<QuizEvaluationRecord[]>([])
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [datasetFilter, setDatasetFilter] = useState(knowledge.id)
  const [loadedDataset, setLoadedDataset] = useState('')
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [savingId, setSavingId] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const refresh = useCallback(
    async (run: string) => {
      const version = ++requestVersion.current
      setBusy(true)
      setError('')
      setItems([])
      try {
        const result = await loadQuizEvaluations(
          run,
          'question_pool',
          datasetFilter
        )
        if (version === requestVersion.current) {
          setItems(result)
          setLoadedDataset(datasetFilter)
        }
      } catch (e) {
        if (version === requestVersion.current)
          setError(e instanceof Error ? e.message : '記録を取得できません。')
      } finally {
        if (version === requestVersion.current) setBusy(false)
      }
    },
    [datasetFilter]
  )
  const visibleItems = loadedDataset === datasetFilter ? items : []
  useEffect(() => {
    setFilter('')
    void refresh('')
  }, [refreshKey, refresh])
  const download = async () => {
    setBusy(true)
    setError('')
    try {
      await downloadQuizEvaluations(
        filter.trim(),
        'question_pool',
        datasetFilter
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CSVを取得できません。')
    } finally {
      setBusy(false)
    }
  }
  const buildPoolItem = (
    item: QuizEvaluationRecord
  ): QuestionPoolItem | null => {
    if (item.status !== 'success' || !item.question || !item.correctAnswer)
      return null
    const questionType =
      item.inputs.question_type === 'written' ? 'written' : 'multiple_choice'
    const choices = item.choices || []
    const normalize = (value: string) => value.normalize('NFKC').trim()
    const correctIndex =
      questionType === 'multiple_choice'
        ? choices.findIndex(
            (choice) => normalize(choice) === normalize(item.correctAnswer)
          )
        : undefined
    if (questionType === 'multiple_choice' && (correctIndex ?? -1) < 0)
      return null
    let sourceSegmentIds: string[] = []
    try {
      const parsed = JSON.parse(item.inputs.source_segment_ids || '[]')
      if (Array.isArray(parsed)) sourceSegmentIds = parsed.map(String)
    } catch {
      // Keep the source text even when an older record has no segment metadata.
    }
    return {
      id: `evaluation-${item.id}`,
      questionType,
      bloomLevel:
        questionType === 'written' &&
        (item.inputs.bloom_level === 'remember' ||
          item.inputs.bloom_level === 'understand')
          ? item.inputs.bloom_level
          : undefined,
      understandSkill:
        questionType === 'written' &&
        [
          'interpret',
          'exemplify',
          'classify',
          'summarize',
          'infer',
          'compare',
          'explain',
        ].includes(item.inputs.understand_skill || '')
          ? (item.inputs.understand_skill as UnderstandSkill)
          : undefined,
      question: item.question,
      choices: questionType === 'multiple_choice' ? choices : [],
      correctIndex:
        questionType === 'multiple_choice' ? correctIndex : undefined,
      correctAnswer: item.correctAnswer,
      wrongAnswers:
        questionType === 'multiple_choice'
          ? choices.filter((_, index) => index !== correctIndex)
          : [],
      explanation: item.explanation,
      difficultyLevel: 3,
      questionGroup: item.runLabel || '生成履歴',
      topic: item.inputs.source_dataset_name || undefined,
      sourceDatasetId: item.inputs.source_dataset_id || undefined,
      sourceDatasetName: item.inputs.source_dataset_name || undefined,
      sourceDocumentId: item.inputs.source_document_id || undefined,
      sourceDocumentName: item.inputs.source_document_name || undefined,
      sourceSegmentIds,
      sourceContext: item.inputs.source_context || undefined,
    }
  }
  const saveRecord = async (item: QuizEvaluationRecord) => {
    const poolItem = buildPoolItem(item)
    if (!poolItem || savingId) return
    setSavingId(item.id)
    setError('')
    try {
      await saveQuestionPoolItems([
        { ...poolItem, aiOutput: item.rawOutput, isActive: true },
      ])
      setSavedIds((prev) => new Set(prev).add(item.id))
      onPoolSaved?.()
    } catch (e) {
      setError(
        e instanceof Error ? e.message : '問題プールへの保存に失敗しました。'
      )
    } finally {
      setSavingId(null)
    }
  }
  return (
    <section className="mt-6 space-y-4 rounded-[26px] border border-[#dbe5fb] bg-white p-5">
      <h2 className="text-xl font-black">生成結果・CSV</h2>
      <p className="text-sm leading-6">
        選択中のナレッジの成功・失敗を表示します。別のナレッジは上の出題欄で切り替えてください。問題の行を開くと、生成に使った教材の参照箇所も確認できます。CSVには問題形式、指定した認知レベル、問題文、選択肢、正答・模範回答、解説、モデル構成、時間、トークン、報告費用が含まれます。
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-bold">
          記録のナレッジ
          <select
            className="mt-1 block rounded-xl border border-[#cfe0fb] px-3 py-2"
            value={datasetFilter}
            onChange={(e) => setDatasetFilter(e.target.value)}
          >
            <option value={knowledge.id}>{knowledge.name}</option>
            <option value="unknown">出題元不明の過去記録</option>
          </select>
        </label>
        <label className="min-w-56 flex-1 text-sm font-bold">
          試行名で絞り込み（空欄は全件）
          <input
            className="mt-1 w-full rounded-xl border border-[#cfe0fb] px-3 py-2"
            value={filter}
            maxLength={200}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <button
          className="rounded-full bg-[#edf4ff] px-4 py-2 font-bold text-[#3567c7] disabled:opacity-60"
          disabled={busy}
          onClick={() => void refresh(filter.trim())}
        >
          記録を更新
        </button>
        <button
          className="rounded-full bg-[#edf4ff] px-4 py-2 font-bold text-[#3567c7] disabled:opacity-60"
          disabled={busy}
          onClick={() => void download()}
        >
          生成記録のCSVをダウンロード
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {[
                '日時／試行',
                'ナレッジ',
                'モデル構成',
                '結果',
                '生成時間',
                '報告tokens',
                '報告費用',
                '問題・選択肢・模範回答',
              ].map((label) => (
                <th className="border-b p-2" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => (
              <tr className="border-b align-top" key={item.id}>
                <td className="p-2">
                  {new Date(item.createdAt).toLocaleString('ja-JP')}
                  <br />
                  {item.runLabel}
                </td>
                <td className="p-2">
                  {item.inputs?.source_dataset_name ||
                    (item.inputs?.source_dataset_id === knowledge.id
                      ? knowledge.name
                      : '出題元不明')}
                </td>
                <td className="p-2">{item.modelLabel}</td>
                <td className="p-2">
                  {item.status === 'success' ? '成功' : '失敗'}
                  {item.error && (
                    <p className="text-xs text-red-700">{item.error}</p>
                  )}
                </td>
                <td className="whitespace-nowrap p-2">
                  {(item.serverMs / 1000).toFixed(2)}秒
                </td>
                <td className="p-2">{item.usage.totalTokens ?? '不明'}</td>
                <td className="whitespace-nowrap p-2">
                  {item.usage.totalPrice === null
                    ? '不明'
                    : `${item.usage.totalPrice} ${item.usage.currency || ''}`}
                </td>
                <td className="min-w-64 p-2">
                  <p className="mb-2 text-xs font-bold text-[#3567c7]">
                    {poolQuestionTypeLabels[
                      item.inputs?.question_type as PoolQuestionType
                    ] ||
                      (item.choices?.length === 4 ? '4択問題' : '形式未記録')}
                    {' · '}
                    {poolBloomLevelLabels[
                      item.inputs?.bloom_level as PoolBloomLevel
                    ] ||
                      (item.inputs?.question_type === 'multiple_choice'
                        ? '認知レベル指定なし'
                        : '認知レベル未記録')}
                  </p>
                  <p>{item.question || '—'}</p>
                  {!!item.choices?.length && (
                    <ol className="mt-2 list-[upper-alpha] space-y-1 pl-6 text-[#526786]">
                      {item.choices.map((choice, index) => (
                        <li key={index}>{choice}</li>
                      ))}
                    </ol>
                  )}
                  {item.correctAnswer && (
                    <div className="mt-3 rounded-lg bg-[#f3f7ff] p-3">
                      <p className="font-bold">
                        {item.inputs?.question_type === 'written'
                          ? '模範回答'
                          : '正答'}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap leading-6">
                        {item.correctAnswer}
                      </p>
                    </div>
                  )}
                  {item.explanation && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[#3567c7]">
                        解説を見る
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap leading-6">
                        {item.explanation}
                      </p>
                    </details>
                  )}
                  {item.status === 'success' && (
                    <button
                      type="button"
                      disabled={
                        savingId !== null ||
                        savedIds.has(item.id) ||
                        !buildPoolItem(item)
                      }
                      onClick={() => void saveRecord(item)}
                      className="mt-3 rounded-lg border border-[#2563d9] px-3 py-2 text-sm font-bold text-[#2563d9] disabled:opacity-50"
                    >
                      {savedIds.has(item.id)
                        ? '問題プールに採用済み'
                        : savingId === item.id
                          ? '採用中…'
                          : 'この問題を問題プールに採用'}
                    </button>
                  )}
                  {item.inputs?.source_context && (
                    <details className="mt-2 rounded-lg border border-[#dbe5fb] bg-[#fbfdff] p-3">
                      <summary className="cursor-pointer font-bold text-[#3567c7]">
                        教材の参照箇所を見る
                      </summary>
                      <dl className="mt-2 space-y-1 text-xs leading-5 text-[#526786]">
                        {(item.inputs.source_document_name ||
                          item.inputs.source_document_id) && (
                          <div>
                            <dt className="font-bold text-[#33496d]">参照元</dt>
                            <dd>
                              {item.inputs.source_document_name || '教材'}
                              {item.inputs.source_document_id &&
                                `（${item.inputs.source_document_id}）`}
                            </dd>
                          </div>
                        )}
                        {item.inputs.source_segment_ids && (
                          <div>
                            <dt className="font-bold text-[#33496d]">
                              参照セグメント
                            </dt>
                            <dd className="break-all">
                              {item.inputs.source_segment_ids}
                            </dd>
                          </div>
                        )}
                      </dl>
                      <p className="mt-2 whitespace-pre-wrap rounded-md bg-white p-2 leading-6 text-[#263957]">
                        {item.inputs.source_context}
                      </p>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visibleItems.length && (
        <p className="text-sm">
          {busy ? '読み込み中…' : 'まだ生成記録がありません。'}
        </p>
      )}
      <p className="text-xs leading-6 text-[#6b7da1]">
        認知レベルは生成時の指定値です。内容がそのレベルに合っているかは生成結果を確認してください。生成時間は1問ごとのサーバー処理時間です。画面は最新100件、CSVは最大1万件。モデル構成は手入力で、Difyの設定と合わせてください。トークン・費用はDifyの報告値で、全ノード分の合計かは未確認です。取得できない値は空欄になります。記録はログイン中の管理者本人のみ閲覧できます。
      </p>
    </section>
  )
}
