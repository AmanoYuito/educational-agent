import { useState, KeyboardEvent, useEffect, useMemo } from 'react'

import settingsStore from '@/features/stores/settings'
import { withBasePath } from '@/utils/basePath'

import { useTranslation } from 'react-i18next'

type SendType = 'direct_send' | 'ai_generate' | 'user_input' | 'dify'

type ExperimentCondition = 'emotion_on' | 'emotion_off'

type LogEntry = {
  ts: string
  participantId: string
  condition: ExperimentCondition
  question: string
  choices: string[]
  answerIndex: number
  selectedIndex: number
  correct: boolean
  responseTimeMs: number | null
  emotionApplied: boolean
  emotionName: 'happy' | 'rage' | 'sweat' | 'reset' | 'none'
}

interface RequestBody {
  messages: string[]
  systemPrompt?: string
  useCurrentSystemPrompt: boolean
  conversationId?: string | null
}

const SendMessage = () => {
  const [directMessages, setDirectMessages] = useState(Array(1).fill(''))
  const [aiMessages, setAiMessages] = useState(Array(1).fill(''))
  const [directFieldCount, setDirectFieldCount] = useState(1)
  const [aiFieldCount, setAiFieldCount] = useState(1)
  const [userInputMessages, setUserInputMessages] = useState(Array(1).fill(''))
  const [userInputFieldCount, setUserInputFieldCount] = useState(1)
  const [difyMessages, setDifyMessages] = useState(Array(1).fill(''))
  const [difyFieldCount, setDifyFieldCount] = useState(1)
  const [clientId, setClientId] = useState('')
  const [directResponse, setDirectResponse] = useState('')
  const [aiResponse, setAiResponse] = useState('')
  const [userInputResponse, setUserInputResponse] = useState('')
  const [difyResponse, setDifyResponse] = useState('')
  const [difyConversationId, setDifyConversationId] = useState<string | null>(
    null
  )
  const [copySuccess, setCopySuccess] = useState('')
  const [popupPosition, setPopupPosition] = useState<{
    x: number
    y: number
  } | null>(null)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [useCurrentSystemPrompt, setUseCurrentSystemPrompt] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [activeTab, setActiveTab] = useState<SendType>('direct_send')
  const { t } = useTranslation()

  // ===== Experiment (manual A/B) =====
  const [participantId, setParticipantId] = useState('')
  const [condition, setCondition] = useState<ExperimentCondition>('emotion_on')
  const isEmotionOn = condition === 'emotion_on'

  const [logs, setLogs] = useState<LogEntry[]>([])
  const [showLogs, setShowLogs] = useState(false)

  // Cross-tab bridge (send-message -> participant screen)
  // NOTE: window.dispatchEvent only works in the same tab. BroadcastChannel lets us control another tab.
  const LIVE2D_CHANNEL = 'aituber:live2d'

  const postLive2D = (payload: any) => {
    try {
      // Use BroadcastChannel when available (Chrome/Safari/Edge supported)
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const ch = new BroadcastChannel(LIVE2D_CHANNEL)
        ch.postMessage(payload)
        ch.close()
        return true
      }
    } catch (e) {
      console.warn('[send-message] BroadcastChannel post failed', e)
    }
    return false
  }

  const logsCsv = useMemo(() => {
    const header = [
      'ts',
      'participantId',
      'condition',
      'question',
      'choices',
      'answerIndex',
      'selectedIndex',
      'correct',
      'responseTimeMs',
      'emotionApplied',
      'emotionName',
    ]

    const esc = (v: unknown) => {
      const s = String(v ?? '')
      const needs = /[\n\r,\"]/g.test(s)
      const q = s.replace(/\"/g, '""')
      return needs ? `"${q}"` : q
    }

    const rows = logs.map((l) => [
      l.ts,
      l.participantId,
      l.condition,
      l.question,
      JSON.stringify(l.choices),
      l.answerIndex,
      l.selectedIndex,
      l.correct,
      l.responseTimeMs ?? '',
      l.emotionApplied,
      l.emotionName,
    ])

    return [header, ...rows].map((row) => row.map(esc).join(',')).join('\n')
  }, [logs])

  const live2dApplyEmotion = (next: { rage?: number; sweat?: number }) => {
    console.log('[send-message] live2dApplyEmotion called', next)
    const fn = (window as any).__live2dApplyEmotion as
      | ((v: { rage?: number; sweat?: number }) => void)
      | undefined

    if (typeof fn === 'function') {
      console.log('[send-message] using window.__live2dApplyEmotion')
      fn(next)
      return
    }

    // Fallback 1: cross-tab (participant screen) via BroadcastChannel
    const params: Record<string, number> = {
      ...(typeof next.rage === 'number' ? { PARAM_RAGE: next.rage } : {}),
      ...(typeof next.sweat === 'number' ? { PARAM_SWEAT: next.sweat } : {}),
    }

    console.log('[send-message] fallback broadcast live2d:emotion', params)
    if (postLive2D({ type: 'emotion', params })) return

    // Fallback 2: same-tab CustomEvent
    console.log('[send-message] fallback event live2d:emotion', params)
    window.dispatchEvent(
      new CustomEvent('live2d:emotion', {
        detail: { params },
      })
    )
  }

  const live2dSetHappy = (on: boolean) => {
    const fn = (window as any).__live2dSetHappy as
      | ((v: boolean) => void)
      | undefined

    if (typeof fn === 'function') {
      fn(!!on)
      return
    }

    console.log('[send-message] fallback broadcast live2d:happy', { on: !!on })
    if (postLive2D({ type: 'happy', on: !!on })) return

    window.dispatchEvent(
      new CustomEvent('live2d:happy', {
        detail: { on: !!on },
      })
    )
  }

  const setRage = () => {
    console.log('[send-message] setRage clicked. isEmotionOn=', isEmotionOn)
    // Condition B: do not apply emotions
    if (!isEmotionOn) return

    live2dSetHappy(false)
    live2dApplyEmotion({ rage: 1, sweat: 0 })
  }

  const setSweat = () => {
    // Condition B: do not apply emotions
    if (!isEmotionOn) return

    live2dSetHappy(false)
    live2dApplyEmotion({ rage: 0, sweat: 1 })
  }

  const resetEmotion = () => {
    // Condition B: do not apply emotions
    if (!isEmotionOn) return

    live2dSetHappy(false)
    live2dApplyEmotion({ rage: 0, sweat: 0 })
  }

  const setHappyOn = () => {
    // Condition B: do not apply emotions
    if (!isEmotionOn) return

    live2dApplyEmotion({ rage: 0, sweat: 0 })
    live2dSetHappy(true)
  }

  type Quiz = {
    question: string
    choices: string[]
    answerIndex: number
    explanation?: string
  }

  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [quizResult, setQuizResult] = useState('')
  const [quizAnsweredIndex, setQuizAnsweredIndex] = useState<number | null>(
    null
  )

  const tryParseQuizFromText = (text: string): Quiz | null => {
    if (!text) return null

    // Remove ```json ... ``` fences if present
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    const raw = (fenced ? fenced[1] : text).trim()

    // Quick bailout if it doesn't look like JSON
    if (!raw.startsWith('{') && !raw.startsWith('[')) return null

    try {
      const obj = JSON.parse(raw)

      // Accept either {question, choices, answerIndex} or {type:"quiz", question, choices, answerIndex}
      const q = (obj && typeof obj === 'object' ? (obj as any) : null) as any
      if (!q) return null

      const question = typeof q.question === 'string' ? q.question : null
      const choices = Array.isArray(q.choices) ? q.choices : null
      const answerIndex =
        typeof q.answerIndex === 'number'
          ? q.answerIndex
          : typeof q.answer_index === 'number'
            ? q.answer_index
            : null
      const explanation =
        typeof q.explanation === 'string'
          ? q.explanation
          : typeof q.explain === 'string'
            ? q.explain
            : null

      if (!question || !choices || choices.length < 2 || answerIndex === null)
        return null

      const normalizedChoices = choices
        .map((c: any) => String(c))
        .filter((c: string) => c.length > 0)

      if (normalizedChoices.length < 2) return null

      const idx = Math.max(
        0,
        Math.min(normalizedChoices.length - 1, answerIndex)
      )

      return {
        question,
        choices: normalizedChoices,
        answerIndex: idx,
        explanation: explanation ?? undefined,
      }
    } catch {
      return null
    }
  }

  const applyQuiz = (q: Quiz) => {
    // Normalize to 4 choices if possible (keep first 4)
    const choices = q.choices.slice(0, 4)
    const answerIndex = Math.min(Math.max(q.answerIndex, 0), choices.length - 1)

    setQuiz({
      question: q.question,
      choices,
      answerIndex,
      explanation: q.explanation,
    })
    setQuizResult('')
    setQuizAnsweredIndex(null)

    if (isEmotionOn) {
      resetEmotion()
    }
  }

  useEffect(() => {
    const storedClientId = settingsStore.getState().clientId
    if (storedClientId) {
      setClientId(storedClientId)
    }
  }, [])

  useEffect(() => {
    setBaseUrl(window.location.origin)
  }, [])

  const handleSubmit = async (
    e?: React.FormEvent,
    type: SendType = 'direct_send'
  ) => {
    e?.preventDefault()

    const messages = (() => {
      switch (type) {
        case 'direct_send':
          return directMessages
        case 'ai_generate':
          return aiMessages
        case 'user_input':
          return userInputMessages
        case 'dify':
          return difyMessages
        default:
          return directMessages
      }
    })()

    if (!messages.some((msg) => msg.trim()) || !clientId.trim()) return

    // Keep the last emotion until the user sends the next input, then clear.
    if (isEmotionOn) {
      resetEmotion()
    }

    const url = new URL(withBasePath('/api/messages/'), window.location.origin)
    url.searchParams.append('clientId', clientId.trim())
    url.searchParams.append('type', type)
    url.searchParams.append('service', type === 'dify' ? 'dify' : '')

    const body: RequestBody = {
      messages: messages.filter((msg) => msg.trim()),
      useCurrentSystemPrompt: useCurrentSystemPrompt,
    }

    if (type === 'dify' && difyConversationId) {
      body.conversationId = difyConversationId
    } else if (type !== 'dify') {
      body.systemPrompt = systemPrompt
    }

    try {
      console.log('[SendMessage] Sending:', { type, body })

      const isDify = type === 'dify'
      const difyUrl = new URL(
        withBasePath('/api/difyChat/'),
        window.location.origin
      )

      const lastMessage = body.messages.length
        ? body.messages[body.messages.length - 1]
        : ''

      const hasActiveQuiz = !!quiz && quizAnsweredIndex === null
      // ===== A方式: クイズ採点はローカルで確定させる =====
      // クイズ中で、ユーザー入力が選択肢にマッチした場合は Dify に送らずにここで採点する。
      // これにより「ボットの返答タイミングで怒りマークが出る」などのズレを防ぐ。
      //      if (
      //        USE_LOCAL_GRADING &&
      //        isDify &&
      //        hasActiveQuiz &&
      //        quiz &&
      //        typeof guessedUserIndex === 'number'
      //      ) {
      //        // 画面上のチャットログにもユーザー入力を反映したいので、まずローカル採点
      //        answerQuiz(guessedUserIndex)
      //
      //        // Optional: admin/debug 画面に JSON を出しておく
      //        setDifyResponse(
      //          JSON.stringify(
      //            {
      //              type: 'grade',
      //              correct: guessedUserIndex === quiz.answerIndex,
      //              correctIndex: quiz.answerIndex,
      //              userIndex: guessedUserIndex,
      //              emotion: guessedUserIndex === quiz.answerIndex ? 'happy' : 'rage',
      //            },
      //            null,
      //            2
      //          )
      //        )
      //
      //        // 入力欄をクリア
      //        setDifyMessages(Array(1).fill(''))
      //        setDifyFieldCount(1)
      //
      //        return
      //      }

      // If a quiz is active but the user's input doesn't match any choice,
      // handle it locally as an invalid answer attempt.
      // This prevents Dify from mistakenly generating a new quiz.
      //      if (
      //        USE_LOCAL_GRADING &&
      //        isDify &&
      //        hasActiveQuiz &&
      //        quiz &&
      //        guessedUserIndex === null
      //      ) {
      //        const invalidMsg =
      //          '選択肢から選んでください（A/B/C/D、1〜4、または選択肢の本文）'
      //
      //        setQuizResult('❌ 不正解…')
      //
      //        // Do NOT lock the quiz; allow the user to try again.
      //        setQuizAnsweredIndex(null)
      //
      //        // Optional: show a small response in this admin screen for debugging.
      //        setDifyResponse(
      //          JSON.stringify(
      //            {
      //              type: 'grade',
      //              correct: false,
      //              correctIndex: quiz.answerIndex,
      //              userIndex: null,
      //              emotion: 'sweat',
      //              message: invalidMsg,
      //              explanation: invalidMsg,
      //            },
      //            null,
      //            2
      //          )
      //        )
      //
      //        // Apply "sweat" briefly (only in emotion_on)
      //        if (isEmotionOn) {
      //          setSweat()
      //          setTimeout(() => resetEmotion(), 900)
      //        }
      //
      //        // Keep the timer running (do not reset quizStartedAt here)
      //
      //        // Clear the input field like normal submit
      //        setDifyMessages(Array(1).fill(''))
      //        setDifyFieldCount(1)
      //
      //        return
      //      }

      const inputs =
        hasActiveQuiz && quiz
          ? {
              mode: 'grade',
              lastQuiz: {
                question: quiz.question,
                choices: quiz.choices,
                answerIndex: quiz.answerIndex,
              },
              userAnswer: lastMessage,
            }
          : { mode: 'quiz' }

      const stableUser =
        participantId.trim() || clientId.trim() || 'aituber-kit'

      const res = await fetch(isDify ? difyUrl : url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isDify
            ? {
                query: lastMessage,
                conversationId: difyConversationId,
                stream: false,
                inputs,
                user: stableUser,
              }
            : body
        ),
      })

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`)
      }

      const contentType = res.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error("Oops! We haven't received a JSON response")
      }

      const data = await res.json()

      console.log('[SendMessage] Response received:', { type, data })

      switch (type) {
        case 'direct_send':
          setDirectResponse(JSON.stringify(data, null, 2))
          setDirectMessages(Array(1).fill(''))
          setDirectFieldCount(1)
          break

        case 'ai_generate':
          setAiResponse(JSON.stringify(data, null, 2))
          setAiMessages(Array(1).fill(''))
          setAiFieldCount(1)
          break

        case 'user_input':
          setUserInputResponse(JSON.stringify(data, null, 2))
          setUserInputMessages(Array(1).fill(''))
          setUserInputFieldCount(1)
          break

        case 'dify':
          let responseText = ''

          if (typeof data === 'object' && data !== null) {
            responseText =
              (data as any).text ||
              (data as any).answer ||
              (data as any).message ||
              (data as any).result ||
              ''
          }

          console.log('[SendMessage] Dify response:', responseText)

          setDifyResponse(responseText)

          // If the Dify response includes quiz JSON, populate the quiz UI automatically.
          const serverParsed = (data as any)?.parsed
          const serverEmotion = (data as any)?.emotion as
            | 'happy'
            | 'sweat'
            | 'rage'
            | 'neutral'
            | undefined

          // --- grade のとき（採点結果）---
          if (
            serverParsed &&
            typeof serverParsed === 'object' &&
            serverParsed.type === 'grade'
          ) {
            const g = serverParsed as any

            if (g.userIndex === null)
              setQuizResult('❌ 判定できません（A/B/C/D か 1〜4 で答えてね）')
            else setQuizResult(g.correct ? '✅ 正解！' : '❌ 不正解…')

            if (typeof g.userIndex === 'number')
              setQuizAnsweredIndex(g.userIndex)

            if (isEmotionOn) {
              if (serverEmotion === 'happy') {
                setHappyOn()
              } else if (serverEmotion === 'sweat') {
                setSweat()
              } else if (serverEmotion === 'rage') {
                setRage()
              } else {
                resetEmotion()
              }
            }
          } else {
            // --- quiz のとき（出題）---
            // serverParsed が quiz JSON を持ってるならそれを使う（表示テキストからの再パースを避ける）
            let q: any = null
            if (serverParsed && typeof serverParsed === 'object') {
              const question =
                typeof serverParsed.question === 'string'
                  ? serverParsed.question
                  : typeof serverParsed.public?.question === 'string'
                    ? serverParsed.public.question
                    : null

              const choices = Array.isArray(serverParsed.choices)
                ? serverParsed.choices
                : Array.isArray(serverParsed.public?.choices)
                  ? serverParsed.public.choices
                  : null

              const answerIndex =
                typeof serverParsed.answerIndex === 'number'
                  ? serverParsed.answerIndex
                  : typeof serverParsed.answer_index === 'number'
                    ? serverParsed.answer_index
                    : null

              if (question && choices && typeof answerIndex === 'number') {
                q = { question, choices, answerIndex }
              }
            }

            // どうしても serverParsed が無い時だけ旧方式
            if (!q) {
              const parsedQuiz = tryParseQuizFromText(responseText)
              if (parsedQuiz) q = parsedQuiz
            }

            if (q) applyQuiz(q)
          }

          const nextConversationId =
            (data as any).conversation_id || (data as any).conversationId

          if (nextConversationId && nextConversationId !== difyConversationId) {
            console.log(
              '[SendMessage] Updating conversation ID:',
              nextConversationId
            )
            setDifyConversationId(String(nextConversationId))
          }

          setDifyMessages(Array(1).fill(''))
          setDifyFieldCount(1)
          break
      }
    } catch (error) {
      console.error('[SendMessage] Error:', error)
      const errorMessage = `エラーが発生しました: ${
        error instanceof Error ? error.message : String(error)
      }`

      console.error('[SendMessage] Error message:', errorMessage)

      switch (type) {
        case 'direct_send':
          setDirectResponse(errorMessage)
          break
        case 'ai_generate':
          setAiResponse(errorMessage)
          break
        case 'user_input':
          setUserInputResponse(errorMessage)
          break
        case 'dify':
          setDifyResponse(errorMessage)
          break
      }
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      const formType = (e.target as HTMLTextAreaElement).getAttribute(
        'data-form-type'
      ) as SendType
      handleSubmit(undefined, formType)
    }
  }

  const addNewField = (type: SendType) => {
    if (type === 'direct_send') {
      setDirectFieldCount((prev) => prev + 1)
    } else if (type === 'ai_generate') {
      setAiFieldCount((prev) => prev + 1)
    } else if (type === 'user_input') {
      setUserInputFieldCount((prev) => prev + 1)
    } else if (type === 'dify') {
      setDifyFieldCount((prev) => prev + 1)
    }
  }

  const removeField = (index: number, type: SendType) => {
    if (type === 'direct_send') {
      if (directFieldCount <= 1) return
      setDirectFieldCount((prev) => prev - 1)
      setDirectMessages((prev) => prev.filter((_, i) => i !== index))
    } else if (type === 'ai_generate') {
      if (aiFieldCount <= 1) return
      setAiFieldCount((prev) => prev - 1)
      setAiMessages((prev) => prev.filter((_, i) => i !== index))
    } else if (type === 'user_input') {
      if (userInputFieldCount <= 1) return
      setUserInputFieldCount((prev) => prev - 1)
      setUserInputMessages((prev) => prev.filter((_, i) => i !== index))
    } else if (type === 'dify') {
      if (difyFieldCount <= 1) return
      setDifyFieldCount((prev) => prev - 1)
      setDifyMessages((prev) => prev.filter((_, i) => i !== index))
    }
  }

  const copyToClipboard = async (text: string, event?: React.MouseEvent) => {
    try {
      await navigator.clipboard.writeText(text)

      if (event) {
        const rect = (event.target as HTMLElement).getBoundingClientRect()
        setPopupPosition({ x: rect.right, y: rect.top })
      } else {
        // fallback position (top-right-ish)
        setPopupPosition({ x: window.innerWidth - 140, y: 24 })
      }

      setCopySuccess(`Copied!`)
      setTimeout(() => {
        setCopySuccess('')
        setPopupPosition(null)
      }, 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  const getActiveResponse = () => {
    switch (activeTab) {
      case 'direct_send':
        return directResponse
      case 'ai_generate':
        return aiResponse
      case 'user_input':
        return userInputResponse
      case 'dify':
        return difyResponse
      default:
        return ''
    }
  }

  const getTabCurlSample = () => {
    switch (activeTab) {
      case 'direct_send':
        return `curl -X POST -H "Content-Type: application/json" -d '{"messages": ["こんにちは、今日もいい天気ですね。", "今日の予定を教えてください。"]}' '${baseUrl}${withBasePath('/api/messages/')}?clientId=${clientId}&type=direct_send'`
      case 'ai_generate':
        return `curl -X POST -H "Content-Type: application/json" -d '{"systemPrompt": "You are a helpful assistant.", "useCurrentSystemPrompt": false, "messages": ["今日の予定を教えてください。"]}' '${baseUrl}${withBasePath('/api/messages/')}?clientId=${clientId}&type=ai_generate'`
      case 'user_input':
        return `curl -X POST -H "Content-Type: application/json" -d '{"messages": ["こんにちは、今日もいい天気ですね。", "今日の予定を教えてください。"]}' '${baseUrl}${withBasePath('/api/messages/')}?clientId=${clientId}&type=user_input'`
      case 'dify':
        return `curl -X POST -H "Content-Type: application/json" -d '{"messages": ["こんにちは"]}' '${baseUrl}${withBasePath('/api/messages/')}?clientId=${clientId}&type=dify&service=dify'`
      default:
        return ''
    }
  }

  const getTabDescription = () => {
    switch (activeTab) {
      case 'direct_send':
        return t('SendMessage.directSendDescription')
      case 'ai_generate':
        return t('SendMessage.aiGenerateDescription')
      case 'user_input':
        return t('SendMessage.userInputDescription')
      case 'dify':
        return 'Difyチャットボットと連携'
      default:
        return ''
    }
  }

  const getTabTitle = () => {
    switch (activeTab) {
      case 'direct_send':
        return t('SendMessage.directSendTitle')
      case 'ai_generate':
        return t('SendMessage.aiGenerateTitle')
      case 'user_input':
        return t('SendMessage.userInputTitle')
      case 'dify':
        return 'Dify'
      default:
        return ''
    }
  }

  const isSendButtonDisabled = () => {
    const messages = (() => {
      switch (activeTab) {
        case 'direct_send':
          return directMessages
        case 'ai_generate':
          return aiMessages
        case 'user_input':
          return userInputMessages
        case 'dify':
          return difyMessages
        default:
          return []
      }
    })()

    return !messages.some((msg) => msg.trim()) || !clientId.trim()
  }

  const handleTabChange = (tab: SendType) => {
    setActiveTab(tab)
  }

  const renderMessageFields = () => {
    let messages: string[] = []
    let fieldCount = 0
    let setMessages: React.Dispatch<React.SetStateAction<string[]>> = () => {}
    switch (activeTab) {
      case 'direct_send':
        messages = directMessages
        fieldCount = directFieldCount
        setMessages = setDirectMessages
        break
      case 'ai_generate':
        messages = aiMessages
        fieldCount = aiFieldCount
        setMessages = setAiMessages
        break
      case 'user_input':
        messages = userInputMessages
        fieldCount = userInputFieldCount
        setMessages = setUserInputMessages
        break
      case 'dify':
        messages = difyMessages
        fieldCount = difyFieldCount
        setMessages = setDifyMessages
        break
    }

    return (
      <>
        {[...Array(fieldCount)].map((_, index) => (
          <div key={index} className="flex gap-2 mb-2">
            <textarea
              data-form-type={activeTab}
              value={messages[index] || ''}
              onChange={(e) => {
                const newMessages = [...messages]
                newMessages[index] = e.target.value
                setMessages(newMessages)
              }}
              onKeyDown={(e) => handleKeyDown(e)}
              className="border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:bg-white rounded-xl w-full px-4 font-medium transition-all duration-200"
              rows={2}
              style={{
                lineHeight: '1.5',
                padding: '12px 16px',
                resize: 'vertical',
              }}
              placeholder={'Enter your message...'}
            />
            {fieldCount > 1 && (
              <button
                type="button"
                onClick={() => removeField(index, activeTab)}
                aria-label="Remove"
                className="min-w-[44px] w-[44px] h-[44px] shrink-0 ml-2 rounded-full bg-red-100 hover:bg-red-200 text-red-700 border border-red-300 shadow-sm transition-colors duration-200 flex items-center justify-center text-xl leading-none"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </>
    )
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">{t('SendMessage.title')}</h2>

      {/* ===== Experiment Panel (Manual A/B) ===== */}
      <div className="space-y-3 p-3 rounded-xl border border-slate-200 bg-white">
        <h3 className="text-lg font-semibold">実験パネル（手動 A/B）</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Participant ID
            </label>
            <input
              type="text"
              value={participantId}
              onChange={(e) => setParticipantId(e.target.value)}
              placeholder="例: P001"
              className="bg-slate-50 hover:bg-slate-100 focus:bg-white focus:ring-2 focus:ring-indigo-300 focus:outline-none rounded-xl px-4 py-2 font-medium transition-all duration-200"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Condition
            </label>
            <select
              value={condition}
              onChange={(e) =>
                setCondition(e.target.value as ExperimentCondition)
              }
              className="bg-slate-50 hover:bg-slate-100 focus:bg-white focus:ring-2 focus:ring-indigo-300 focus:outline-none rounded-xl px-4 py-2 font-medium transition-all duration-200"
            >
              <option value="emotion_on">A: 表情あり（emotion_on）</option>
              <option value="emotion_off">B: 表情なし（emotion_off）</option>
            </select>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowLogs((v) => !v)}
              className="px-4 py-2 bg-slate-100 text-slate-800 rounded-lg font-medium hover:bg-slate-200 transition-colors duration-200 border border-slate-200"
            >
              ログ表示（JSON）{showLogs ? '▲' : '▼'}
            </button>

            <button
              type="button"
              onClick={() => copyToClipboard(logsCsv)}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors duration-200"
            >
              CSVコピー
            </button>

            <button
              type="button"
              onClick={() => {
                setLogs([])
              }}
              className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors duration-200"
            >
              ログ初期化
            </button>
          </div>
        </div>

        {showLogs && (
          <pre className="bg-gray-50 p-3 rounded-lg text-xs overflow-x-auto max-h-64 border border-slate-200">
            {JSON.stringify(logs, null, 2)}
          </pre>
        )}

        <p className="text-xs text-slate-600">
          条件B（emotion_off）のときは、ボタンを押しても Live2D
          にはイベントを送らず、ログだけ記録します。
        </p>
      </div>

      {/* Live2D 表情（マーク）制御 */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Live2D 表情</h3>
        <p className="text-sm text-gray-600">
          怒り・汗のときは口（PARAM_MOUTH_OPEN_Y）を 0
          にして閉じます。現在の条件：
          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold">
            {condition === 'emotion_on' ? 'A: 表情あり' : 'B: 表情なし'}
          </span>
        </p>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={setRage}
            className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors duration-200"
          >
            怒り（PARAM_RAGE=1 / 口閉）
          </button>
          <button
            type="button"
            onClick={setSweat}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors duration-200"
          >
            汗（PARAM_SWEAT=1 / 口閉）
          </button>
          <button
            type="button"
            onClick={resetEmotion}
            className="px-4 py-2 bg-slate-600 text-white rounded-lg font-medium hover:bg-slate-700 transition-colors duration-200"
          >
            リセット
          </button>
        </div>
      </div>

      {/* Client ID セクション */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Client ID
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={clientId}
            onClick={(e) => copyToClipboard(clientId, e)}
            className="px-3 py-1.5 text-sm bg-indigo-50 hover:bg-indigo-100 rounded-lg text-indigo-700 transition-colors duration-200"
            readOnly
          />
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="bg-slate-50 hover:bg-slate-100 focus:bg-white focus:ring-2 focus:ring-indigo-300 focus:outline-none rounded-xl w-full px-4 py-3 font-medium transition-all duration-200"
            disabled={!!settingsStore.getState().clientId}
          />
        </div>
      </div>

      {/* タブナビゲーション */}
      <div className="flex gap-2 border-b border-slate-200">
        <button
          onClick={() => handleTabChange('direct_send')}
          className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
            activeTab === 'direct_send'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          {t('SendMessage.directSendTitle')}
        </button>

        <button
          onClick={() => handleTabChange('ai_generate')}
          className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
            activeTab === 'ai_generate'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          {t('SendMessage.aiGenerateTitle')}
        </button>

        <button
          onClick={() => handleTabChange('user_input')}
          className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
            activeTab === 'user_input'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          {t('SendMessage.userInputTitle')}
        </button>

        <button
          onClick={() => handleTabChange('dify')}
          className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
            activeTab === 'dify'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          Dify
        </button>
      </div>

      {/* タブコンテンツ */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">{getTabTitle()}</h3>
        <p className="text-sm text-gray-600">{getTabDescription()}</p>

        {/* CURL サンプル */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="block text-sm font-medium text-gray-700">
              Curl Sample
            </label>
            <button
              onClick={(e) => copyToClipboard(getTabCurlSample(), e)}
              className="px-2 py-1 text-xs bg-indigo-50 hover:bg-indigo-100 rounded-lg text-indigo-700 transition-colors duration-200"
            >
              Copy
            </button>
          </div>
          <pre className="bg-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
            {getTabCurlSample()}
          </pre>
        </div>

        {/* System Prompt (AI Generate タブのみ) */}
        {activeTab === 'ai_generate' && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              System Prompt
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className={`${
                useCurrentSystemPrompt
                  ? 'bg-slate-100 text-gray-500 border-slate-200 cursor-not-allowed'
                  : 'bg-white border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50'
              } border rounded-xl w-full px-4 py-3 font-medium transition-all duration-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:bg-white`}
              rows={2}
              style={{
                lineHeight: '1.5',
                resize: 'vertical',
              }}
              disabled={useCurrentSystemPrompt}
              placeholder="Enter system prompt here..."
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useCurrentSystemPrompt}
                onChange={() =>
                  setUseCurrentSystemPrompt(!useCurrentSystemPrompt)
                }
                className="sr-only peer"
              />
              <span className="text-sm text-gray-700">
                {t('SendMessage.useCurrentSystemPrompt')}
              </span>
            </label>
          </div>
        )}

        {/* メッセージフォーム */}
        <form onSubmit={(e) => handleSubmit(e, activeTab)}>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Messages
            </label>
            {renderMessageFields()}
            <button
              type="button"
              onClick={() => addNewField(activeTab)}
              aria-label="Add"
              className="rounded-full bg-indigo-100 hover:bg-indigo-200 text-indigo-700 border border-indigo-300 shadow-sm transition-colors duration-200 min-w-[44px] w-[44px] h-[44px] flex items-center justify-center text-xl leading-none"
            >
              +
            </button>
          </div>

          {/* 送信ボタン */}
          <button
            type="submit"
            disabled={isSendButtonDisabled()}
            className="mt-4 px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:bg-gray-400 transition-colors duration-200"
          >
            Send
          </button>
        </form>
      </div>

      {/* レスポンス表示 */}
      {getActiveResponse() && (
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <h4 className="text-sm font-medium text-gray-700">Response</h4>
            <button
              onClick={(e) => copyToClipboard(getActiveResponse(), e)}
              className="px-2 py-1 text-xs bg-indigo-50 hover:bg-indigo-100 rounded-lg text-indigo-700 transition-colors duration-200"
            >
              Copy
            </button>
          </div>
          <pre className="bg-gray-100 p-4 rounded-lg text-xs overflow-x-auto max-h-96">
            {getActiveResponse()}
          </pre>
        </div>
      )}
      <div className="mt-4 space-y-2">
        <h4 className="text-sm font-semibold">クイズ（簡易 4択）</h4>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              // Put a quiz-generation prompt into the Dify tab input and send it.
              const prompt =
                '4択クイズを1問作ってください。必ずJSONだけで返してください。形式は {"question": "...", "choices": ["A","B","C","D"], "answerIndex": 0, "explanation": "..." }。choicesは必ず4つ。'
              setActiveTab('dify')
              setDifyMessages([prompt])
              setDifyFieldCount(1)
              // Fire request on next tick so state is applied
              setTimeout(() => {
                handleSubmit(undefined, 'dify')
              }, 0)
            }}
            className="px-3 py-2 bg-fuchsia-600 text-white rounded-lg font-medium hover:bg-fuchsia-700 transition-colors duration-200"
          >
            Difyで問題作成
          </button>
          {quiz && (
            <button
              type="button"
              onClick={() => {
                setQuiz(null)
                setQuizResult('')
                setQuizAnsweredIndex(null)
                if (isEmotionOn) resetEmotion()
              }}
              className="px-3 py-2 bg-slate-100 text-slate-800 rounded-lg font-medium hover:bg-slate-200 transition-colors duration-200 border border-slate-200"
            >
              問題を終了
            </button>
          )}
        </div>

        {quiz && (
          <div className="space-y-3">
            {/* Assistant bubble: question + choices */}
            <div className="flex justify-start">
              <div className="max-w-[90%] rounded-2xl px-4 py-3 bg-slate-100 border border-slate-200">
                <div className="text-xs text-slate-600 mb-1">AI</div>
                <div className="font-medium">{quiz.question}</div>
                <div className="mt-2 flex gap-2 flex-wrap">
                  {quiz.choices.slice(0, 4).map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      disabled={quizAnsweredIndex !== null}
                      onClick={() => {
                        setActiveTab('dify')
                        setDifyMessages([c])
                        setDifyFieldCount(1)
                        setTimeout(() => {
                          handleSubmit(undefined, 'dify')
                        }, 0)
                      }}
                      className={`px-3 py-2 rounded-lg border font-medium transition-colors duration-200 ${
                        quizAnsweredIndex !== null
                          ? 'bg-slate-200 border-slate-200 text-slate-500 cursor-not-allowed'
                          : 'bg-white hover:bg-slate-50 border-slate-200'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* User bubble: selected answer */}
            {quizAnsweredIndex !== null && (
              <div className="flex justify-end">
                <div className="max-w-[90%] rounded-2xl px-4 py-3 bg-indigo-600 text-white">
                  <div className="text-xs opacity-80 mb-1">You</div>
                  <div className="font-medium">
                    {quiz.choices[quizAnsweredIndex]}
                  </div>
                </div>
              </div>
            )}

            {/* Assistant bubble: result + explanation */}
            {quizResult && (
              <div className="flex justify-start">
                <div className="max-w-[90%] rounded-2xl px-4 py-3 bg-white border border-slate-200">
                  <div className="text-xs text-slate-600 mb-1">AI</div>
                  <div className="font-medium">{quizResult}</div>
                  {typeof quiz.explanation === 'string' &&
                    quiz.explanation.trim().length > 0 && (
                      <div className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">
                        {quiz.explanation}
                      </div>
                    )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* コピー成功ポップアップ */}
      {copySuccess && popupPosition && (
        <div
          style={{
            position: 'fixed',
            left: `${popupPosition.x}px`,
            top: `${popupPosition.y}px`,
            zIndex: 1000,
          }}
          className="bg-green-500 text-white px-2 py-1 rounded text-xs"
        >
          {copySuccess}
        </div>
      )}
    </div>
  )
}

export default SendMessage
