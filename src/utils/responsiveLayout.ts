export type LayoutStage = 'mobile' | 'tablet' | 'desktop'

export const MOBILE_LAYOUT_MAX = 960
export const DESKTOP_LAYOUT_MIN = 1280
export const DEFAULT_WORKSPACE_AVATAR_CHAT_RATIO = 0.6
export const DEFAULT_WORKSPACE_MATERIAL_CHAT_RATIO = 0.38

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

export const getLayoutStage = (viewportWidth: number): LayoutStage => {
  if (viewportWidth < MOBILE_LAYOUT_MAX) return 'mobile'
  if (viewportWidth < DESKTOP_LAYOUT_MIN) return 'tablet'
  return 'desktop'
}

export const getRightRailWidth = (viewportWidth: number) => {
  const stage = getLayoutStage(viewportWidth)
  if (stage === 'mobile') return 0
  if (stage === 'tablet') {
    return clamp(viewportWidth * 0.26, 208, 280)
  }
  return clamp(viewportWidth * 0.34, 360, 544)
}

export const getChatPaneWidth = (
  viewportWidth: number,
  chatLogWidth: number
) => {
  if (!viewportWidth) return chatLogWidth

  const stage = getLayoutStage(viewportWidth)
  const rightRailWidth = getRightRailWidth(viewportWidth)

  if (stage === 'mobile') {
    return Math.max(viewportWidth - 16, 0)
  }

  if (stage === 'tablet') {
    return clamp(viewportWidth - rightRailWidth - 24, 360, viewportWidth - 220)
  }

  return clamp(
    Math.max(chatLogWidth + 16, viewportWidth * 0.48),
    520,
    viewportWidth - rightRailWidth - 24
  )
}

export const clampWorkspaceChatPaneWidth = (
  viewportWidth: number,
  desiredWidth: number
) => {
  if (viewportWidth < MOBILE_LAYOUT_MAX) return Math.max(viewportWidth, 0)

  const stage = getLayoutStage(viewportWidth)
  const minimumChatWidth = stage === 'tablet' ? 360 : 400
  const minimumSecondaryWidth = stage === 'tablet' ? 300 : 360
  const maximumChatWidth = Math.max(0, viewportWidth - minimumSecondaryWidth)
  const minimumWidth = Math.min(minimumChatWidth, maximumChatWidth)

  return clamp(desiredWidth, minimumWidth, maximumChatWidth)
}

export const getWorkspaceChatPaneWidth = (
  viewportWidth: number,
  ratio: number,
  fallbackRatio: number
) => {
  if (!viewportWidth) return 0

  const safeRatio = Number.isFinite(ratio) ? ratio : fallbackRatio
  return clampWorkspaceChatPaneWidth(viewportWidth, viewportWidth * safeRatio)
}
