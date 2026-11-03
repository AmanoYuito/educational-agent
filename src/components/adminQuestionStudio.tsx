import { useEffect, useState } from 'react'
import {
  generatePoolQuestion,
  saveQuestionPoolItems,
} from '../../app/lib/api/client'
import { PoolGenerationRecords } from './poolGenerationRecords'
import { QuestionPoolOverview } from './questionPoolOverview'
import {
  PoolGenerationError,
  type GeneratedPoolDraft,
  type QuestionKnowledgeSource,
  type PoolQuestionType,
  type UnderstandSkill,
  understandSkillLabels,
  poolQuestionTypeLabels,
  poolBloomLevelLabels,
} from '@/features/questionPool/types'
import {
  registerEvaluationResponse,
  observeEvaluationDisplay,
} from '@/features/quizEvaluation/client'
import { withBasePath } from '@/utils/basePath'

const MAX_GENERATION_COUNT = 100

export const AdminQuestionStudio = ({
  username,
  knowledgeSources,
  lessons = [],
}: {
  username: string
  knowledgeSources: QuestionKnowledgeSource[]
  lessons?: { id: string; title: string }[]
}) => {
  const [datasetId, setDatasetId] = useState(knowledgeSources[0]?.id || '')
  const knowledge = knowledgeSources.find((source) => source.id === datasetId)
  const [count, setCount] = useState(5)
  const [difficultyLevel, setDifficultyLevel] = useState(2)
  const [variantCount, setVariantCount] = useState(0)
  const [questionType, setQuestionType] =
    useState<PoolQuestionType>('multiple_choice')
  const [understandSkill, setUnderstandSkill] = useState<UnderstandSkill | ''>(
    ''
  )
  const [evaluation, setEvaluation] = useState({
    runLabel: 'モデル比較1',
    modelLabel: '',
    notes: '',
  })
  const [items, setItems] = useState<GeneratedPoolDraft[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [recordVersion, setRecordVersion] = useState(0)
  const [poolVersion, setPoolVersion] = useState(0)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    items.forEach((item) => {
      if (item.evaluationId) observeEvaluationDisplay(item.evaluationId)
    })
  }, [items])

  const generate = async () => {
    if (busy) return
    if (!knowledge) {
      setErrors(['出題するナレッジを選択してください。'])
      return
    }
    if (!evaluation.runLabel.trim() || !evaluation.modelLabel.trim()) {
      setErrors(['試行名と使用LLMを入力してください。'])
      return
    }
    if (!Number.isInteger(count) || count < 1 || count > MAX_GENERATION_COUNT) {
      setErrors([`生成数は1〜${MAX_GENERATION_COUNT}の整数で入力してください。`])
      return
    }
    if (count * (variantCount + 1) > MAX_GENERATION_COUNT) {
      setErrors([
        `元問題と類題の合計が${MAX_GENERATION_COUNT}問以内になるように設定してください。`,
      ])
      return
    }
    setBusy(true)
    setErrors([])
    setItems([])
    setSavedIds(new Set())
    let succeeded = 0
    let failed = 0
    let retried = 0
    const usedSources = new Set<string>()
    try {
      for (let index = 0; index < count; index++) {
        setProgress(
          `${index + 1}/${count}問目を生成中（成功 ${succeeded}・失敗 ${failed}）`
        )
        let startedAt = performance.now()
        try {
          const rejectedSources = new Set<string>()
          let generated:
            | Awaited<ReturnType<typeof generatePoolQuestion>>
            | undefined
          for (let attempt = 0; attempt < 3; attempt++) {
            startedAt = performance.now()
            try {
              generated = await generatePoolQuestion({
                evaluation,
                datasetId,
                questionType,
                difficultyLevel,
                ...(questionType === 'written'
                  ? {
                      bloomLevel: 'understand' as const,
                      ...(understandSkill ? { understandSkill } : {}),
                    }
                  : {}),
                excludedSourceIds: [...usedSources],
                rejectedSourceIds: [...rejectedSources],
              })
              generated.sourceIds?.forEach((id) => usedSources.add(id))
              break
            } catch (error) {
              if (error instanceof PoolGenerationError) {
                error.sourceIds.forEach((id) => {
                  usedSources.add(id)
                  rejectedSources.add(id)
                })
                if (error.retryable && attempt < 2) {
                  retried++
                  setProgress(
                    `${index + 1}/${count}問目：別の教材範囲で再試行中（${attempt + 2}/3回目）`
                  )
                  const message = error.message
                  setErrors((prev) => [
                    ...prev,
                    `${index + 1}問目・${attempt + 1}回目：${message} 別の範囲で再試行します。`,
                  ])
                  continue
                }
              }
              throw error
            }
          }
          if (!generated) throw new Error('問題を生成できませんでした。')
          const result = generated
          const baseItem: GeneratedPoolDraft = {
            ...result.item,
            variantFamilyId: result.item.id,
            variantIndex: 0,
          }
          if (result.evaluationId)
            registerEvaluationResponse(
              result.evaluationId,
              startedAt,
              performance.now() - startedAt,
              true
            )
          const generatedItems: GeneratedPoolDraft[] = [
            { ...baseItem, evaluationId: result.evaluationId },
          ]
          succeeded++
          if (questionType === 'multiple_choice') {
            for (
              let variantIndex = 1;
              variantIndex <= variantCount;
              variantIndex++
            ) {
              setProgress(
                `${index + 1}/${count}問目の類題${variantIndex}/${variantCount}を生成中`
              )
              try {
                const variant = await generatePoolQuestion({
                  evaluation,
                  datasetId,
                  questionType,
                  difficultyLevel,
                  variantBase: {
                    familyId: baseItem.id,
                    question: baseItem.question,
                    correctAnswer: baseItem.correctAnswer,
                    wrongAnswers: baseItem.wrongAnswers,
                    sourceContext: baseItem.sourceContext || '',
                    sourceDatasetId: baseItem.sourceDatasetId || datasetId,
                    sourceDatasetName: baseItem.sourceDatasetName,
                    sourceDocumentId: baseItem.sourceDocumentId,
                    sourceDocumentName: baseItem.sourceDocumentName,
                    sourceSegmentIds: baseItem.sourceSegmentIds || [],
                    sourceSlideNumbers: baseItem.sourceSlideNumbers || [],
                    questionType,
                    variantIndex,
                  },
                })
                generatedItems.push({
                  ...variant.item,
                  evaluationId: variant.evaluationId,
                })
                succeeded++
              } catch (variantError) {
                failed++
                setErrors((prev) => [
                  ...prev,
                  `${index + 1}問目の類題${variantIndex}：${variantError instanceof Error ? variantError.message : '生成に失敗しました。'}`,
                ])
              }
            }
          }
          setItems((prev) => [...prev, ...generatedItems])
          if (result.warning)
            setErrors((prev) => [
              ...prev,
              `${index + 1}問目：${result.warning}`,
            ])
        } catch (error) {
          failed++
          setErrors((prev) => [
            ...prev,
            `${index + 1}問目：${error instanceof Error ? error.message : '生成に失敗しました。'}`,
          ])
        }
      }
      setProgress(
        `生成が完了しました。成功 ${succeeded}問・生成できなかった問題 ${failed}問（追加の再試行 ${retried}回）。下のCSVから結果を比較できます。`
      )
    } finally {
      setBusy(false)
      setRecordVersion((value) => value + 1)
    }
  }
  const saveItems = async (drafts: GeneratedPoolDraft[]) => {
    if (saving || !drafts.length) return
    setSaving(true)
    setErrors([])
    try {
      const result = await saveQuestionPoolItems(drafts)
      setSavedIds((prev) => {
        const next = new Set(prev)
        result.ids.forEach((id) => next.add(id))
        return next
      })
      setProgress(`${result.savedCount}問を問題プールに採用しました。`)
      setPoolVersion((value) => value + 1)
    } catch (error) {
      setErrors([
        error instanceof Error
          ? error.message
          : '問題プールへの保存に失敗しました。',
      ])
    } finally {
      setSaving(false)
    }
  }
  const field =
    'mt-2 w-full rounded-xl border border-[#cfe0fb] bg-white px-4 py-3 text-sm text-[#21304d]'
  return (
    <main className="min-h-screen bg-[#fbf8eb] px-4 py-8 pb-24 text-[#21304d]">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-black">
              問題をまとめて生成して、モデルを比較する
            </h1>
            <p className="text-sm leading-6">
              {username}{' '}
              さんの生成結果をCSVに記録します。Difyでモデルを変更・公開したら、使用LLMを記入して生成してください。
            </p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="管理画面">
            <span className="rounded-full bg-[#245dcc] px-4 py-2 text-sm font-bold text-white">
              問題プール管理
            </span>
            <a
              href={withBasePath('/admin/activity-logs/')}
              className="rounded-full border border-[#cfe0fb] bg-white px-4 py-2 text-sm font-bold text-[#245dcc]"
            >
              ログ確認
            </a>
          </nav>
        </header>
        <QuestionPoolOverview lessons={lessons} refreshKey={poolVersion} />
        <section className="space-y-4 rounded-[26px] border border-[#dbe5fb] bg-white p-6">
          <fieldset
            disabled={busy}
            className={`grid gap-4 ${questionType === 'written' ? 'md:grid-cols-2' : ''}`}
          >
            <div className="rounded-2xl bg-[#f3f7ff] p-4">
              <label htmlFor="pool-question-type" className="text-sm font-bold">
                問題形式
              </label>
              <select
                id="pool-question-type"
                className={field}
                value={questionType}
                onChange={(e) =>
                  setQuestionType(e.target.value as PoolQuestionType)
                }
              >
                {Object.entries(poolQuestionTypeLabels).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  )
                )}
              </select>
              <p className="mt-2 text-xs leading-6 text-[#526786]">
                {questionType === 'written'
                  ? '理解（Understand）の記述問題です。問い方を選ぶと、その認知活動に合わせて生成します。'
                  : '記憶（Remember）の4択問題です。教材に明記された用語・定義・事実を問います。'}
              </p>
            </div>
            {questionType === 'written' && (
              <div className="rounded-2xl bg-[#f3f7ff] p-4">
                <label
                  htmlFor="pool-understand-skill"
                  className="text-sm font-bold"
                >
                  理解の問い方
                </label>
                <select
                  id="pool-understand-skill"
                  className={field}
                  value={understandSkill}
                  onChange={(e) =>
                    setUnderstandSkill(e.target.value as UnderstandSkill | '')
                  }
                >
                  <option value="">指定なし（7種類から自動で選ぶ）</option>
                  {Object.entries(understandSkillLabels).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    )
                  )}
                </select>
                <p className="mt-2 text-xs leading-6 text-[#526786]">
                  解釈・例示・分類・要約・推測・比較・説明のいずれかを問います。例示では、教材内の例を答えるのではなく、教材の定義を使って身近な例を自分で考えます。
                </p>
              </div>
            )}
          </fieldset>
          <fieldset
            disabled={busy}
            className="grid gap-4 md:grid-cols-3 lg:grid-cols-6"
          >
            <label className="text-sm font-bold">
              出題するナレッジ
              <select
                className={field}
                value={datasetId}
                onChange={(e) => {
                  setDatasetId(e.target.value)
                  setItems([])
                  setErrors([])
                  setProgress('')
                }}
              >
                {knowledgeSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold">
              難易度
              <select
                className={field}
                value={difficultyLevel}
                onChange={(e) => setDifficultyLevel(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5, 6].map((value) => (
                  <option key={value} value={value}>
                    {value}（
                    {value <= 2 ? '基本' : value >= 5 ? '発展' : '標準'}）
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold">
              類題数／元問題
              <select
                className={field}
                value={questionType === 'multiple_choice' ? variantCount : 0}
                disabled={questionType !== 'multiple_choice'}
                onChange={(e) => setVariantCount(Number(e.target.value))}
              >
                <option value={0}>作らない</option>
                <option value={1}>1問</option>
                <option value={2}>2問</option>
              </select>
            </label>
            <label className="text-sm font-bold">
              生成数
              <input
                type="number"
                min={1}
                max={MAX_GENERATION_COUNT}
                step={1}
                className={field}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
            <label className="text-sm font-bold">
              試行名（CSV用）
              <input
                className={field}
                maxLength={200}
                value={evaluation.runLabel}
                onChange={(e) =>
                  setEvaluation((prev) => ({
                    ...prev,
                    runLabel: e.target.value,
                  }))
                }
              />
            </label>
            <label className="text-sm font-bold">
              使用LLM（CSV用・手入力）
              <input
                className={field}
                maxLength={200}
                placeholder="例：全ノード gpt-5-mini"
                value={evaluation.modelLabel}
                onChange={(e) =>
                  setEvaluation((prev) => ({
                    ...prev,
                    modelLabel: e.target.value,
                  }))
                }
              />
            </label>
          </fieldset>
          <p className="text-xs leading-6 text-[#6b7da1]">
            使用LLMの入力は記録用です。実際のモデルはDify側で変更します。4択問題は記憶、記述問題は理解に固定しています。一括生成には同じ出題条件を使い、選んだナレッジの本文だけから1問ずつ生成します。材料不足の場合は別の範囲で最大2回再試行し、失敗分もCSVに残します。生成結果を確認したうえで、採用する問題だけ保存してください。
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void generate()}
            className="rounded-xl bg-[#2563d9] px-6 py-3 font-bold text-white disabled:opacity-60"
          >
            {busy ? '生成中…' : 'まとめて問題を生成'}
          </button>
          {progress && (
            <p role="status" className="text-sm font-bold">
              {progress}
            </p>
          )}
          {!!errors.length && (
            <div
              role="alert"
              className="space-y-1 rounded-xl bg-red-50 p-3 text-sm text-red-800"
            >
              {errors.map((error, index) => (
                <p key={index}>{error}</p>
              ))}
            </div>
          )}
        </section>
        {!!items.length && (
          <section className="space-y-4">
            <h2 className="text-lg font-bold">
              今回生成した問題（{items.length}問）
            </h2>
            <button
              type="button"
              disabled={saving || items.every((item) => savedIds.has(item.id))}
              onClick={() =>
                void saveItems(items.filter((item) => !savedIds.has(item.id)))
              }
              className="rounded-xl bg-[#2563d9] px-5 py-3 font-bold text-white disabled:opacity-50"
            >
              {saving ? '保存中…' : '未採用の問題をまとめて採用'}
            </button>
            {items.map((item, index) => (
              <article
                key={item.id}
                className="space-y-3 rounded-2xl border border-[#dbe5fb] bg-white p-5"
              >
                <p className="text-xs font-bold text-[#3567c7]">
                  {poolQuestionTypeLabels[item.questionType]}
                  {item.questionType === 'written' &&
                    ` · ${poolBloomLevelLabels[item.bloomLevel]}${item.understandSkill ? `・${understandSkillLabels[item.understandSkill]}` : ''}`}
                </p>
                <h3 className="font-bold">
                  {index + 1}. {item.question}
                </h3>
                {item.questionType === 'multiple_choice' ? (
                  <ol className="list-[upper-alpha] space-y-1 pl-6 text-sm">
                    {item.choices.map((choice, i) => (
                      <li
                        key={i}
                        className={
                          i === item.correctIndex
                            ? 'font-bold text-green-800'
                            : ''
                        }
                      >
                        {choice}
                        {i === item.correctIndex ? '（正解）' : ''}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="rounded-xl bg-[#f3f7ff] p-4">
                    <h4 className="text-sm font-bold text-[#3567c7]">
                      模範回答
                    </h4>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-7">
                      {item.correctAnswer}
                    </p>
                  </div>
                )}
                <p className="text-sm leading-6">解説：{item.explanation}</p>
                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    disabled={saving || savedIds.has(item.id)}
                    onClick={() => void saveItems([item])}
                    className="rounded-xl border border-[#2563d9] px-4 py-2 text-sm font-bold text-[#2563d9] disabled:opacity-50"
                  >
                    {savedIds.has(item.id)
                      ? '問題プールに採用済み'
                      : '問題プールに採用'}
                  </button>
                  <span className="text-xs text-[#6b7da1]">
                    問題番号：生成 {index + 1}（保存時に採番）
                  </span>
                </div>
              </article>
            ))}
          </section>
        )}
        {knowledge && (
          <PoolGenerationRecords
            key={knowledge.id}
            refreshKey={recordVersion}
            knowledge={knowledge}
            onPoolSaved={() => setPoolVersion((value) => value + 1)}
          />
        )}
      </div>
    </main>
  )
}
