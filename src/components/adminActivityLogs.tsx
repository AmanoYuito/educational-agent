import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ChartBarIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'

import type {
  ActivityLogItem,
  ActivityLogResponse,
  ActivityLogType,
  ActivityLogUser,
  ActivityLogUsersResponse,
} from '@/features/admin/activityLogs'
import { buildActivityLogsApiPath } from '@/features/admin/activityLogApi'
import { understandSkillLabels } from '@/features/questionPool/types'
import { withBasePath } from '@/utils/basePath'

type LessonOption = { id: string; title: string }

const emptyResponse: ActivityLogResponse = {
  items: [],
  users: [],
  stats: {
    total: 0,
    chat: 0,
    quiz: 0,
    feedback: 0,
    quizCorrect: 0,
    quizPartial: 0,
    quizReview: 0,
    averageResponseMs: null,
    multipleChoice: 0,
    multipleChoiceCorrect: 0,
    written: 0,
    writtenUnderstood: 0,
    writtenPartial: 0,
    writtenReview: 0,
    activity: 0,
    activeTimeMs: 0,
    materialTimeMs: 0,
    avatarTimeMs: 0,
    quizTimeMs: 0,
    conversationTimeMs: 0,
    materialPageViews: 0,
    materialConsultsDuringQuiz: 0,
  },
  skills: [],
  devices: [],
  pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 },
}

const logLabels: Record<ActivityLogType, string> = {
  chat: '会話',
  quiz: '問題回答',
  feedback: '学習フィードバック',
  activity: '学習行動',
}

const logColors: Record<ActivityLogType, string> = {
  chat: 'bg-[#eef4ff] text-[#245dcc]',
  quiz: 'bg-[#fff4df] text-[#9b5b00]',
  feedback: 'bg-[#edf8f1] text-[#1d7041]',
  activity: 'bg-[#f0edff] text-[#6547b7]',
}

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))

const itemTitle = (item: ActivityLogItem) => {
  if (item.type === 'quiz') return item.question || '問題回答'
  if (item.type === 'feedback')
    return `${item.checkpointAnswered || 0}問回答時点のフィードバック`
  if (item.type === 'activity') {
    const labels: Record<string, string> = {
      page_enter: '授業画面を開いた',
      workspace_view: '表示画面を切り替えた',
      active_time: '学習時間を記録した',
      material_page_view: '授業資料を閲覧した',
      material_scroll: '授業資料をスクロールした',
      material_open_external: '授業資料を別画面で開いた',
    }
    return labels[item.subtype] || '学習行動'
  }
  return item.subtype === 'user' ? '学習者の発言' : 'AIの応答'
}

const formatResponseTime = (value: number | null) => {
  if (value === null) return '記録なし'
  const seconds = Math.max(0.1, Math.round(value / 100) / 10)
  return seconds < 60
    ? `${seconds}秒`
    : `${Math.floor(seconds / 60)}分${Math.round(seconds % 60)}秒`
}

const formatDuration = (value: number) => {
  const minutes = Math.floor(Math.max(0, value) / 60000)
  if (minutes < 1) return value > 0 ? '1分未満' : '0分'
  if (minutes < 60) return `${minutes}分`
  return `${Math.floor(minutes / 60)}時間${minutes % 60}分`
}

const rate = (value: number, total: number) =>
  total > 0 ? Math.round((value / total) * 100) : 0

export const AdminActivityLogs = ({ lessons }: { lessons: LessonOption[] }) => {
  const [filters, setFilters] = useState({
    lessonId: '',
    userId: '',
    type: '',
    search: '',
    from: '',
    to: '',
  })
  const [appliedFilters, setAppliedFilters] = useState(filters)
  const [data, setData] = useState<ActivityLogResponse>(emptyResponse)
  const [users, setUsers] = useState<ActivityLogUser[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const lessonNames = useMemo(
    () => new Map(lessons.map((lesson) => [lesson.id, lesson.title])),
    [lessons]
  )

  const csvUrl = useMemo(() => {
    const search = new URLSearchParams({ format: 'csv' })
    Object.entries(appliedFilters).forEach(([key, value]) => {
      if (value) search.set(key, value)
    })
    return withBasePath(buildActivityLogsApiPath(search))
  }, [appliedFilters])

  const loadUsers = useCallback(async () => {
    try {
      const response = await fetch(
        withBasePath(
          buildActivityLogsApiPath(new URLSearchParams({ view: 'users' }))
        ),
        { credentials: 'include', cache: 'no-store' }
      )
      if (!response.ok) return
      const result = (await response.json()) as ActivityLogUsersResponse
      if (Array.isArray(result.users)) setUsers(result.users)
    } catch (usersError) {
      console.warn('Failed to load activity log users:', usersError)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const search = new URLSearchParams({ page: String(page), pageSize: '25' })
      Object.entries(appliedFilters).forEach(([key, value]) => {
        if (value) search.set(key, value)
      })
      const response = await fetch(
        withBasePath(buildActivityLogsApiPath(search)),
        { credentials: 'include', cache: 'no-store' }
      )
      const responseText = await response.text()
      let result: ActivityLogResponse | { message?: string; requestId?: string }
      try {
        result = JSON.parse(responseText) as
          | ActivityLogResponse
          | { message?: string; requestId?: string }
      } catch {
        throw new Error(
          response.ok
            ? 'ログの応答形式を確認できませんでした。'
            : 'ログを取得できませんでした。'
        )
      }
      if (!response.ok)
        throw new Error(
          'message' in result && result.message
            ? `${result.message}${result.requestId ? `（確認番号: ${result.requestId}）` : ''}`
            : 'ログを取得できませんでした。'
        )
      const nextData = result as ActivityLogResponse
      setData(nextData)
      if (nextData.users.length > 0) setUsers(nextData.users)
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'ログを取得できませんでした。'
      )
    } finally {
      setLoading(false)
    }
  }, [appliedFilters, page])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  const applyFilters = (event: FormEvent) => {
    event.preventDefault()
    setPage(1)
    setAppliedFilters(filters)
  }

  const resetFilters = () => {
    const cleared = {
      lessonId: '',
      userId: '',
      type: '',
      search: '',
      from: '',
      to: '',
    }
    setFilters(cleared)
    setAppliedFilters(cleared)
    setPage(1)
  }

  const field =
    'mt-2 w-full rounded-xl border border-[#cfe0fb] bg-white px-3 py-2.5 text-sm text-[#21304d] outline-none focus:border-[#6d98e6] focus:ring-2 focus:ring-[#dce9ff]'
  const summaryCards = [
    {
      label: '問題回答',
      value: `${data.stats.quiz}件`,
      note: `全ログ ${data.stats.total}件`,
      icon: ClipboardDocumentCheckIcon,
    },
    {
      label: '正解・理解できている',
      value: `${rate(data.stats.quizCorrect, data.stats.quiz)}%`,
      note: `${data.stats.quizCorrect}/${data.stats.quiz}件`,
      icon: CheckCircleIcon,
    },
    {
      label: '一部理解・要復習',
      value: `${data.stats.quizPartial + data.stats.quizReview}件`,
      note: `一部理解 ${data.stats.quizPartial}・要復習 ${data.stats.quizReview}`,
      icon: ChartBarIcon,
    },
    {
      label: '平均回答時間',
      value: formatResponseTime(data.stats.averageResponseMs),
      note: '回答時間を記録できた問題',
      icon: ClockIcon,
    },
  ]

  return (
    <main className="min-h-screen bg-[#fbf8eb] px-4 py-8 pb-24 text-[#21304d]">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-bold text-[#245dcc]">管理者専用</p>
            <h1 className="mt-1 text-2xl font-black">学習ログ</h1>
            <p className="mt-2 text-sm leading-6 text-[#526786]">
              会話、問題への回答、節目のフィードバックを授業回とユーザーごとに確認できます。
            </p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="管理画面">
            <a
              href={withBasePath('/admin/question-studio/')}
              className="rounded-full border border-[#cfe0fb] bg-white px-4 py-2 text-sm font-bold text-[#245dcc]"
            >
              問題プール管理
            </a>
            <span className="rounded-full bg-[#245dcc] px-4 py-2 text-sm font-bold text-white">
              ログ確認
            </span>
          </nav>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {summaryCards.map(({ label, value, note, icon: Icon }) => (
            <div
              key={label}
              className="rounded-2xl border border-[#dbe5fb] bg-white p-5"
            >
              <div className="flex items-center gap-2 text-sm font-bold text-[#526786]">
                <Icon className="h-5 w-5" aria-hidden="true" />
                {label}
              </div>
              <p className="mt-3 text-3xl font-black">{value}</p>
              <p className="mt-2 text-xs leading-5 text-[#6c7e99]">{note}</p>
            </div>
          ))}
          <div className="rounded-2xl border border-[#dbe5fb] bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-[#526786]">
              <ClockIcon className="h-5 w-5" aria-hidden="true" />
              学習時間
            </div>
            <p className="mt-3 text-3xl font-black">
              {formatDuration(data.stats.activeTimeMs)}
            </p>
            <p className="mt-2 text-xs leading-5 text-[#6c7e99]">
              操作中の時間のみ集計
            </p>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[24px] border border-[#dbe5fb] bg-white p-5">
            <h2 className="font-black">問題形式ごとの結果</h2>
            <div className="mt-4 space-y-4">
              <div>
                <div className="flex items-center justify-between text-sm font-bold">
                  <span>4択・記憶</span>
                  <span>
                    {data.stats.multipleChoiceCorrect}/
                    {data.stats.multipleChoice}件
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e9eef7]">
                  <div
                    className="h-full rounded-full bg-[#3976dc]"
                    style={{
                      width: `${rate(data.stats.multipleChoiceCorrect, data.stats.multipleChoice)}%`,
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-sm font-bold">
                  <span>記述・理解</span>
                  <span>
                    {data.stats.writtenUnderstood}/{data.stats.written}件
                  </span>
                </div>
                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[#e9eef7]">
                  <div
                    className="h-full bg-[#2f9b62]"
                    style={{
                      width: `${rate(data.stats.writtenUnderstood, data.stats.written)}%`,
                    }}
                  />
                  <div
                    className="h-full bg-[#e6a83b]"
                    style={{
                      width: `${rate(data.stats.writtenPartial, data.stats.written)}%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-[#6c7e99]">
                  理解 {data.stats.writtenUnderstood}・一部理解{' '}
                  {data.stats.writtenPartial}・要復習 {data.stats.writtenReview}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-[#dbe5fb] bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-black">理解の問い方ごとの結果</h2>
                <p className="mt-1 text-xs text-[#6c7e99]">
                  記述問題の得意・苦手を7分類で確認できます。
                </p>
              </div>
              <span className="text-xs font-bold text-[#526786]">
                緑：理解　黄：一部理解
              </span>
            </div>
            {data.skills.length ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {data.skills.map((skill) => {
                  const label =
                    understandSkillLabels[
                      skill.skill as keyof typeof understandSkillLabels
                    ] || skill.skill
                  return (
                    <div
                      key={skill.skill}
                      className="rounded-xl bg-[#f7f9fd] p-3"
                    >
                      <div className="flex items-center justify-between gap-2 text-sm font-bold">
                        <span>{label}</span>
                        <span>{skill.attempts}問</span>
                      </div>
                      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[#e4e9f2]">
                        <div
                          className="h-full bg-[#2f9b62]"
                          style={{
                            width: `${rate(skill.understood, skill.attempts)}%`,
                          }}
                        />
                        <div
                          className="h-full bg-[#e6a83b]"
                          style={{
                            width: `${rate(skill.partial, skill.attempts)}%`,
                          }}
                        />
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-[#6c7e99]">
                        理解 {skill.understood}・一部 {skill.partial}・要復習{' '}
                        {skill.review}　平均{' '}
                        {formatResponseTime(skill.averageResponseMs)}
                      </p>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="mt-4 rounded-xl bg-[#f7f9fd] p-4 text-sm text-[#6c7e99]">
                条件に一致する記述問題の回答はまだありません。
              </p>
            )}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-[24px] border border-[#dbe5fb] bg-white p-5">
            <h2 className="font-black">画面・教材の利用状況</h2>
            <p className="mt-1 text-xs leading-5 text-[#6c7e99]">
              操作があった時間と、問題回答中の教材確認を集計します。
            </p>
            <div className="mt-4 space-y-4 text-sm">
              {[
                ['授業資料画面', data.stats.materialTimeMs, '#3976dc'],
                ['アバター画面', data.stats.avatarTimeMs, '#9a6bc1'],
              ].map(([label, value, color]) => {
                const numeric = Number(value)
                const total = Math.max(
                  1,
                  data.stats.materialTimeMs + data.stats.avatarTimeMs
                )
                return (
                  <div key={String(label)}>
                    <div className="flex justify-between font-bold">
                      <span>{label}</span>
                      <span>{formatDuration(numeric)}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e9eef7]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.round((numeric / total) * 100)}%`,
                          backgroundColor: String(color),
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-[#f7f9fd] p-3">
                <p className="text-xs text-[#6c7e99]">問題中の資料確認</p>
                <p className="mt-1 text-xl font-black">
                  {data.stats.materialConsultsDuringQuiz}回
                </p>
              </div>
              <div className="rounded-xl bg-[#f7f9fd] p-3">
                <p className="text-xs text-[#6c7e99]">資料ページ表示</p>
                <p className="mt-1 text-xl font-black">
                  {data.stats.materialPageViews}回
                </p>
              </div>
              <div className="rounded-xl bg-[#f7f9fd] p-3">
                <p className="text-xs text-[#6c7e99]">問題モード</p>
                <p className="mt-1 font-black">
                  {formatDuration(data.stats.quizTimeMs)}
                </p>
              </div>
              <div className="rounded-xl bg-[#f7f9fd] p-3">
                <p className="text-xs text-[#6c7e99]">会話モード</p>
                <p className="mt-1 font-black">
                  {formatDuration(data.stats.conversationTimeMs)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-[#dbe5fb] bg-white p-5">
            <h2 className="font-black">利用環境</h2>
            <p className="mt-1 text-xs leading-5 text-[#6c7e99]">
              端末・OS・ブラウザをUser-Agentから分類しています。IPは匿名化値だけを保存します。
            </p>
            <div className="mt-4 space-y-2">
              {data.devices.length ? (
                data.devices.map((device, index) => (
                  <div
                    key={`${device.deviceType}-${device.osName}-${device.browserName}-${index}`}
                    className="flex items-center justify-between gap-3 rounded-xl bg-[#f7f9fd] px-4 py-3 text-sm"
                  >
                    <div>
                      <p className="font-bold">
                        {device.deviceType}・{device.osName}
                      </p>
                      <p className="mt-1 text-xs text-[#6c7e99]">
                        {device.browserName} / {device.events}イベント
                      </p>
                    </div>
                    <span className="font-black text-[#245dcc]">
                      {formatDuration(device.activeTimeMs)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="rounded-xl bg-[#f7f9fd] p-4 text-sm text-[#6c7e99]">
                  利用環境の記録はまだありません。
                </p>
              )}
            </div>
          </div>
        </section>

        <form
          onSubmit={applyFilters}
          className="rounded-[24px] border border-[#dbe5fb] bg-white p-5"
        >
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-sm font-bold">
              授業回
              <select
                className={field}
                value={filters.lessonId}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    lessonId: event.target.value,
                  }))
                }
              >
                <option value="">すべての授業回</option>
                {lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lesson.title}
                  </option>
                ))}
                <option value="legacy">旧データ</option>
              </select>
            </label>
            <label className="text-sm font-bold">
              ユーザー
              <select
                className={field}
                value={filters.userId}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    userId: event.target.value,
                  }))
                }
              >
                <option value="">すべてのユーザー</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold">
              種別
              <select
                className={field}
                value={filters.type}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    type: event.target.value,
                  }))
                }
              >
                <option value="">すべて</option>
                <option value="chat">会話</option>
                <option value="quiz">問題回答</option>
                <option value="feedback">学習フィードバック</option>
                <option value="activity">学習行動</option>
              </select>
            </label>
            <label className="text-sm font-bold">
              開始日
              <input
                type="date"
                className={field}
                value={filters.from}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    from: event.target.value,
                  }))
                }
              />
            </label>
            <label className="text-sm font-bold">
              終了日
              <input
                type="date"
                className={field}
                value={filters.to}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    to: event.target.value,
                  }))
                }
              />
            </label>
            <label className="text-sm font-bold">
              キーワード
              <input
                className={field}
                maxLength={200}
                placeholder="問題文、回答、会話など"
                value={filters.search}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    search: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-xl bg-[#245dcc] px-5 py-2.5 text-sm font-bold text-white"
            >
              絞り込む
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-[#cfe0fb] px-5 py-2.5 text-sm font-bold text-[#245dcc] disabled:opacity-50"
            >
              <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
              更新
            </button>
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-xl border border-[#dbe5fb] px-5 py-2.5 text-sm font-bold text-[#526786]"
            >
              条件をクリア
            </button>
            <a
              href={csvUrl}
              className="ml-auto inline-flex items-center gap-2 rounded-xl bg-[#1d7041] px-5 py-2.5 text-sm font-bold text-white"
            >
              <ArrowDownTrayIcon className="h-4 w-4" aria-hidden="true" />
              絞り込み結果をCSV保存
            </a>
          </div>
          <p className="mt-3 text-xs text-[#6c7e99]">
            CSVには日時、授業回、問題文、回答、判定、回答時間、画面、教材ページ、端末、OS、ブラウザ、匿名化IPなどが含まれます。
          </p>
        </form>

        <section className="space-y-3" aria-busy={loading}>
          {error && (
            <div
              role="alert"
              className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700"
            >
              {error}
            </div>
          )}
          {loading && !data.items.length && (
            <div className="rounded-2xl border border-[#dbe5fb] bg-white p-8 text-center text-sm text-[#526786]">
              ログを読み込んでいます。
            </div>
          )}
          {!loading && !error && !data.items.length && (
            <div className="rounded-2xl border border-[#dbe5fb] bg-white p-8 text-center text-sm text-[#526786]">
              条件に一致するログはありません。
            </div>
          )}
          {data.items.map((item) => (
            <article
              key={`${item.type}-${item.id}`}
              className="rounded-[22px] border border-[#dbe5fb] bg-white p-5"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`rounded-full px-3 py-1 font-bold ${logColors[item.type]}`}
                >
                  {logLabels[item.type]}
                </span>
                <span className="font-bold text-[#21304d]">
                  {item.username}
                </span>
                <span className="text-[#6c7e99]">
                  {lessonNames.get(item.lessonId) ||
                    (item.lessonId === 'legacy' ? '旧データ' : item.lessonId)}
                </span>
                <time className="ml-auto text-[#6c7e99]">
                  {formatDate(item.createdAt)}
                </time>
              </div>
              <h2 className="mt-3 break-words text-base font-bold leading-7">
                {itemTitle(item)}
              </h2>
              {item.type === 'chat' && item.content && (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-[#42536e]">
                  {item.content}
                </p>
              )}
              {item.type === 'quiz' && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="md:col-span-2 flex flex-wrap gap-2 text-xs font-bold text-[#526786]">
                    <span className="rounded-full bg-[#eef4ff] px-3 py-1">
                      {item.subtype === 'written' ? '記述・理解' : '4択・記憶'}
                    </span>
                    {item.questionGroup && (
                      <span className="rounded-full bg-[#f2f4f8] px-3 py-1">
                        分野：{item.questionGroup}
                      </span>
                    )}
                    {typeof item.difficultyLevel === 'number' && (
                      <span className="rounded-full bg-[#f2f4f8] px-3 py-1">
                        難易度 {item.difficultyLevel}
                      </span>
                    )}
                    {typeof item.score === 'number' && (
                      <span className="rounded-full bg-[#f2f4f8] px-3 py-1">
                        {item.score}点
                      </span>
                    )}
                    {typeof item.responseTimeMs === 'number' && (
                      <span className="rounded-full bg-[#f2f4f8] px-3 py-1">
                        回答 {formatResponseTime(item.responseTimeMs)}
                      </span>
                    )}
                  </div>
                  <div className="rounded-xl bg-[#f7f9fd] p-4 text-sm leading-6">
                    <p className="font-bold">学習者の回答</p>
                    <p className="mt-1 whitespace-pre-wrap break-words">
                      {item.userAnswer || '（回答なし）'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[#f7f9fd] p-4 text-sm leading-6">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold">正答・判定</p>
                      <span
                        className={`font-bold ${item.answerStatus === 'unanswered' ? 'text-[#6c7e99]' : item.isCorrect ? 'text-[#1d7041]' : 'text-[#b34a3e]'}`}
                      >
                        {item.answerStatus === 'unanswered'
                          ? '未回答'
                          : item.assessmentLevel === 'understood'
                            ? '理解できている'
                            : item.assessmentLevel === 'partial'
                              ? '一部理解'
                              : item.assessmentLevel === 'review'
                                ? '要復習'
                                : item.isCorrect
                                  ? '正解'
                                  : '不正解'}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words">
                      {item.correctAnswer || '（正答情報なし）'}
                    </p>
                    {item.understandSkill && (
                      <p className="mt-2 text-xs text-[#6c7e99]">
                        理解の問い方：
                        {understandSkillLabels[
                          item.understandSkill as keyof typeof understandSkillLabels
                        ] || item.understandSkill}
                      </p>
                    )}
                  </div>
                  {item.content && (
                    <details className="md:col-span-2 rounded-xl border border-[#e2e9f5] p-4 text-sm leading-7">
                      <summary className="cursor-pointer font-bold">
                        解説を表示
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap break-words text-[#42536e]">
                        {item.content}
                      </p>
                    </details>
                  )}
                </div>
              )}
              {item.type === 'feedback' && (
                <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-[#edf8f1] p-4 text-sm leading-7 text-[#285b40]">
                  {item.feedbackText}
                </p>
              )}
              {item.type === 'activity' && (
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  {item.durationMs !== null && (
                    <div className="rounded-xl bg-[#f7f9fd] p-3">
                      <p className="text-xs text-[#6c7e99]">活動時間</p>
                      <p className="mt-1 font-bold">
                        {formatDuration(item.durationMs)}
                      </p>
                    </div>
                  )}
                  {item.viewMode && (
                    <div className="rounded-xl bg-[#f7f9fd] p-3">
                      <p className="text-xs text-[#6c7e99]">表示画面</p>
                      <p className="mt-1 font-bold">
                        {item.viewMode === 'material' ? '授業資料' : 'アバター'}
                      </p>
                    </div>
                  )}
                  {item.pageNumber !== null && (
                    <div className="rounded-xl bg-[#f7f9fd] p-3">
                      <p className="text-xs text-[#6c7e99]">資料ページ</p>
                      <p className="mt-1 font-bold">
                        {item.pageNumber}
                        {item.pageCount ? ` / ${item.pageCount}` : ''}
                      </p>
                    </div>
                  )}
                  <div className="rounded-xl bg-[#f7f9fd] p-3">
                    <p className="text-xs text-[#6c7e99]">利用環境</p>
                    <p className="mt-1 font-bold">
                      {[item.deviceType, item.osName, item.browserName]
                        .filter(Boolean)
                        .join('・') || '不明'}
                    </p>
                  </div>
                  {item.ipHash && (
                    <div className="rounded-xl bg-[#f7f9fd] p-3 sm:col-span-2">
                      <p className="text-xs text-[#6c7e99]">匿名化IP識別値</p>
                      <p className="mt-1 break-all font-mono text-xs">
                        {item.ipHash}
                      </p>
                    </div>
                  )}
                  {item.metadata.consultedDuringQuiz === true && (
                    <div className="rounded-xl bg-[#edf8f1] p-3 font-bold text-[#1d7041]">
                      問題回答中に教材を確認
                    </div>
                  )}
                  {typeof item.metadata.scrollDepthPercent === 'number' && (
                    <div className="rounded-xl bg-[#f7f9fd] p-3">
                      <p className="text-xs text-[#6c7e99]">
                        資料のスクロール位置
                      </p>
                      <p className="mt-1 font-bold">
                        {Math.round(item.metadata.scrollDepthPercent)}%
                      </p>
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
        </section>

        <div className="flex items-center justify-between rounded-2xl border border-[#dbe5fb] bg-white p-4 text-sm">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="rounded-xl border border-[#cfe0fb] px-4 py-2 font-bold text-[#245dcc] disabled:opacity-40"
          >
            前へ
          </button>
          <span className="font-bold">
            {data.pagination.page} / {data.pagination.totalPages}ページ
          </span>
          <button
            type="button"
            disabled={page >= data.pagination.totalPages || loading}
            onClick={() => setPage((current) => current + 1)}
            className="rounded-xl border border-[#cfe0fb] px-4 py-2 font-bold text-[#245dcc] disabled:opacity-40"
          >
            次へ
          </button>
        </div>
      </div>
    </main>
  )
}
