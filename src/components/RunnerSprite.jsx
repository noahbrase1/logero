import { useEffect, useState } from 'react'

// This sheet is 1774x887 with 4 poses laid out left-to-right, NOT a uniform
// grid — each pose is a different width (414/284/370/249px) with uneven
// gaps between them (88-121px). Measured directly from the source PNG: for
// every column x, count bright (non-background) pixels and find the
// contiguous bright x-ranges, then find each range's own y bbox. That gives
// each frame's true content bounding box, which is what FRAME_CENTERS below
// is built from — center it in a fixed-size window (rather than assuming
// equal-width columns) so nothing gets cut off and neighboring poses can't
// bleed into each other's window.
const SHEET_W = 1774
const SHEET_H = 887

const FRAME_CENTERS = [
  { x: 242.5, y: 443.5 }, // frame 0: content x=[36,449] y=[180,707]
  { x: 678.5, y: 451.0 }, // frame 1: content x=[537,820] y=[177,725]
  { x: 1125.5, y: 453.5 }, // frame 2: content x=[941,1310] y=[187,720]
  { x: 1550.0, y: 457.5 }, // frame 3: content x=[1426,1674] y=[188,727]
]
const FRAME_COUNT = FRAME_CENTERS.length

// Fixed sample window (native px) centered on each frame's own content
// center above. 430x580 was chosen and verified against the source image:
// it fully contains the widest pose (414px) and tallest pose (548px) with
// margin on every side, while staying well clear of the neighboring poses
// on both sides (closest gap is frame0-frame1 at 88px, and this window's
// horizontal padding beyond each frame's own content never exceeds that).
const CROP_W = 430
const CROP_H = 580
const CROP_ASPECT = CROP_H / CROP_W

// Looping running-in-place background animation for the auth pages (see
// LoginPage/SignUpPage) — cycles the 4-frame sprite sheet via
// background-position rather than swapping <img> src, so there's no
// flicker/reflow between frames. Frames advance in the order they appear
// left-to-right in the sheet (0,1,2,3) and loop back to 0.
export default function RunnerSprite({ width = 300, intervalMs = 144 }) {
  const [frame, setFrame] = useState(0)
  const height = Math.round(width * CROP_ASPECT)
  const scale = width / CROP_W

  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % FRAME_COUNT)
    }, intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  const center = FRAME_CENTERS[frame]
  const sampleX = center.x - CROP_W / 2
  const sampleY = center.y - CROP_H / 2

  return (
    <div
      className="runner-sprite"
      style={{
        width,
        height,
        backgroundImage: 'url(/runner-sprite.png)',
        backgroundSize: `${SHEET_W * scale}px ${SHEET_H * scale}px`,
        backgroundPosition: `-${sampleX * scale}px -${sampleY * scale}px`,
      }}
      aria-hidden="true"
    />
  )
}
