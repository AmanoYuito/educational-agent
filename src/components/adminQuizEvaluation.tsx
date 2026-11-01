import { useEffect, useState } from 'react'
import { withBasePath } from '@/utils/basePath'
import {
  loadEvaluationSettings,
  saveEvaluationSettings,
} from '@/features/quizEvaluation/client'
import type {
  QuizEvaluationRecord,
  QuizEvaluationSettings,
} from '@/features/quizEvaluation/types'
import {
  downloadQuizEvaluations,
  loadQuizEvaluations,
} from '../../app/lib/api/client'

const seconds = (ms: number | null) =>
  ms === null ? '未計測' : `${(ms / 1000).toFixed(2)}秒`
const field =
  'mt-1 w-full rounded-xl border border-[#C8D8EC] bg-white px-3 py-2 text-sm'
const button =
  'rounded-full bg-[#EEF4FF] px-4 py-2 text-sm font-bold text-[#245DCC] disabled:opacity-50'

export function AdminQuizEvaluation({
  userId,
  username,
}: {
  userId: string
  username: string
}) {
  const [settings, setSettings] = useState<QuizEvaluationSettings>({
    ownerId: userId,
    enabled: false,
    runLabel: '',
    modelLabel: '',
    notes: '',
  })
  const [active, setActive] = useState(false)
  const [filter, setFilter] = useState('')
  const [items, setItems] = useState<QuizEvaluationRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const refresh = async (run: string) => {
    setBusy(true)
    setError('')
    try {
      setItems(await loadQuizEvaluations(run))
    } catch (e) {
      setError(e instanceof Error ? e.message : '記録を取得できません。')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    const saved = loadEvaluationSettings()
    if (saved?.ownerId === userId) {
      setSettings(saved)
      setActive(saved.enabled)
    }
    void refresh('')
  }, [userId])

  const save = (enabled: boolean) => {
    setError('')
    if (enabled && (!settings.runLabel.trim() || !settings.modelLabel.trim())) {
      setError('試行名とモデル構成を入力してください。')
      return
    }
    try {
      const next = {
        ...settings,
        ownerId: userId,
        enabled,
        runLabel: settings.runLabel.trim(),
        modelLabel: settings.modelLabel.trim(),
      }
      saveEvaluationSettings(next)
      setSettings(next)
      setActive(enabled)
      setMessage(
        enabled
          ? '計測を有効にしました。同じタブでチャットへ戻り、問題を生成してください。'
          : '計測を停止しました。保存済みの記録は残ります。'
      )
    } catch {
      setError('ブラウザーに計測設定を保存できません。')
    }
  }
  const download = async () => {
    setBusy(true)
    setError('')
    try {
      await downloadQuizEvaluations(filter.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CSVを取得できません。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#fbf8eb] px-4 py-8 pb-24 text-[#24324A]">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">リアルタイム出題のモデル比較</h1>
            <span className="rounded-full bg-white px-3 py-1 text-sm">
              {active ? 'このタブで計測中' : '計測停止中'}
            </span>
          </div>
          <p className="text-sm">
            {username}{' '}
            さんの「問題生成」を記録します。通常の会話・解説・問題プールは対象外です。
          </p>
          <a className={button + ' inline-block'} href={withBasePath('/')}>
            チャットへ戻る
          </a>
        </header>

        <section className="space-y-4 rounded-2xl border border-[#C8D8EC] bg-white p-5">
          <h2 className="text-lg font-bold">1. 比較条件を記録する</h2>
          <p className="text-sm leading-6">
            Dify側で出題に使うモデルを変更・公開してから、ここに同じ構成を記入してください。この入力では実際のモデルは変更されません。モデルごとに同じ会話・教材・難易度を用意して比較します。
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-bold">
              試行名
              <input
                className={field}
                maxLength={200}
                value={settings.runLabel}
                placeholder="例：メール基礎・比較1"
                onChange={(e) =>
                  setSettings({ ...settings, runLabel: e.target.value })
                }
              />
            </label>
            <label className="text-sm font-bold">
              モデル構成（手入力）
              <input
                className={field}
                maxLength={200}
                value={settings.modelLabel}
                placeholder="例：4つのLLMすべて gpt-4o-mini"
                onChange={(e) =>
                  setSettings({ ...settings, modelLabel: e.target.value })
                }
              />
            </label>
          </div>
          <label className="block text-sm font-bold">
            設定メモ
            <textarea
              className={field}
              maxLength={2000}
              rows={3}
              value={settings.notes}
              placeholder="Difyの公開版、各処理のモデル・temperature・推論設定、教材、比較ケース番号など"
              onChange={(e) =>
                setSettings({ ...settings, notes: e.target.value })
              }
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button className={button} onClick={() => save(true)}>
              設定を保存して計測を開始
            </button>
            <button
              className={button}
              disabled={!active}
              onClick={() => save(false)}
            >
              計測を停止
            </button>
          </div>
          <p className="text-xs leading-6 text-[#526682]">
            設定はこのタブだけに保存されます。変更後は保存ボタンを押してください。記録は学習記録DBに保存され、ログイン中の管理者本人だけが閲覧できます。
          </p>
        </section>

        {message && (
          <p role="status" className="rounded-xl bg-[#EEF4FF] p-3 text-sm">
            {message}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </p>
        )}

        <section className="space-y-4 rounded-2xl border border-[#C8D8EC] bg-white p-5">
          <h2 className="text-lg font-bold">2. 出題して、結果を比較する</h2>
          <p className="text-sm leading-6">
            チャットで問題を生成した後、このページに戻って更新してください。成功は出題形式を確認できたことを表します。内容の正確さ・会話との関連・難易度・解説の質・採用可否はCSVの評価欄に記入できます。
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-56 flex-1 text-sm">
              試行名で絞り込み（完全一致・空欄は全件）
              <input
                className={field}
                maxLength={200}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            <button
              className={button}
              disabled={busy}
              onClick={() => void refresh(filter.trim())}
            >
              記録を更新
            </button>
            <button
              className={button}
              disabled={busy}
              onClick={() => void download()}
            >
              CSVをダウンロード
            </button>
          </div>
          <p className="text-xs leading-6 text-[#526682]">
            画面は最新100件、CSVは絞り込みに一致する最大1万件です。問題と選択肢はセットで保存されます。CSVには選択肢A〜D・正解・解説・生成原文・入力条件も含まれます。失敗も1件として残ります。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="p-2">日時／試行</th>
                  <th className="p-2">モデル構成</th>
                  <th className="p-2">結果</th>
                  <th className="p-2">表示まで</th>
                  <th className="p-2">報告tokens</th>
                  <th className="p-2">報告費用</th>
                  <th className="p-2">問題・選択肢</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b align-top">
                    <td className="min-w-36 p-2">
                      {new Date(item.createdAt).toLocaleString('ja-JP')}
                      <br />
                      {item.runLabel}
                    </td>
                    <td className="p-2">{item.modelLabel}</td>
                    <td className="p-2">
                      {item.status === 'success' ? '成功' : '失敗'}
                      {item.error && (
                        <p className="mt-1 text-xs text-red-800">
                          {item.error}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap p-2">
                      {seconds(item.displayMs)}
                    </td>
                    <td className="p-2">{item.usage.totalTokens ?? '不明'}</td>
                    <td className="whitespace-nowrap p-2">
                      {item.usage.totalPrice === null
                        ? '不明'
                        : `${item.usage.totalPrice} ${item.usage.currency || '通貨不明'}`}
                    </td>
                    <td className="min-w-64 p-2">
                      <p className="whitespace-pre-wrap break-words">
                        {item.question || '—'}
                      </p>
                      {!!item.choices?.length && (
                        <ol
                          aria-label="選択肢"
                          className="mt-2 list-[upper-alpha] space-y-1 pl-5 text-[#526682]"
                        >
                          {item.choices.map((choice, index) => (
                            <li
                              key={index}
                              className="whitespace-pre-wrap break-words"
                            >
                              {choice}
                            </li>
                          ))}
                        </ol>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && (
              <p className="py-6 text-center text-sm">
                {busy ? '読み込み中…' : 'まだ計測記録がありません。'}
              </p>
            )}
          </div>
          <p className="text-xs leading-6 text-[#526682]">
            表示時間は送信操作から問題の描画直後までの概算です。読み上げ完了は含みません。チャット欄が閉じている、タブが非表示、通信が途切れた場合は未計測になることがあります。
          </p>
          <p className="text-xs leading-6 text-[#526682]">
            トークン・費用はDify応答の報告値です。出題ワークフロー全体や再試行分を含むかは未確認のため、合計費用とは扱わずDifyの実行ログと照合してください。取得できない値は空欄／不明になります。モデル名も手入力の記録です。
          </p>
        </section>
      </div>
    </main>
  )
}
