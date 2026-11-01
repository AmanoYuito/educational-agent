import { getQuestionKnowledge } from '@/lib/server/questionKnowledge'
import { getLessonById } from '@/config/lessons'
import { retrievalSources } from '@/lib/server/quizSources'
import type { NextApiRequest, NextApiResponse } from 'next'
import { requireSession } from '@/lib/server/auth'
import {
  getIssuedQuiz,
  issueQuiz,
  parseServerQuiz,
  QuizError,
} from '@/lib/server/quizGrading'
import { createQuestionPoolRequestToken } from '@/lib/server/questionPoolRequest'
import {
  evaluationSettings,
  saveQuizEvaluation,
  type QuizEvaluationCapture,
} from '@/lib/server/quizEvaluation'

const DEFAULT_DIFY_URL = 'https://api.dify.ai/v1'
const QUIZ_CONVERSATION_VARIABLE_NAMES = [
  'latest_question',
  'question_type',
  'latest_choices',
  'latest_answer',
  'latest_explanation',
  'latest_user_answer',
  'latest_is_correct',
] as const

type QuizPublic = { question: string; choices: string[] }

type GradeResult = {
  type: 'grade'
  correct: boolean
  userIndex: number | null
  correctIndex: number
  reply?: string
  message?: string
  explanation?: string
}

type QuizResult = {
  type: 'quiz'
  public?: QuizPublic
  question?: string
  choices?: string[]
}

const firstNonEmpty = (...values: Array<unknown>) => {
  for (const value of values) {
    const trimmed = String(value || '').trim()
    if (trimmed) return trimmed
  }
  return ''
}

function tryParseJsonObject(text: string): any | null {
  if (!text) return null
  const s = String(text).trim()

  // Fast path: direct JSON
  try {
    const obj = JSON.parse(s)
    if (obj && typeof obj === 'object') return obj
  } catch {}

  // Fallback: extract the first top-level JSON object substring
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const candidate = s.slice(start, end + 1)
    try {
      const obj = JSON.parse(candidate)
      if (obj && typeof obj === 'object') return obj
    } catch {}
  }

  return null
}

function sanitizeForClient(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj

  // Remove obvious secret fields
  const cloned = Array.isArray(obj) ? [...obj] : { ...obj }
  if (!Array.isArray(cloned)) {
    if ('secret' in cloned) delete (cloned as any).secret
    if ('apiKey' in cloned) delete (cloned as any).apiKey
    if ('DIFY_KEY' in cloned) delete (cloned as any).DIFY_KEY
    if ('DIFY_API_KEY' in cloned) delete (cloned as any).DIFY_API_KEY
  }
  return cloned
}

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function cleanChatMessagesUrl(urlStr: string): string {
  const trimmedUrl = String(urlStr || '')
    .trim()
    .replace(/\/$/, '')
  if (!trimmedUrl) return ''
  return trimmedUrl.endsWith('/chat-messages')
    ? trimmedUrl
    : `${trimmedUrl}/chat-messages`
}

function buildDifyUrlCandidates(clientUrl?: string): string[] {
  const candidates = [process.env.DIFY_URL, clientUrl, DEFAULT_DIFY_URL]
    .map((value) => cleanChatMessagesUrl(String(value || '')))
    .filter(Boolean)

  return Array.from(new Set(candidates))
}

function questionPoolCallbackUrl(req: NextApiRequest): string {
  const configured = String(
    process.env.DIFY_QUESTION_POOL_CALLBACK_URL || ''
  ).trim()
  if (configured) return configured

  const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
  const requestOrigin = String(req.headers.origin || '').trim()
  let originProtocol = ''
  let originHost = ''
  try {
    if (requestOrigin) {
      const parsedOrigin = new URL(requestOrigin)
      originProtocol = parsedOrigin.protocol.replace(':', '')
      originHost = parsedOrigin.host
    }
  } catch {}
  const protocol = forwardedProtocol || originProtocol || 'http'
  const forwardedHost = String(req.headers['x-forwarded-host'] || '')
    .split(',')[0]
    .trim()
  const host =
    forwardedHost || originHost || String(req.headers.host || '').trim()
  if (!host) throw new QuizError(500, '公開URLを確認できませんでした。')
  const basePath = String(process.env.BASE_PATH || '').replace(/\/$/, '')
  return `${protocol}://${host}${basePath}/api/question-pool/dify-next/`
}

async function getQuizConversationInputs(params: {
  difyBaseUrl: string
  difyKey: string
  conversationId?: string
  user: string
}): Promise<Record<string, string>> {
  if (!params.conversationId) return {}

  const listUrl = new URL(
    `${params.difyBaseUrl}/conversations/${params.conversationId}/variables`
  )
  listUrl.searchParams.set('user', params.user)

  const response = await fetch(listUrl.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.difyKey}`,
    },
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    console.warn(
      '[difyChat] Failed to load conversation variables:',
      response.status
    )
    return {}
  }

  const data = await response.json()
  const items = Array.isArray(data?.data) ? data.data : []
  const result: Record<string, string> = {}

  for (const item of items) {
    if (
      item &&
      typeof item.name === 'string' &&
      QUIZ_CONVERSATION_VARIABLE_NAMES.includes(item.name)
    ) {
      if (Array.isArray(item.value)) {
        result[item.name] = item.value.map((v: unknown) => String(v)).join('\n')
      } else if (item.value === null || item.value === undefined) {
        result[item.name] = ''
      } else if (typeof item.value === 'object') {
        result[item.name] = JSON.stringify(item.value)
      } else {
        result[item.name] = String(item.value)
      }
    }
  }

  return result
}

function deriveEmotionFromGrade(
  grade: GradeResult
):
  | 'happy'
  | 'excited'
  | 'bored'
  | 'relaxed'
  | 'sad'
  | 'sweat'
  | 'rage'
  | 'neutral' {
  // Desired rule:
  // - correct -> happy
  // - incorrect with valid choice -> sweat
  // - invalid input (userIndex null) -> rage
  if (grade.userIndex === null) return 'rage'
  if (grade.correct) return 'happy'
  return 'sweat'
}

function splitQuizIntroAndQuestion(rawQuestion: string): {
  intro: string
  question: string
} {
  const normalized = String(rawQuestion || '')
    .replace(/\r\n/g, '\n')
    .trim()
  if (!normalized) {
    return { intro: '', question: '' }
  }

  const byBlankLine = normalized
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (byBlankLine.length >= 2) {
    return {
      intro: byBlankLine.slice(0, -1).join('\n\n'),
      question: byBlankLine[byBlankLine.length - 1],
    }
  }

  const guidePattern =
    /(回答してください|答えてください|回答してね|答えてね|回答して下さい|答えて下さい)([。.!！]?)/u
  const guideMatch = normalized.match(guidePattern)
  if (guideMatch && typeof guideMatch.index === 'number') {
    const splitAt = guideMatch.index + guideMatch[0].length
    const intro = normalized.slice(0, splitAt).trim()
    const question = normalized.slice(splitAt).trim()
    if (intro && question) {
      return { intro, question }
    }
  }

  return { intro: '', question: normalized }
}

function extractDisplayText(parsed: any, fallbackText: string): string {
  if (parsed && typeof parsed === 'object' && parsed.type === 'quiz') {
    const questionRaw = String(
      parsed.public?.question ?? parsed.question ?? ''
    ).trim()
    const choices = Array.isArray(parsed.public?.choices ?? parsed.choices)
      ? (parsed.public?.choices ?? parsed.choices).filter(Boolean).slice(0, 4)
      : []
    const { intro, question } = splitQuizIntroAndQuestion(questionRaw)
    const quizBody = [
      '【問題】',
      question || questionRaw,
      '【選択肢】',
      ...choices.map(
        (c: string, i: number) => `${String.fromCharCode(65 + i)}. ${String(c)}`
      ),
    ]
      .filter(Boolean)
      .join('\n')
    return normalizeDisplayText(intro ? `${intro}\n\n${quizBody}` : quizBody)
  }

  if (
    parsed &&
    typeof parsed === 'object' &&
    typeof parsed.reply === 'string' &&
    parsed.reply.trim()
  ) {
    return normalizeDisplayText(parsed.reply)
  }

  const raw = String(fallbackText || '')
  try {
    const parsedRaw = JSON.parse(raw)
    if (
      parsedRaw &&
      typeof parsedRaw === 'object' &&
      typeof parsedRaw.reply === 'string' &&
      parsedRaw.reply.trim()
    ) {
      return normalizeDisplayText(parsedRaw.reply)
    }
    if (typeof parsedRaw === 'string') {
      const nested = JSON.parse(parsedRaw)
      if (
        nested &&
        typeof nested === 'object' &&
        typeof nested.reply === 'string' &&
        nested.reply.trim()
      ) {
        return normalizeDisplayText(nested.reply)
      }
    }
  } catch {}

  // Plain JSON-like text fallback: "reply":"..."
  const plainReply = raw.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)"/s)
  if (plainReply?.[1]) {
    try {
      return normalizeDisplayText(JSON.parse(`"${plainReply[1]}"`))
    } catch {
      return normalizeDisplayText(plainReply[1])
    }
  }

  // Escaped JSON-like text fallback: \"reply\":\"...\"
  const escapedReply = raw.match(/\\"reply\\"\s*:\s*\\"((?:\\\\.|[^"\\])*)\\"/s)
  if (escapedReply?.[1]) {
    try {
      const unescaped = escapedReply[1]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\')
      return normalizeDisplayText(unescaped)
    } catch {}
  }

  // Prefer the raw Dify output to keep display text centralized in Dify.
  return normalizeDisplayText(fallbackText)
}

function extractEmotionFromRawText(
  text: string
):
  | 'happy'
  | 'excited'
  | 'bored'
  | 'relaxed'
  | 'sad'
  | 'sweat'
  | 'rage'
  | 'neutral'
  | null {
  const raw = String(text || '')

  const pick = (
    value: any
  ):
    | 'happy'
    | 'excited'
    | 'bored'
    | 'relaxed'
    | 'sad'
    | 'sweat'
    | 'rage'
    | 'neutral'
    | null => {
    const e = String(value || '').toLowerCase()
    if (
      e === 'happy' ||
      e === 'excited' ||
      e === 'bored' ||
      e === 'relaxed' ||
      e === 'sad' ||
      e === 'sweat' ||
      e === 'rage' ||
      e === 'neutral'
    ) {
      return e
    }
    return null
  }

  const tryFromObject = (
    obj: any
  ):
    | 'happy'
    | 'excited'
    | 'bored'
    | 'relaxed'
    | 'sad'
    | 'sweat'
    | 'rage'
    | 'neutral'
    | null => {
    if (!obj || typeof obj !== 'object') return null

    const direct = pick((obj as any).emotion)
    if (direct) return direct

    const reply = (obj as any).reply
    if (typeof reply === 'string' && reply.trim()) {
      const nested = extractEmotionFromRawText(reply)
      if (nested) return nested
    }
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') {
      const nested = extractEmotionFromRawText(parsed)
      if (nested) return nested
    }
    const fromObj = tryFromObject(parsed)
    if (fromObj) return fromObj
  } catch {}

  // Plain JSON text
  const plain = raw.match(
    /"emotion"\s*:\s*"(happy|excited|bored|relaxed|sad|sweat|rage|neutral)"/i
  )
  if (plain) {
    const e = pick(plain[1])
    if (e) return e
  }

  // Escaped JSON text (e.g. \"emotion\":\"happy\")
  const escaped = raw.match(
    /\\"emotion\\"\s*:\s*\\"(happy|excited|bored|relaxed|sad|sweat|rage|neutral)\\"/i
  )
  if (escaped) {
    const e = pick(escaped[1])
    if (e) return e
  }

  return null
}

type TextBlock =
  | {
      type: 'grade'
      title: string
      status?: string
      correctAnswer?: string
      explanation?: string
      score?: string
      extra?: string[]
    }
  | {
      type: 'quiz'
      question: string
      choices: string[]
    }
  | {
      type: 'text'
      lines: string[]
    }

function normalizeDisplayText(rawText: string): string {
  const raw = String(rawText || '').replace(/\r\n/g, '\n')
  return raw
    .replace(/(解説[:：][^\n]*?)\s*(?=【問題】)/g, '$1\n\n')
    .replace(/(解説[:：][^\n]*?)\s*(\d+\s*\/\s*\d+\s*正解)/g, '$1\n\n$2')
    .replace(/(【\s*\d+\s*\/\s*\d+\s*問目\s*】)/g, '\n$1\n')
    .replace(/(【問題】)/g, '\n$1\n')
    .replace(/(【選択肢】)/g, '\n$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function buildStructuredHtmlFromText(rawText: string): string {
  const raw = normalizeDisplayText(rawText)
  if (!raw) return `<div class="dify-text"></div>`

  const lines = raw.split('\n').map((line) => line.trim())
  const blocks: TextBlock[] = []

  const isQuizHeader = (line: string) => line === '【問題】'
  const isChoicesHeader = (line: string) => line === '【選択肢】'
  const isGradeHeader = (line: string) =>
    /^【\s*\d+\s*\/\s*\d+\s*問目\s*】$/.test(line)

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isGradeHeader(line)) {
      const title = line
      i += 1
      const buffer: string[] = []
      while (i < lines.length) {
        const current = lines[i]
        if (isGradeHeader(current) || isQuizHeader(current)) break
        if (current) buffer.push(current)
        i += 1
      }

      let status: string | undefined
      let correctAnswer: string | undefined
      let explanation: string | undefined
      let score: string | undefined
      const extra: string[] = []

      buffer.forEach((entry) => {
        if (!status && (entry.includes('正解') || entry.includes('不正解'))) {
          status = entry
          return
        }
        if (entry.startsWith('正解：') || entry.startsWith('正解:')) {
          correctAnswer = entry.replace(/^正解[:：]\s*/, '')
          return
        }
        if (entry.startsWith('解説：') || entry.startsWith('解説:')) {
          explanation = entry.replace(/^解説[:：]\s*/, '')
          return
        }
        if (!score) {
          const scoreMatch = entry.match(/^\s*(\d+\s*\/\s*\d+\s*正解)\s*$/)
          if (scoreMatch) {
            score = scoreMatch[1].trim()
            return
          }
        }
        if (entry.includes('判定できません')) {
          status = entry
          return
        }
        extra.push(entry)
      })

      blocks.push({
        type: 'grade',
        title,
        status,
        correctAnswer,
        explanation,
        score,
        extra: extra.length ? extra : undefined,
      })
      continue
    }

    if (isQuizHeader(line)) {
      i += 1
      const questionLines: string[] = []
      while (i < lines.length && !isChoicesHeader(lines[i])) {
        if (lines[i]) questionLines.push(lines[i])
        i += 1
      }

      if (i < lines.length && isChoicesHeader(lines[i])) i += 1
      const choices: string[] = []
      while (i < lines.length) {
        const current = lines[i]
        if (isGradeHeader(current) || isQuizHeader(current)) break
        const match = current.match(/^([A-D])[.)]\s*(.+)$/i)
        if (match) choices.push(match[2].trim())
        i += 1
      }

      blocks.push({
        type: 'quiz',
        question: questionLines.join('\n'),
        choices,
      })
      continue
    }

    const textLines: string[] = []
    while (i < lines.length) {
      const current = lines[i]
      if (isGradeHeader(current) || isQuizHeader(current)) break
      if (current) textLines.push(current)
      i += 1
    }
    if (textLines.length) blocks.push({ type: 'text', lines: textLines })
  }

  const htmlBlocks = blocks.map((block, idx) => {
    const prev = idx > 0 ? blocks[idx - 1] : null
    const gap =
      prev && prev.type === 'grade' && block.type === 'quiz' ? '<br/><br/>' : ''
    if (block.type === 'quiz') {
      const safeQuestion = escapeHtml(block.question).replace(/\n/g, '<br/>')
      const safeChoices = block.choices
        .slice(0, 4)
        .map((c) => `<li>${escapeHtml(c)}</li>`)
      return [
        gap,
        `<div class="dify-quiz" style="${gap ? 'margin-top:0.5rem;' : ''}">`,
        `<p class="dify-quiz-question">${safeQuestion}</p>`,
        safeChoices.length
          ? `<ol class="dify-quiz-choices" type="A">${safeChoices.join('')}</ol>`
          : ``,
        `</div>`,
      ].join('')
    }

    if (block.type === 'grade') {
      let scoreLine = ''
      let explanationText = block.explanation ?? ''
      if (explanationText) {
        const scoreMatch = explanationText.match(
          /(.*?)(\d+\s*\/\s*\d+\s*正解)\s*$/
        )
        if (scoreMatch) {
          explanationText = scoreMatch[1].trim()
          scoreLine = scoreMatch[2].trim()
        }
      }
      if (!scoreLine && block.score) {
        scoreLine = block.score
      }

      const title = `<div class="dify-grade-title">${escapeHtml(
        block.title
      )}</div>`
      const status = block.status
        ? `<div class="dify-grade-status">${escapeHtml(block.status)}</div>`
        : ''
      const correctAnswer = block.correctAnswer
        ? `<div class="dify-grade-answer">正解：${escapeHtml(
            block.correctAnswer
          )}</div>`
        : ''
      const explanation = block.explanation
        ? `<div class="dify-grade-explanation">解説：${escapeHtml(
            explanationText || block.explanation
          )}</div>`
        : ''
      const score = scoreLine
        ? `<div class="dify-grade-score" style="margin-top:0.5rem;">${escapeHtml(
            scoreLine
          )}</div>`
        : ''
      const extra = block.extra?.length
        ? `<div class="dify-grade-extra">${escapeHtml(
            block.extra.join('\n')
          ).replace(/\n/g, '<br/>')}</div>`
        : ''

      return [
        `<div class="dify-grade">`,
        title,
        status,
        correctAnswer,
        explanation,
        score,
        extra,
        `</div>`,
      ].join('')
    }

    const safeText = escapeHtml(block.lines.join('\n')).replace(/\n/g, '<br/>')
    return `${gap}<div class="dify-free" style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:rgba(255,255,255,0.8);color:#1f2937;font-weight:600;">${safeText}</div>`
  })

  return htmlBlocks.join('<hr class="dify-sep"/>')
}

function extractDisplayHTML(parsed: any, fallbackText: string): string | null {
  if (parsed && typeof parsed === 'object') {
    // Quiz
    if (parsed.type === 'quiz') {
      const q = parsed as QuizResult
      const questionRaw = (q.public?.question ?? q.question ?? '').trim()
      const choices = (q.public?.choices ?? q.choices ?? []).filter(Boolean)

      if (questionRaw && Array.isArray(choices) && choices.length === 4) {
        const { intro, question } = splitQuizIntroAndQuestion(questionRaw)
        const safeQuestion = escapeHtml(question || questionRaw).replace(
          /\n/g,
          '<br/>'
        )
        const safeChoices = choices
          .slice(0, 4)
          .map((c) => `<li>${escapeHtml(String(c))}</li>`)

        const quizHtml = [
          `<div class="dify-quiz">`,
          `<p class="dify-quiz-question">${safeQuestion}</p>`,
          `<ol class="dify-quiz-choices" type="A">${safeChoices.join('')}</ol>`,
          `</div>`,
        ].join('')

        if (!intro) return quizHtml

        const introHtml = `<div class="dify-free" style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:rgba(255,255,255,0.8);color:#1f2937;font-weight:600;">${escapeHtml(
          intro
        ).replace(/\n/g, '<br/>')}</div>`
        return `${introHtml}<hr class="dify-sep"/>${quizHtml}`
      }
    }
  }

  // For Dify-only rendering, wrap plain text safely as HTML and structure quiz/grade blocks.
  return buildStructuredHtmlFromText(fallbackText)
}

async function proxyDify(
  req: NextApiRequest,
  userId: string,
  evaluation?: QuizEvaluationCapture
) {
  console.log('[difyChat] Request received:', {
    method: req.method,
    url: req.url,
  })

  if (req.method !== 'POST') {
    console.error('[difyChat] Invalid method:', req.method)
    return new Response(
      JSON.stringify({
        error: 'Method Not Allowed',
        errorCode: 'MethodNotAllowed',
      }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  try {
    const { query, apiKey, url, conversationId, stream, inputs, user } =
      req.body

    if (stream && inputs?.mode === 'generate_question') {
      throw new QuizError(400, '問題生成は非ストリーミングで実行してください。')
    }
    if (inputs?.mode === 'grade_written_answer') {
      throw new QuizError(400, '記述問題のサーバー採点は未対応です。')
    }

    console.log('[difyChat] Request body:', {
      query: query?.substring(0, 50) + '...',
      hasApiKey: !!apiKey,
      hasUrl: !!url,
      conversationId,
      stream,
      hasInputs: !!inputs,
      user: user ? String(user).substring(0, 40) : null,
    })

    const difyKey = firstNonEmpty(
      process.env.DIFY_KEY,
      process.env.DIFY_API_KEY,
      process.env.NEXT_PUBLIC_DIFY_API_KEY,
      apiKey
    )

    if (!difyKey) {
      console.error('[difyChat] No API key found')
      return new Response(
        JSON.stringify({
          error: 'Dify API key not configured',
          errorCode: 'EmptyAPIKey',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const difyUrlCandidates = buildDifyUrlCandidates(
      typeof url === 'string' ? url : ''
    )

    if (difyUrlCandidates.length === 0) {
      console.error('[difyChat] No Dify URL configured')
      return new Response(
        JSON.stringify({
          error: 'Dify URL not configured',
          errorCode: 'AIInvalidProperty',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    if (typeof query !== 'string' || query.trim().length === 0) {
      console.error('[difyChat] Empty query')
      return new Response(
        JSON.stringify({
          error: 'Query is required',
          errorCode: 'EmptyQuery',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    console.log('[difyChat] Dify URL candidates:', difyUrlCandidates)

    const headers = {
      Authorization: `Bearer ${difyKey}`,
      'Content-Type': 'application/json',
    }

    const generating = inputs?.mode === 'generate_question'
    let selectedKnowledge = undefined
    if (generating) {
      const lessonId = inputs?.lesson_id
      if (lessonId !== undefined && typeof lessonId !== 'string') {
        throw new QuizError(400, '授業回を選択してください。')
      }
      const selectedLesson = getLessonById(lessonId)
      const datasetId = selectedLesson?.datasetId || inputs?.source_dataset_id
      if (
        (datasetId !== undefined && typeof datasetId !== 'string') ||
        !(selectedKnowledge = getQuestionKnowledge(datasetId))
      )
        throw new QuizError(400, '授業回に対応する教材が見つかりません。')
    }
    const activeConversationId = generating ? undefined : conversationId
    const difyUser = user ? String(user) : 'aituber-kit'
    const conversationInputs = generating
      ? {}
      : await getQuizConversationInputs({
          difyBaseUrl: difyUrlCandidates[0].replace(/\/chat-messages$/, ''),
          difyKey,
          conversationId: conversationId || undefined,
          user: difyUser,
        })
    const mergedInputs: Record<string, any> = generating
      ? {
          mode: 'generate_question',
          source_dataset_id: selectedKnowledge!.id,
          question_pool_api_url: questionPoolCallbackUrl(req),
          question_pool_request_token: createQuestionPoolRequestToken(
            userId,
            selectedKnowledge!.id
          ),
        }
      : {
          ...conversationInputs,
          ...(inputs && typeof inputs === 'object' ? inputs : {}),
        }
    if (evaluation) evaluation.inputs = mergedInputs

    const requestBody = {
      // Allow the client to pass structured context (e.g., mode, lastQuiz, userAnswerIndex, etc.)
      inputs: mergedInputs,
      query: generating
        ? '今回の教材本文だけを根拠に、4択問題を1問作成してください。'
        : query,
      response_mode: stream ? 'streaming' : 'blocking',
      conversation_id: activeConversationId || undefined,
      // IMPORTANT: keep user stable per participant to help Dify maintain state
      user: difyUser,
      files: [],
    }
    let body = JSON.stringify(requestBody)
    let recoveredConversation = false

    console.log('[difyChat] Sending request to Dify...')

    let response: Response | null = null
    let resolvedDifyUrl = difyUrlCandidates[0]
    let lastFailure: {
      status: number
      error: string
      url: string
    } | null = null

    for (const candidateUrl of difyUrlCandidates) {
      const attemptStartedAt = performance.now()
      if (evaluation) evaluation.attempts += 1
      try {
        let candidateResponse = await fetch(candidateUrl, {
          method: 'POST',
          headers: headers,
          body: body,
          signal: AbortSignal.timeout(180000),
        })

        // A newly selected Dify app cannot use the previous app's conversation.
        // Retry only this explicit rejection (no generation has occurred), once.
        // Keep the local chat log and the quiz context supplied in inputs intact.
        if (
          candidateResponse.status === 404 &&
          activeConversationId &&
          !recoveredConversation
        ) {
          const failure = await candidateResponse
            .clone()
            .json()
            .catch(() => null)
          if (
            failure?.code === 'not_found' &&
            failure?.message === 'Conversation Not Exists.'
          ) {
            recoveredConversation = true
            body = JSON.stringify({
              ...requestBody,
              conversation_id: undefined,
            })
            if (evaluation) evaluation.attempts += 1
            console.log(
              '[difyChat] Starting a new conversation after missing conversation'
            )
            candidateResponse = await fetch(candidateUrl, {
              method: 'POST',
              headers,
              body,
              signal: AbortSignal.timeout(180000),
            })
          }
        }

        console.log('[difyChat] Dify response status:', {
          url: candidateUrl,
          status: candidateResponse.status,
        })

        if (candidateResponse.ok) {
          response = candidateResponse
          resolvedDifyUrl = candidateUrl
          break
        }

        const errorText = await candidateResponse.text()
        lastFailure = {
          status: candidateResponse.status,
          error: errorText,
          url: candidateUrl,
        }

        console.error('[difyChat] Dify API error:', lastFailure)

        if (
          candidateResponse.status === 401 ||
          candidateResponse.status === 403
        ) {
          break
        }
      } catch (error: any) {
        lastFailure = {
          status: 500,
          error: error?.message || 'Unknown fetch error',
          url: candidateUrl,
        }
        console.error('[difyChat] Dify fetch error:', lastFailure)
      } finally {
        if (evaluation)
          evaluation.difyMs =
            (evaluation.difyMs || 0) + performance.now() - attemptStartedAt
      }
    }

    if (!response) {
      return new Response(
        JSON.stringify({
          error: `Dify API request failed: ${lastFailure?.status || 500}`,
          errorCode: 'AIAPIError',
          details: lastFailure?.error || 'Unknown Dify error',
          triedUrls: difyUrlCandidates,
        }),
        {
          status: lastFailure?.status || 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    if (stream) {
      console.log('[difyChat] Streaming mode enabled')
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    console.log('[difyChat] Blocking mode - processing response')

    const bodyStartedAt = performance.now()
    let data
    try {
      data = await response.json()
    } finally {
      if (evaluation)
        evaluation.difyMs =
          (evaluation.difyMs || 0) + performance.now() - bodyStartedAt
    }
    if (evaluation) evaluation.data = data

    console.log('[difyChat] Raw response data:', data)

    let responseText = ''

    if (data.answer) {
      responseText = data.answer
      console.log('[difyChat] Response extracted from "answer" field')
    } else if (data.text) {
      responseText = data.text
      console.log('[difyChat] Response extracted from "text" field')
    } else if (data.message) {
      responseText = data.message
      console.log('[difyChat] Response extracted from "message" field')
    } else if (data.content) {
      responseText = data.content
      console.log('[difyChat] Response extracted from "content" field')
    } else if (data.result) {
      responseText = data.result
      console.log('[difyChat] Response extracted from "result" field')
    } else if (data.response) {
      responseText = data.response
      console.log('[difyChat] Response extracted from "response" field')
    } else {
      responseText = JSON.stringify(data)
      console.warn(
        '[difyChat] No standard response field found, using full data'
      )
    }

    console.log(
      '[difyChat] Extracted response text:',
      responseText.substring(0, 100) + '...'
    )

    // Try to parse structured JSON from the model output (A approach)
    if (evaluation) evaluation.rawOutput = responseText
    const parsed = tryParseJsonObject(responseText)
    if (
      inputs?.mode === 'generate_question' &&
      parsed?.type === 'insufficient_material'
    ) {
      return new Response(
        JSON.stringify({
          error:
            '選ばれた教材本文だけでは4択問題を作れませんでした。もう一度生成してください。',
          errorCode: 'QuizMaterialInsufficient',
        }),
        {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
    let sanitizedParsed = parsed ? sanitizeForClient(parsed) : null
    let quizMemory
    if (
      inputs?.mode === 'generate_question' &&
      parsed?.type === 'question_pool_empty'
    ) {
      return new Response(
        JSON.stringify({
          error:
            parsed.message ||
            '選択中の教材には、採用済みの4択問題がありません。',
          errorCode: 'QuizMaterialInsufficient',
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const issuedQuizId =
      inputs?.mode === 'generate_question' &&
      parsed?.type === 'quiz' &&
      typeof parsed?.serverQuizId === 'string'
        ? parsed.serverQuizId
        : ''
    if (issuedQuizId) {
      quizMemory = await getIssuedQuiz(userId, issuedQuizId)
      if (!quizMemory)
        throw new QuizError(
          502,
          '問題プールから取得した問題を確認できませんでした。'
        )
      sanitizedParsed = {
        type: 'quiz',
        serverQuizId: quizMemory.serverQuizId,
        question: quizMemory.question,
        choices: quizMemory.choices,
        difficultyLevel: quizMemory.difficultyLevel,
        questionGroup: quizMemory.questionGroup,
      }
      responseText = quizMemory.rawText
    } else {
      const generatedQuiz = parseServerQuiz(responseText, parsed)
      if (evaluation) evaluation.quiz = generatedQuiz
      if (generatedQuiz && !generating) {
        throw new QuizError(
          502,
          '教材に基づく問題は「問題生成」から出題してください。'
        )
      }
      if (generatedQuiz) {
        quizMemory = await issueQuiz(userId, {
          ...generatedQuiz,
          sources: retrievalSources(data.metadata),
        })
        sanitizedParsed = {
          type: 'quiz',
          serverQuizId: quizMemory.serverQuizId,
          question: quizMemory.question,
          choices: quizMemory.choices,
          quizIndex: quizMemory.quizIndex,
          total: quizMemory.total,
        }
        // All response representations must omit the answer until grading succeeds.
        responseText = quizMemory.rawText
      } else if (inputs?.mode === 'generate_question') {
        throw new QuizError(
          502,
          '問題プールから採点可能な問題を取得できませんでした。'
        )
      }
    }

    // If the parsed object is a grade, derive emotion from correct/userIndex.
    let emotion:
      | 'happy'
      | 'excited'
      | 'bored'
      | 'relaxed'
      | 'sad'
      | 'sweat'
      | 'rage'
      | 'neutral' = 'neutral'
    if (
      sanitizedParsed &&
      typeof sanitizedParsed === 'object' &&
      sanitizedParsed.type === 'grade'
    ) {
      emotion = deriveEmotionFromGrade(sanitizedParsed as GradeResult)
    } else if (
      sanitizedParsed &&
      typeof sanitizedParsed === 'object' &&
      typeof (sanitizedParsed as any).emotion === 'string'
    ) {
      // If Dify already returns emotion (and it matches allowed values), keep it.
      const e = String((sanitizedParsed as any).emotion)
      if (
        e === 'happy' ||
        e === 'excited' ||
        e === 'bored' ||
        e === 'relaxed' ||
        e === 'sad' ||
        e === 'sweat' ||
        e === 'rage' ||
        e === 'neutral'
      )
        emotion = e
    } else {
      const inferred = extractEmotionFromRawText(responseText)
      if (inferred) emotion = inferred
    }

    const displayText = extractDisplayText(sanitizedParsed, responseText)
    const displayHTML = extractDisplayHTML(sanitizedParsed, responseText)
    const fallbackHTML = buildStructuredHtmlFromText(displayText)
    const finalHTML =
      typeof displayHTML === 'string' && displayHTML.trim().length > 0
        ? displayHTML
        : fallbackHTML
    const is_html = true
    const splitForSegments = (
      text: string,
      html: string | null
    ): { text: string; html: string | null; is_html: boolean }[] => {
      const marker = '【問題】'
      const index = text.indexOf(marker)
      if (index <= 0) {
        return [{ text, html, is_html: true }]
      }

      const before = text.slice(0, index).trimEnd()
      const after = text.slice(index).trimStart()
      if (!before || !after) {
        return [{ text, html, is_html: true }]
      }

      let firstHtml: string | null = null
      let secondHtml: string | null = null
      if (html) {
        const sep = '<hr class="dify-sep"/>'
        const sepIndex = html.indexOf(sep)
        if (sepIndex >= 0) {
          firstHtml = html.slice(0, sepIndex).trim()
          secondHtml = html.slice(sepIndex + sep.length).trim()
        }
      }
      if (!firstHtml) firstHtml = buildStructuredHtmlFromText(before)
      if (!secondHtml) secondHtml = buildStructuredHtmlFromText(after)

      return [
        { text: before, html: firstHtml, is_html: true },
        { text: after, html: secondHtml, is_html: true },
      ]
    }

    const segments = splitForSegments(displayText, finalHTML)

    const unifiedResponse = {
      // what the UI should display
      text: displayText,
      answer: displayText,

      // optional HTML rendering payload (UI can prefer this when is_html=true)
      html: finalHTML,
      is_html,
      segments,

      // stable meta
      message: 'Success',
      conversation_id: data.conversation_id || activeConversationId || null,

      // structured payload for the client
      parsed: sanitizedParsed, // may be null
      emotion, // 'happy' | 'sweat' | 'rage' | 'neutral'
      quizMemory,
    }

    console.log('[difyChat] Sending unified response to client')
    console.log('[difyChat] HTML debug:', {
      hasHtml: !!finalHTML,
      htmlPreview: finalHTML ? finalHTML.slice(0, 200) : null,
      segments: segments.map((s) => ({
        hasHtml: !!s.html,
        htmlPreview: s.html ? s.html.slice(0, 80) : null,
      })),
    })

    return new Response(JSON.stringify(unifiedResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('[difyChat] Unexpected error:', error)

    return new Response(
      JSON.stringify({
        error: error.message || 'Internal server error',
        errorCode:
          error instanceof QuizError && error.status === 502
            ? 'QuizGenerationFailed'
            : 'InternalError',
      }),
      {
        status: error instanceof QuizError ? error.status : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  const session = requireSession(req, res)
  if (!session) return
  const settings =
    session.role === 'admin' &&
    req.body?.inputs?.mode === 'generate_question' &&
    !req.body?.stream
      ? evaluationSettings(req.body?.evaluation, session.userId)
      : null
  const capture: QuizEvaluationCapture | undefined = settings
    ? { attempts: 0 }
    : undefined
  const startedAt = performance.now()
  const response = await proxyDify(req, session.userId, capture)
  if (settings && capture) {
    try {
      const id = await saveQuizEvaluation({
        ownerId: session.userId,
        settings,
        capture,
        queryText: req.body?.query,
        conversationId: req.body?.conversationId,
        response,
        serverMs: performance.now() - startedAt,
      })
      res.setHeader('X-Quiz-Evaluation-Id', id)
    } catch {
      // A failed measurement must never prevent an otherwise valid quiz.
      console.error('[quiz-evaluation] Could not save measurement')
      res.setHeader('X-Quiz-Evaluation-Error', 'save_failed')
    }
  }
  res.status(response.status)
  res.setHeader(
    'Content-Type',
    response.headers.get('Content-Type') || 'application/json'
  )
  if (!response.body) return res.end()
  const reader = response.body.getReader()
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  res.on('close', cancel)
  try {
    while (!res.destroyed) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
  } finally {
    res.off('close', cancel)
    reader.releaseLock()
    res.end()
  }
}
