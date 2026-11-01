import { Graphics, Point, Renderer } from 'pixi.js'
import type { Live2DModel } from 'pixi-live2d-display-lipsyncpatch/cubism4'
import {
  createHatAnchor,
  getHatPose,
  type HatAnchor,
} from './wankoQuizHatGeometry'

/** A vector mortarboard in the same brown/charcoal/gold palette as the quiz icon. */
export class WankoQuizHat extends Graphics {
  enabled = false
  private anchorPoints: HatAnchor | null = null
  private readonly leftPoint = new Point()
  private readonly rightPoint = new Point()
  private readonly faceIndex: number

  constructor(private readonly avatar: InstanceType<typeof Live2DModel>) {
    super()
    const internal = avatar.internalModel
    const ids = internal.getDrawableIDs()
    // This fitting is for the bundled Wanko model, not arbitrary Live2D models.
    this.faceIndex = ids.includes('D_BOWL_00') ? ids.indexOf('D_FACE_00') : -1
    this.eventMode = 'none'
    this.interactiveChildren = false
    this.name = 'wanko-quiz-hat'
    const outline = 0x62412f
    // Diamond-shaped top.
    this.lineStyle(5, outline, 1)
      .beginFill(0x514c5b)
      .moveTo(-124, -49)
      .lineTo(0, -96)
      .lineTo(124, -49)
      .lineTo(0, -7)
      .closePath()
      .endFill()
    this.lineStyle(2, 0x8e8289, 0.85)
      .moveTo(-114, -49)
      .lineTo(0, -88)
      .lineTo(114, -49)
    // Curved band resting on the forehead.
    this.lineStyle(5, outline, 1)
      .beginFill(0x514955)
      .moveTo(-76, -41)
      .bezierCurveTo(-46, -56, 43, -56, 77, -41)
      .lineTo(82, 3)
      .quadraticCurveTo(0, -5, -82, 3)
      .closePath()
      .endFill()
    this.lineStyle(2, 0x766875, 0.7).moveTo(-69, -35).lineTo(-73, -3)
    // Gold cord and tassel, outlined like the existing chat icon.
    this.lineStyle(8, outline, 1)
      .moveTo(59, -48)
      .lineTo(100, -35)
      .lineTo(98, -13)
    this.lineStyle(4, 0xf5cf72, 1)
      .moveTo(59, -48)
      .lineTo(100, -35)
      .lineTo(98, -13)
    this.lineStyle(3, outline, 1)
      .beginFill(0xf5cf72)
      .drawCircle(98, -10, 6)
      .endFill()
    this.beginFill(0xe4b454)
      .moveTo(94, -3)
      .lineTo(91, 31)
      .quadraticCurveTo(99, 36, 107, 31)
      .lineTo(102, -3)
      .closePath()
      .endFill()
    this.lineStyle(2, 0xffe5a2, 1)
      .moveTo(97, 3)
      .lineTo(96, 28)
      .moveTo(101, 3)
      .lineTo(103, 29)
  }

  // Live2D deforms its mesh in the parent's render, after ticker callbacks.
  // Update here (as its child) so the cap follows the freshly rendered face.
  render(renderer: Renderer) {
    if (
      !this.enabled ||
      this.faceIndex < 0 ||
      this.destroyed ||
      this.avatar.destroyed
    )
      return
    const internal = this.avatar.internalModel
    const vertices = internal.getDrawableVertices(this.faceIndex)
    this.anchorPoints ||= createHatAnchor(vertices)
    const anchor = this.anchorPoints
    if (!anchor) return
    this.leftPoint.set(vertices[anchor.left], vertices[anchor.left + 1])
    this.rightPoint.set(vertices[anchor.right], vertices[anchor.right + 1])
    internal.localTransform.apply(this.leftPoint, this.leftPoint)
    internal.localTransform.apply(this.rightPoint, this.rightPoint)
    const pose = getHatPose(this.leftPoint, this.rightPoint, anchor.widthRatio)
    if (!pose) return
    this.position.set(pose.x, pose.y)
    this.rotation = pose.rotation
    this.scale.set(pose.scale)
    this.updateTransform()
    super.render(renderer)
  }
}
