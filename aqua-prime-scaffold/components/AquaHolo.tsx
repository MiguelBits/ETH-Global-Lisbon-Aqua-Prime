"use client"

import type { CSSProperties, ReactNode } from "react"

type Props = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  as?: "div" | "aside" | "section"
  "aria-label"?: string
  "aria-live"?: "polite" | "off" | "assertive"
}

/** JARVIS holographic shell — scan wipe + soft grid (parent remounts via key). */
export const AquaHolo = ({
  children,
  className = "",
  style,
  as: Tag = "div",
  "aria-label": ariaLabel,
  "aria-live": ariaLive,
}: Props) => (
  <Tag
    className={`aqua-holo ${className}`.trim()}
    style={style}
    aria-label={ariaLabel}
    aria-live={ariaLive}
  >
    <span className="aqua-holo-scan" aria-hidden />
    <span className="aqua-holo-grid" aria-hidden />
    <div className="aqua-holo-body">{children}</div>
  </Tag>
)
