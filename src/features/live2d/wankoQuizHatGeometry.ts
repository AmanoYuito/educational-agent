type Point = { x: number; y: number }
export type HatAnchor = { left: number; right: number; widthRatio: number }

// Pick stable forehead vertices once. Follow the same mesh points through
// animations instead of chasing the changing bounds of the model or its bowl.
export function createHatAnchor(vertices: ArrayLike<number>): HatAnchor | null {
  if (vertices.length < 6 || vertices.length % 2 !== 0) return null
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (let i = 0; i < vertices.length; i += 2) {
    if (!Number.isFinite(vertices[i]) || !Number.isFinite(vertices[i + 1]))
      return null
    minX = Math.min(minX, vertices[i])
    maxX = Math.max(maxX, vertices[i])
    minY = Math.min(minY, vertices[i + 1])
    maxY = Math.max(maxY, vertices[i + 1])
  }
  let left = -1,
    right = -1
  for (let i = 0; i < vertices.length; i += 2) {
    if (vertices[i + 1] > minY + (maxY - minY) * 0.22) continue
    if (left < 0 || vertices[i] < vertices[left]) left = i
    if (right < 0 || vertices[i] > vertices[right]) right = i
  }
  if (left < 0 || right < 0) return null
  const span = Math.hypot(
    vertices[right] - vertices[left],
    vertices[right + 1] - vertices[left + 1]
  )
  if (span < 1 || maxX <= minX) return null
  return { left, right, widthRatio: ((maxX - minX) * 0.96) / span }
}

export function getHatPose(left: Point, right: Point, widthRatio: number) {
  const dx = right.x - left.x,
    dy = right.y - left.y
  const span = Math.hypot(dx, dy)
  if (!Number.isFinite(span) || span < 0.001) return null
  const width = span * widthRatio
  return {
    x: (left.x + right.x) / 2 - (dy / span) * width * 0.025,
    y: (left.y + right.y) / 2 + (dx / span) * width * 0.025,
    rotation: Math.atan2(dy, dx),
    scale: width / 248,
  }
}
