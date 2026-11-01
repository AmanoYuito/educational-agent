import { NextRequest } from 'next/server'

export const config = {
  runtime: 'edge',
}

const DEFAULT_DIFY_URL = 'https://api.dify.ai/v1'
const DEFAULT_DIFY_USER = 'aituber-kit'

const firstNonEmpty = (...values: Array<unknown>) => {
  for (const value of values) {
    const trimmed = String(value || '').trim()
    if (trimmed) return trimmed
  }
  return ''
}

const cleanUrl = (urlStr: string) => urlStr.replace(/\/$/, '')

const buildBaseUrlCandidates = (clientUrl?: string) => {
  const candidates = [process.env.DIFY_URL, clientUrl, DEFAULT_DIFY_URL]
    .map((value) => cleanUrl(String(value || '').trim()))
    .filter(Boolean)

  return Array.from(new Set(candidates))
}

type VariableRecord = {
  id: string
  name: string
  value_type: string
  value: unknown
}

export default async function handler(req: NextRequest) {
  if (req.method !== 'POST') {
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
    const { conversationId, apiKey, url, updates, user } = await req.json()

    if (typeof conversationId !== 'string' || !conversationId.trim()) {
      return new Response(
        JSON.stringify({
          error: 'conversationId is required',
          errorCode: 'EmptyConversationId',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    if (!updates || typeof updates !== 'object') {
      return new Response(
        JSON.stringify({
          error: 'updates is required',
          errorCode: 'EmptyUpdates',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const difyKey = firstNonEmpty(
      process.env.DIFY_KEY,
      process.env.DIFY_API_KEY,
      process.env.NEXT_PUBLIC_DIFY_API_KEY,
      apiKey
    )
    if (!difyKey) {
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

    const difyBaseUrlCandidates = buildBaseUrlCandidates(
      typeof url === 'string' ? url : ''
    )
    const difyBaseUrl = difyBaseUrlCandidates[0]
    const difyUser =
      typeof user === 'string' && user.trim() ? user : DEFAULT_DIFY_USER

    const headers = {
      Authorization: `Bearer ${difyKey}`,
      'Content-Type': 'application/json',
    }

    let listResponse: Response | null = null
    let resolvedBaseUrl = difyBaseUrl
    let lastFailure: {
      status: number
      error: string
      url: string
    } | null = null

    for (const candidateBaseUrl of difyBaseUrlCandidates) {
      const listUrl = new URL(
        `${candidateBaseUrl}/conversations/${conversationId}/variables`
      )
      listUrl.searchParams.set('user', difyUser)

      const candidateResponse = await fetch(listUrl.toString(), {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(30000),
      })

      if (candidateResponse.ok) {
        listResponse = candidateResponse
        resolvedBaseUrl = candidateBaseUrl
        break
      }

      const errorText = await candidateResponse.text()
      lastFailure = {
        status: candidateResponse.status,
        error: errorText,
        url: candidateBaseUrl,
      }

      if (
        candidateResponse.status === 401 ||
        candidateResponse.status === 403
      ) {
        break
      }
    }

    if (!listResponse) {
      return new Response(
        JSON.stringify({
          error: 'Failed to list Dify conversation variables',
          errorCode: 'AIAPIError',
          details: lastFailure?.error || 'Unknown Dify error',
          triedUrls: difyBaseUrlCandidates,
        }),
        {
          status: lastFailure?.status || 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const listData = await listResponse.json()
    const variables: VariableRecord[] = Array.isArray(listData?.data)
      ? listData.data
      : []
    const variablesByName = new Map(variables.map((item) => [item.name, item]))

    const updated: string[] = []
    const missing: string[] = []

    for (const [name, value] of Object.entries(updates)) {
      const variable = variablesByName.get(name)
      if (!variable?.id) {
        missing.push(name)
        continue
      }

      const updateResponse = await fetch(
        `${resolvedBaseUrl}/conversations/${conversationId}/variables/${variable.id}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            value,
            user: difyUser,
          }),
          signal: AbortSignal.timeout(30000),
        }
      )

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text()
        return new Response(
          JSON.stringify({
            error: `Failed to update conversation variable: ${name}`,
            errorCode: 'AIAPIError',
            details: errorText,
          }),
          {
            status: updateResponse.status,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      updated.push(name)
    }

    return new Response(
      JSON.stringify({
        updated,
        missing,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        error: error?.message || 'Internal server error',
        errorCode: 'InternalError',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
