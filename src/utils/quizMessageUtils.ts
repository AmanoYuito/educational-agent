export const getPlainMessage = (message: string) =>
  String(message || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

export const isStructuredQuizMessage = (message: string): boolean => {
  const plainMessage = getPlainMessage(message)
  if (
    (plainMessage.includes('【問題】') &&
      plainMessage.includes('【選択肢】')) ||
    (plainMessage.includes('[問題]') && plainMessage.includes('[選択肢]'))
  ) {
    return true
  }

  if (!plainMessage.startsWith('{') && !plainMessage.startsWith('[')) {
    return false
  }

  try {
    const parsed = JSON.parse(plainMessage)
    const items = Array.isArray(parsed) ? parsed : [parsed]
    return items.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        ('type' in item || 'question' in item || 'correct' in item)
    )
  } catch {
    return false
  }
}

export const isQuizRetryMessage = (message: string): boolean => {
  const plainMessage = getPlainMessage(message)
  return /^A〜D、1〜4、または選択肢の文そのもので答えてね。?$/u.test(
    plainMessage
  )
}

export const isQuizUiOnlyMessage = (message: string): boolean =>
  isStructuredQuizMessage(message) || isQuizRetryMessage(message)
