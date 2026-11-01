// Conservative bounds of every petal at every animation phase:
// max orbit 88, horizontal/vertical spread 1.45/0.95, petal size 26,
// petal reach 1.33 * size and 1.5px outline (including arbitrary rotation).
export const HAPPY_AURA_EXTENT = { x: 166, y: 122 }

export function fitHappyAuraToStage(
  width: number,
  height: number,
  x: number,
  y: number,
  pulse: number
) {
  const padding = Math.min(16, width / 2, height / 2)
  const scale = Math.max(
    0,
    Math.min(
      1.4 * pulse,
      (width - padding * 2) / (HAPPY_AURA_EXTENT.x * 2),
      (height - padding * 2) / (HAPPY_AURA_EXTENT.y * 2)
    )
  )
  const insetX = padding + HAPPY_AURA_EXTENT.x * scale
  const insetY = padding + HAPPY_AURA_EXTENT.y * scale
  return {
    scale,
    x: Math.max(insetX, Math.min(width - insetX, x)),
    y: Math.max(insetY, Math.min(height - insetY, y)),
  }
}
