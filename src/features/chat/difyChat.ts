import settingsStore from '@/features/stores/settings'
import { Message } from '../messages/messages'
import i18next from 'i18next'
import toastStore from '@/features/stores/toast'
import { withBasePath } from '@/utils/basePath'
import type { GeneratedQuizMemory } from '@/features/stores/home'
import {
  loadEvaluationSettings,
  registerEvaluationResponse,
  evaluationWarning,
} from '@/features/quizEvaluation/client'

export type DifyChatMode =
  | 'generate_question'
  | 'explain_quiz'
  | 'grade_written_answer'
export type DifyDifficulty = 'easy' | 'normal' | 'hard'

export type DifyChatRequestOptions = {
  generationStartedAt?: number
  mode?: DifyChatMode
  topic?: string
  difficulty?: DifyDifficulty
  inputs?: Record<string, string>
  user?: string
}

export type DifyConversationVariableUpdates = Record<
  string,
  string | string[] | Record<string, unknown> | null
>

function handleApiError(errorCode: string): string {
  const languageCode = settingsStore.getState().selectLanguage
  i18next.changeLanguage(languageCode)
  return i18next.t(`Errors.${errorCode || 'AIAPIError'}`, {
    defaultValue: i18next.t('Errors.AIAPIError'),
  })
}

const nonEmptyString = (value?: string) => {
  const trimmed = String(value || '').trim()
  return trimmed || ''
}

const extractQueryText = (message: Message | undefined): string => {
  if (!message?.content) return ''
  if (typeof message.content === 'string') return message.content
  return message.content[0]?.text || ''
}

const buildDifyInputs = (options?: DifyChatRequestOptions) => {
  if (!options) return undefined

  const inputs: Record<string, string> = {}

  if (options.mode) {
    inputs.mode = options.mode
  }

  if (options.topic) {
    inputs.topic = options.topic
  }

  if (options.difficulty) {
    inputs.difficulty = options.difficulty
  }

  if (options.inputs) {
    Object.entries(options.inputs).forEach(([key, value]) => {
      if (typeof value === 'string') {
        inputs[key] = value
      }
    })
  }

  return Object.keys(inputs).length > 0 ? inputs : undefined
}

export async function getDifyChatResponseStream(
  messages: Message[],
  apiKey: string,
  url: string,
  conversationId: string
): Promise<ReadableStream<string>> {
  const sanitizedApiKey = nonEmptyString(apiKey)
  const sanitizedUrl = nonEmptyString(url)
  const response = await fetch(withBasePath('/api/difyChat/'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: messages[messages.length - 1].content,
      ...(sanitizedApiKey ? { apiKey: sanitizedApiKey } : {}),
      ...(sanitizedUrl ? { url: sanitizedUrl } : {}),
      conversationId,
      stream: true,
    }),
  })

  try {
    if (!response.ok) {
      const responseBody = await response.json()
      throw new Error(
        `API request to Dify failed with status ${response.status} and body ${responseBody.error}`,
        { cause: { errorCode: responseBody.errorCode } }
      )
    }

    return new ReadableStream({
      async start(controller) {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
        try {
          if (!response.body) {
            throw new Error('API response from Dify is empty', {
              cause: { errorCode: 'AIAPIError' },
            })
          }

          reader = response.body.getReader()
          const decoder = new TextDecoder('utf-8')
          let buffer = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })

            // 改行で分割し、最後の不完全な行をバッファに保持
            let lines = buffer.split('\n')
            buffer = lines.pop() || ''

            lines.forEach((line) => {
              if (line.startsWith('data:')) {
                const jsonStr = line.slice(5) // 'data:' プレフィックスを除去
                try {
                  const data = JSON.parse(jsonStr)
                  if (
                    data.event === 'agent_message' ||
                    data.event === 'message'
                  ) {
                    if (data.answer) {
                      controller.enqueue(data.answer)
                    }
                  }

                  if (data.conversation_id) {
                    settingsStore.setState({
                      difyConversationId: data.conversation_id,
                    })
                  }
                } catch (error) {
                  console.error('Error parsing JSON:', error)
                }
              }
            })
          }
        } catch (error) {
          console.error(`Error fetching Dify API response:`, error)

          toastStore.getState().addToast({
            message: i18next.t('Errors.AIAPIError'),
            type: 'error',
            tag: 'dify-api-error',
          })
        } finally {
          controller.close()
          if (reader) {
            reader.releaseLock()
          }
        }
      },
    })
  } catch (error: any) {
    const errorMessage = handleApiError(
      error.cause ? error.cause.errorCode : 'AIAPIError'
    )
    toastStore.getState().addToast({
      message: errorMessage,
      type: 'error',
      tag: 'dify-api-error',
    })
    throw error
  }
}

export async function getDifyChatResponse(
  messages: Message[],
  apiKey: string,
  url: string,
  conversationId: string,
  options?: DifyChatRequestOptions
): Promise<{
  text: string
  html: string | null
  is_html: boolean
  emotion?: 'happy' | 'sweat' | 'rage' | 'neutral'
  parsed?: any
  quizMemory?: GeneratedQuizMemory
  segments?: { text: string; html: string | null; is_html: boolean }[]
  conversation_id?: string | null
  evaluationId?: string
}> {
  const query = extractQueryText(messages[messages.length - 1])
  const inputs = buildDifyInputs(options)
  const sanitizedApiKey = nonEmptyString(apiKey)
  const sanitizedUrl = nonEmptyString(url)

  const settings =
    inputs?.mode === 'generate_question' ? loadEvaluationSettings() : null
  const evaluation = settings?.enabled ? settings : undefined
  const generationStartedAt = options?.generationStartedAt ?? performance.now()
  const requestStartedAt = performance.now()

  const response = await fetch(withBasePath('/api/difyChat/'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      ...(sanitizedApiKey ? { apiKey: sanitizedApiKey } : {}),
      ...(sanitizedUrl ? { url: sanitizedUrl } : {}),
      conversationId,
      ...(inputs ? { inputs } : {}),
      ...(options?.user ? { user: options.user } : {}),
      stream: false,
      ...(evaluation ? { evaluation } : {}),
    }),
  })

  try {
    const data = await response.json()
    const evaluationId =
      response.headers.get('X-Quiz-Evaluation-Id') || undefined
    if (evaluationId)
      registerEvaluationResponse(
        evaluationId,
        generationStartedAt,
        performance.now() - requestStartedAt,
        response.ok
      )
    if (response.headers.get('X-Quiz-Evaluation-Error'))
      evaluationWarning('出題の計測記録を保存できませんでした。')
    if (!response.ok) {
      throw new Error(
        `API request to Dify failed with status ${response.status} and body ${data.error}`,
        { cause: { errorCode: data.errorCode } }
      )
    }

    if (data?.conversation_id) {
      settingsStore.setState({
        difyConversationId: data.conversation_id,
      })
    }

    return {
      evaluationId,
      text: typeof data?.text === 'string' ? data.text : data?.answer || '',
      html: typeof data?.html === 'string' ? data.html : null,
      is_html: !!data?.is_html || typeof data?.html === 'string',
      emotion: data?.emotion,
      parsed: data?.parsed,
      quizMemory: data?.quizMemory,
      segments: Array.isArray(data?.segments) ? data.segments : undefined,
      conversation_id:
        typeof data?.conversation_id === 'string'
          ? data.conversation_id
          : conversationId || null,
    }
  } catch (error: any) {
    const errorMessage = handleApiError(
      error.cause ? error.cause.errorCode : 'AIAPIError'
    )
    toastStore.getState().addToast({
      message: errorMessage,
      type: 'error',
      tag: 'dify-api-error',
    })
    throw error
  }
}

export async function syncDifyConversationVariables(
  conversationId: string,
  apiKey: string,
  url: string,
  updates: DifyConversationVariableUpdates,
  user?: string
): Promise<{ updated: string[]; missing: string[] }> {
  const sanitizedApiKey = nonEmptyString(apiKey)
  const sanitizedUrl = nonEmptyString(url)
  const response = await fetch(
    withBasePath('/api/difyConversationVariables/'),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversationId,
        ...(sanitizedApiKey ? { apiKey: sanitizedApiKey } : {}),
        ...(sanitizedUrl ? { url: sanitizedUrl } : {}),
        updates,
        ...(user ? { user } : {}),
      }),
    }
  )

  if (!response.ok) {
    const responseBody = await response.json().catch(() => null)
    throw new Error(
      `Failed to sync Dify conversation variables: ${response.status} ${
        responseBody?.error || ''
      }`.trim()
    )
  }

  return response.json()
}
