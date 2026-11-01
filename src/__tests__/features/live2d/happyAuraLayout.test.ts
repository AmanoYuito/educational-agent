import { fitHappyAuraToStage } from '@/features/live2d/happyAuraLayout'

it.each([
  [320, 200],
  [384, 280],
  [432, 322],
  [592, 450],
  [120, 90],
])(
  'keeps moving flowers inside a %dx%d stage without scaling the avatar',
  (width, height) => {
    for (let frame = 0; frame < 120; frame++) {
      const t = frame / 10
      const layout = fitHappyAuraToStage(
        width,
        height,
        width / 2,
        height * 0.2,
        1 + 0.03 * Math.sin(t * 2.8)
      )
      for (let i = 0; i < 30; i++) {
        const phase = i * 0.95
        const angle =
          (Math.PI * 2 * i) / 30 + 0.12 + 0.18 * Math.sin(t * 0.55 + phase)
        const radius = 45 + (i % 4) * 12 + 7 * Math.sin(t * 0.9 + phase)
        const reach = (10 + (i % 5) * 4) * 1.33 + 1.5
        const x = layout.x + Math.cos(angle) * radius * 1.45 * layout.scale
        const y = layout.y + Math.sin(angle) * radius * 0.95 * layout.scale
        expect(x - reach * layout.scale).toBeGreaterThanOrEqual(15.99)
        expect(y - reach * layout.scale).toBeGreaterThanOrEqual(15.99)
        expect(x + reach * layout.scale).toBeLessThanOrEqual(width - 15.99)
        expect(y + reach * layout.scale).toBeLessThanOrEqual(height - 15.99)
      }
    }
  }
)
it('retains the original aura scale when ample space is available', () => {
  const layout = fitHappyAuraToStage(800, 800, 400, 400, 1.03)
  expect(layout.scale).toBeCloseTo(1.4 * 1.03)
  expect(layout.x).toBe(400)
  expect(layout.y).toBe(400)
})
