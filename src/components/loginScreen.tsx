import { FormEvent, useState } from 'react'
import { Meta } from '@/components/meta'
import { withBasePath } from '@/utils/basePath'

type AuthMode = 'login' | 'register' | 'consent'

export const LoginScreen = () => {
  const [mode, setMode] = useState<AuthMode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const authenticate = async (endpoint: 'login' | 'register') => {
    setError('')
    setIsSubmitting(true)

    try {
      const response = await fetch(withBasePath(`/api/auth/${endpoint}/`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(
          data.error ??
            data.message ??
            (endpoint === 'login'
              ? 'ログインに失敗しました。'
              : '新規登録に失敗しました。')
        )
        return
      }

      window.location.assign(withBasePath('/'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    if (!username.trim() || !password) {
      setError('ユーザー名とパスワードを入力してください。')
      return
    }

    if (mode === 'register') {
      setMode('consent')
      return
    }

    await authenticate('login')
  }

  const registerWithConsent = async () => {
    await authenticate('register')
  }

  return (
    <div className="min-h-[100svh] bg-[#fbf8eb] px-5 py-8 text-[#1f2a44]">
      <Meta />
      <main
        className={`mx-auto flex min-h-[calc(100svh-4rem)] flex-col justify-center ${
          mode === 'consent' ? 'max-w-[900px]' : 'max-w-[480px]'
        }`}
      >
        <div className="rounded-[28px] border border-[#c8d7f4] bg-white/90 p-6 shadow-[0_18px_50px_rgba(86,112,164,0.18)]">
          {mode === 'consent' ? (
            <section>
              <h1 className="text-xl font-black text-[#1f2a44]">
                研究へのご協力について
              </h1>
              <p className="mt-3 text-sm font-bold leading-7 text-[#536484]">
                以下の内容を確認し、研究への参加に同意するか選んでください。
              </p>

              <div className="mt-5 space-y-5 rounded-2xl border border-[#c8d7f4] bg-[#f7f9ff] p-5 text-sm leading-7 text-[#33415f]">
                <div>
                  <h2 className="font-black text-[#1f2a44]">研究の目的</h2>
                  <p className="mt-1">
                    このシステムは、授業内容の確認や復習を支援し、対話的に説明することで理解を深めるための、研究用の学習支援AIエージェントです。
                  </p>
                </div>

                <div>
                  <h2 className="font-black text-[#1f2a44]">
                    研究で使用する情報
                  </h2>
                  <p className="mt-1">
                    システムとの会話、出題された問題、問題への回答と評価結果、回答時間、表示された解説・フィードバック、利用状況、利用後アンケートを分析します。
                  </p>
                </div>

                <div>
                  <h2 className="font-black text-[#1f2a44]">参加について</h2>
                  <p className="mt-1">
                    研究への参加は任意であり、参加・不参加は授業の成績に影響しません。分析や公表では個人を特定できない形で扱い、入力に個人情報が含まれていた場合は分析対象から除外します。
                  </p>
                </div>

                <p className="rounded-xl bg-[#fff7e6] px-4 py-3 font-bold text-[#76501d]">
                  本名や学籍番号など、個人を特定できる情報は入力しないでください。
                </p>
              </div>

              <p className="mt-5 text-sm font-black text-[#1f2a44]">
                上記を確認し、研究への参加に同意しますか？
              </p>

              {error && (
                <p className="mt-4 rounded-2xl bg-[#fff0f0] px-4 py-3 text-sm font-bold text-[#c73b3b]">
                  {error}
                </p>
              )}

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className="rounded-2xl border border-[#c8d7f4] bg-white px-4 py-4 text-base font-black text-[#536484] transition hover:bg-[#f5f8ff] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSubmitting}
                  onClick={() => {
                    setMode('register')
                    setError('')
                  }}
                >
                  いいえ
                </button>
                <button
                  type="button"
                  className="rounded-2xl bg-[#2563d9] px-4 py-4 text-base font-black text-white shadow-[0_14px_28px_rgba(37,99,217,0.28)] transition hover:bg-[#1f55bb] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSubmitting}
                  onClick={registerWithConsent}
                >
                  {isSubmitting ? '登録中...' : 'はい、同意します'}
                </button>
              </div>
            </section>
          ) : (
            <>
              <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl bg-[#edf3ff] p-1">
                <button
                  type="button"
                  className={`rounded-xl px-4 py-3 text-sm font-bold transition ${
                    mode === 'login'
                      ? 'bg-white text-[#2563d9] shadow-sm'
                      : 'text-[#6b7da1]'
                  }`}
                  onClick={() => {
                    setMode('login')
                    setError('')
                  }}
                >
                  ログイン
                </button>
                <button
                  type="button"
                  className={`rounded-xl px-4 py-3 text-sm font-bold transition ${
                    mode === 'register'
                      ? 'bg-white text-[#2563d9] shadow-sm'
                      : 'text-[#6b7da1]'
                  }`}
                  onClick={() => {
                    setMode('register')
                    setError('')
                  }}
                >
                  新規登録
                </button>
              </div>

              <p className="mb-5 text-sm font-bold text-[#6b7da1]">
                {mode === 'login'
                  ? 'ユーザー名とパスワードを入力してください'
                  : 'ユーザー名とパスワードを登録してください'}
              </p>

              <form className="space-y-4" onSubmit={submit}>
                <label className="block">
                  <span className="mb-2 block text-sm font-bold">
                    ユーザー名
                  </span>
                  <input
                    className="w-full rounded-2xl border border-[#c8d7f4] bg-white px-4 py-3 text-base font-bold outline-none transition focus:border-[#82a9f7] focus:ring-4 focus:ring-[#d9e7ff]"
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                  {mode === 'register' && (
                    <span className="mt-2 block text-xs font-medium leading-5 text-[#6b7da1]">
                      本名や学籍番号は使わず、個人が特定されにくいニックネームを設定してください。
                    </span>
                  )}
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-bold">
                    パスワード
                  </span>
                  <input
                    className="w-full rounded-2xl border border-[#c8d7f4] bg-white px-4 py-3 text-base font-bold outline-none transition focus:border-[#82a9f7] focus:ring-4 focus:ring-[#d9e7ff]"
                    type="password"
                    autoComplete={
                      mode === 'login' ? 'current-password' : 'new-password'
                    }
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>

                {error && (
                  <p className="rounded-2xl bg-[#fff0f0] px-4 py-3 text-sm font-bold text-[#c73b3b]">
                    {error}
                  </p>
                )}

                <button
                  className="w-full rounded-2xl bg-[#2563d9] px-4 py-4 text-base font-black text-white shadow-[0_14px_28px_rgba(37,99,217,0.28)] transition hover:bg-[#1f55bb] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSubmitting}
                  type="submit"
                >
                  {isSubmitting
                    ? '処理中...'
                    : mode === 'login'
                      ? 'ログイン'
                      : '新規登録'}
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
