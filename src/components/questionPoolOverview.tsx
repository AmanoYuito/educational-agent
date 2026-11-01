import { useCallback, useEffect, useState } from 'react'

import {
  poolBloomLevelLabels,
  poolQuestionTypeLabels,
  understandSkillLabels,
  type PoolBloomLevel,
  type PoolQuestionType,
  type UnderstandSkill,
} from '@/features/questionPool/types'
import { withBasePath } from '@/utils/basePath'

type LessonOption = {
  id: string
  title: string
}

type PoolItem = {
  id: string
  lessonId: string
  topic: string
  questionGroup: string
  difficultyLevel: number
  question: string
  questionType: PoolQuestionType
  bloomLevel: PoolBloomLevel | null
  understandSkill: UnderstandSkill | null
  correctAnswer: string
  correctIndex: number | null
  wrongAnswers: string[]
  choices: string[]
  explanation: string
  sourceContext: string
  questionNumber: number | null
  sourceDatasetId: string
  sourceDatasetName: string
  sourceDocumentId: string
  sourceDocumentName: string
  sourceSegmentIds: string[]
  variantFamilyId: string
  variantIndex: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type PoolStats = {
  total: number
  active: number
  multipleChoice: number
  writtenRemember: number
  writtenUnderstand: number
  writtenUnclassified: number
  understandBySkill: Partial<Record<UnderstandSkill, number>>
}

type PoolResponse = {
  stats: PoolStats
  items: PoolItem[]
  coverage: CoverageItem[]
  classSummary: ClassSummaryItem[]
}

type CoverageItem = {
  section: string
  registered: number
  askedQuestions: number
  attempts: number
  correct: number
  partial: number
  learners: number
  averageResponseMs: number | null
}

type ClassSummaryItem = {
  key: string
  label: string
  registered: number
  attempts: number
  correct: number
  partial: number
  learners: number
  averageResponseMs: number | null
}

const emptyStats: PoolStats = {
  total: 0,
  active: 0,
  multipleChoice: 0,
  writtenRemember: 0,
  writtenUnderstand: 0,
  writtenUnclassified: 0,
  understandBySkill: {},
}

export function QuestionPoolOverview({
  lessons,
  refreshKey,
}: {
  lessons: LessonOption[]
  refreshKey: number
}) {
  const [lessonId, setLessonId] = useState('all')
  const [data, setData] = useState<PoolResponse>({
    stats: emptyStats,
    items: [],
    coverage: [],
    classSummary: [],
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null
  )
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const search = new URLSearchParams()
      if (lessonId !== 'all') search.set('lessonId', lessonId)
      const response = await fetch(
        `${withBasePath('/api/question-pool/manage/')}${search.size ? `?${search}` : ''}`,
        { credentials: 'include' }
      )
      const body = (await response.json()) as PoolResponse & {
        message?: string
      }
      if (!response.ok) {
        throw new Error(body.message || '問題プールを取得できませんでした。')
      }
      setData({
        stats: { ...emptyStats, ...(body.stats || {}) },
        items: Array.isArray(body.items) ? body.items : [],
        coverage: Array.isArray(body.coverage) ? body.coverage : [],
        classSummary: Array.isArray(body.classSummary) ? body.classSummary : [],
      })
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : '問題プールを取得できませんでした。'
      )
    } finally {
      setLoading(false)
    }
  }, [lessonId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const setBloomLevel = async (id: string, bloomLevel: PoolBloomLevel) => {
    setUpdatingId(id)
    setError('')
    try {
      const response = await fetch(withBasePath('/api/question-pool/manage/'), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, bloomLevel }),
      })
      const body = (await response.json()) as { message?: string }
      if (!response.ok) {
        throw new Error(body.message || '認知レベルを更新できませんでした。')
      }
      await load()
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : '認知レベルを更新できませんでした。'
      )
    } finally {
      setUpdatingId(null)
    }
  }

  const deleteQuestion = async (id: string) => {
    setDeletingId(id)
    setError('')
    try {
      const response = await fetch(withBasePath('/api/question-pool/manage/'), {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const body = (await response.json()) as { message?: string }
      if (!response.ok) {
        throw new Error(body.message || '問題を削除できませんでした。')
      }
      setConfirmingDeleteId(null)
      await load()
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : '問題を削除できませんでした。'
      )
    } finally {
      setDeletingId(null)
    }
  }

  const writtenNeedsUpdate =
    data.stats.writtenRemember + data.stats.writtenUnclassified
  const understandSkillCounts = Object.entries(understandSkillLabels).filter(
    ([skill]) =>
      (data.stats.understandBySkill[skill as UnderstandSkill] || 0) > 0
  )
  const counts = [
    {
      label: '4択問題・記憶',
      count: data.stats.multipleChoice,
      tone: 'bg-[#edf4ff] text-[#2563d9]',
    },
    {
      label: '記述問題・理解',
      count: data.stats.writtenUnderstand,
      tone: 'bg-[#edf9f1] text-[#18794e]',
    },
    {
      label: '記述問題・要確認',
      count: writtenNeedsUpdate,
      tone: 'bg-[#fff3df] text-[#a45500]',
    },
  ]

  return (
    <section className="space-y-5 rounded-[26px] border border-[#dbe5fb] bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-black">問題プール</h2>
          <p className="mt-1 text-sm leading-6 text-[#526786]">
            採用済みの問題を確認できます。問題形式ごとの登録数も、選んだ授業回ごとに集計します。
          </p>
        </div>
        <button
          type="button"
          className="rounded-full bg-[#edf4ff] px-4 py-2 text-sm font-bold text-[#3567c7] disabled:opacity-60"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? '読み込み中…' : '問題プールを更新'}
        </button>
      </div>

      <label className="block max-w-md text-sm font-bold">
        授業回で絞り込み
        <select
          className="mt-2 block w-full rounded-xl border border-[#cfe0fb] bg-white px-4 py-3 text-sm text-[#21304d]"
          value={lessonId}
          onChange={(event) => setLessonId(event.target.value)}
        >
          <option value="all">すべての授業回</option>
          {lessons.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>
              {lesson.title}
            </option>
          ))}
          <option value="legacy">授業回未設定の過去問題</option>
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        {counts.map((count) => (
          <div key={count.label} className={`rounded-2xl p-4 ${count.tone}`}>
            <p className="text-sm font-bold">{count.label}</p>
            <p className="mt-2 text-3xl font-black">{count.count}問</p>
          </div>
        ))}
      </div>
      <p className="text-xs leading-6 text-[#6b7da1]">
        登録数：{data.stats.total}問（出題対象：{data.stats.active}問）
        {writtenNeedsUpdate > 0 &&
          `。現在の方針では記述問題は理解にそろえるため、確認が必要な過去の記述問題：${writtenNeedsUpdate}問`}
      </p>
      {!!understandSkillCounts.length && (
        <div className="rounded-2xl bg-[#f3faf6] p-4">
          <p className="text-sm font-bold text-[#18794e]">理解問題の問い方</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {understandSkillCounts.map(([skill, label]) => (
              <span
                key={skill}
                className="rounded-full bg-white px-3 py-1 text-xs font-bold text-[#18794e] shadow-sm"
              >
                {label} {data.stats.understandBySkill[skill as UnderstandSkill]}
                問
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[#dbe5fb] p-4">
          <h3 className="font-black">教材カバレッジ</h3>
          <p className="mt-1 text-xs leading-5 text-[#6b7da1]">
            見出しごとの登録数と、実際に出題された問題数です。
          </p>
          <div className="mt-3 max-h-72 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-white text-[#6b7da1]">
                <tr>
                  <th className="py-2 pr-2">章・見出し</th>
                  <th className="px-2 py-2 text-right">登録</th>
                  <th className="px-2 py-2 text-right">出題済み</th>
                  <th className="py-2 pl-2 text-right">正答率</th>
                </tr>
              </thead>
              <tbody>
                {data.coverage.map((item) => (
                  <tr key={item.section} className="border-t border-[#edf1f8]">
                    <td className="py-2 pr-2 font-bold">{item.section}</td>
                    <td className="px-2 py-2 text-right">{item.registered}</td>
                    <td className="px-2 py-2 text-right">
                      {item.askedQuestions}
                    </td>
                    <td className="py-2 pl-2 text-right">
                      {item.attempts
                        ? `${Math.round((item.correct / item.attempts) * 100)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
                {!data.coverage.length && (
                  <tr>
                    <td colSpan={4} className="py-4 text-[#6b7da1]">
                      集計できる問題がありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-2xl border border-[#dbe5fb] p-4">
          <h3 className="font-black">授業全体の匿名集計</h3>
          <p className="mt-1 text-xs leading-5 text-[#6b7da1]">
            個人名を出さず、出題タイプ別のつまずきを確認します。
          </p>
          <div className="mt-3 space-y-2">
            {data.classSummary.map((item) => {
              const rate = item.attempts
                ? Math.round((item.correct / item.attempts) * 100)
                : null
              return (
                <div
                  key={item.key}
                  className="rounded-xl bg-[#f7f9fd] px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold">{item.label}</span>
                    <span>{rate === null ? '未回答' : `正答 ${rate}%`}</span>
                  </div>
                  <div className="mt-1 text-[#6b7da1]">
                    {item.attempts}回答・一部理解 {item.partial}件
                    {item.averageResponseMs !== null
                      ? `・平均 ${Math.max(1, Math.round(item.averageResponseMs / 1000))}秒`
                      : ''}
                  </div>
                </div>
              )
            })}
            {!data.classSummary.length && (
              <p className="py-3 text-xs text-[#6b7da1]">
                まだ回答記録がありません。
              </p>
            )}
          </div>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {!loading && !error && !data.items.length && (
        <p className="rounded-xl bg-[#f7f9fd] p-4 text-sm text-[#526786]">
          この条件に登録済みの問題はありません。
        </p>
      )}
      <div className="space-y-3">
        {data.items.map((item) => {
          const typeLabel = poolQuestionTypeLabels[item.questionType]
          const bloomLabel =
            item.questionType === 'written'
              ? item.bloomLevel
                ? poolBloomLevelLabels[item.bloomLevel]
                : '認知レベル未設定'
              : ''
          return (
            <details
              key={item.id}
              className="group rounded-2xl border border-[#dbe5fb] bg-[#fbfdff]"
            >
              <summary className="cursor-pointer list-none p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <span className="rounded-full bg-[#e9f0ff] px-2 py-1 text-xs font-bold text-[#3567c7]">
                    {typeLabel}
                    {bloomLabel ? ` · ${bloomLabel}` : ''}
                    {item.understandSkill
                      ? ` · ${understandSkillLabels[item.understandSkill]}`
                      : ''}
                  </span>
                  {!item.isActive && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                      出題停止中
                    </span>
                  )}
                  {item.variantIndex > 0 && (
                    <span className="rounded-full bg-[#f1ecff] px-2 py-1 text-xs font-bold text-[#6b4aa0]">
                      類題 {item.variantIndex}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-[#6b7da1]">
                    {item.questionNumber
                      ? `問題番号 ${item.questionNumber}`
                      : '問題番号未設定'}
                  </span>
                </div>
                <p className="mt-3 font-bold leading-6">{item.question}</p>
                <p className="mt-2 text-xs text-[#6b7da1]">
                  {item.sourceDatasetName || '出題元未設定'} · 更新{' '}
                  {new Date(item.updatedAt).toLocaleString('ja-JP')}
                </p>
              </summary>
              <div className="space-y-4 border-t border-[#dbe5fb] p-4 text-sm">
                {item.questionType === 'multiple_choice' ? (
                  <ol className="list-[upper-alpha] space-y-2 pl-6 leading-6">
                    {item.choices.map((choice, index) => (
                      <li
                        key={`${item.id}-${index}`}
                        className={
                          index === item.correctIndex
                            ? 'font-bold text-green-800'
                            : ''
                        }
                      >
                        {choice}
                        {index === item.correctIndex ? '（正答）' : ''}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <>
                    <div className="rounded-xl bg-[#edf9f1] p-4">
                      <p className="font-bold text-[#18794e]">模範回答</p>
                      <p className="mt-2 whitespace-pre-wrap leading-6">
                        {item.correctAnswer}
                      </p>
                    </div>
                    {item.bloomLevel !== 'understand' && (
                      <div className="rounded-xl border border-[#f2d7a5] bg-[#fffaf0] p-4">
                        <p className="font-bold text-[#87520b]">
                          記述問題を理解にそろえる
                        </p>
                        <p className="mt-1 text-xs leading-5 text-[#765f40]">
                          現在の方針では、記憶は4択、記述問題は理解として出題します。問題文と模範回答を確認してから更新してください。
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-lg border border-[#d9b77a] bg-white px-3 py-2 text-xs font-bold text-[#87520b] disabled:opacity-60"
                            disabled={updatingId === item.id}
                            onClick={() =>
                              void setBloomLevel(item.id, 'understand')
                            }
                          >
                            {updatingId === item.id ? '更新中…' : '理解に設定'}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {item.explanation && (
                  <div>
                    <p className="font-bold">解説</p>
                    <p className="mt-1 whitespace-pre-wrap leading-6">
                      {item.explanation}
                    </p>
                  </div>
                )}
                {item.sourceContext && (
                  <details className="rounded-xl border border-[#dbe5fb] bg-white p-3">
                    <summary className="cursor-pointer font-bold text-[#3567c7]">
                      教材の参照箇所を見る
                    </summary>
                    <p className="mt-3 whitespace-pre-wrap leading-6 text-[#33496d]">
                      {item.sourceContext}
                    </p>
                  </details>
                )}
                <div className="border-t border-[#e8edf6] pt-4">
                  {confirmingDeleteId === item.id ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                      <p className="font-bold text-red-900">
                        この問題を問題プールから削除しますか？
                      </p>
                      <p className="mt-1 text-xs leading-5 text-red-800">
                        今後の出題対象から外れます。過去の回答ログは残りますが、この操作は取り消せません。
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                          disabled={deletingId === item.id}
                          onClick={() => void deleteQuestion(item.id)}
                        >
                          {deletingId === item.id ? '削除中…' : '削除を実行'}
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-[#cad5e8] bg-white px-3 py-2 text-xs font-bold text-[#526786] disabled:opacity-60"
                          disabled={deletingId === item.id}
                          onClick={() => setConfirmingDeleteId(null)}
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50"
                      onClick={() => setConfirmingDeleteId(item.id)}
                    >
                      この問題を削除
                    </button>
                  )}
                </div>
              </div>
            </details>
          )
        })}
      </div>
      {!loading && data.items.length >= 100 && (
        <p className="text-xs text-[#6b7da1]">
          最新100問を表示しています。授業回で絞り込むと確認しやすくなります。
        </p>
      )}
    </section>
  )
}
