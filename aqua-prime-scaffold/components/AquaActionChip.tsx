"use client"

import Link from "next/link"
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { createPortal } from "react-dom"
import type { AquaAction } from "~~/lib/jarvis/aquaActions"

type Props = {
  action: AquaAction
  pulse?: boolean
  armed?: boolean
  disabled?: boolean
  disabledReason?: string | null
  onActivate: (action: AquaAction) => void
}

type TipPos = {
  left: number
  top: number
  above: boolean
}

/**
 * Action chip with portaled hover tip (same idea as glossary terms).
 */
export const AquaActionChip = ({
  action,
  pulse,
  armed,
  disabled,
  disabledReason,
  onActivate,
}: Props) => {
  const tipId = useId()
  const wrapRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<TipPos | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) {
      setPos(null)
      return
    }

    const place = () => {
      const el = wrapRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const tipEl = tipRef.current
      const tipH = tipEl?.offsetHeight ?? 64
      const tipW = tipEl?.offsetWidth ?? 260
      const gap = 10
      const above = r.top >= tipH + gap + 8
      let left = r.left + r.width / 2
      left = Math.max(tipW / 2 + 8, Math.min(left, window.innerWidth - tipW / 2 - 8))
      const top = above ? r.top - gap : r.bottom + gap
      setPos({ left, top, above })
    }

    place()
    const frame = window.requestAnimationFrame(place)
    window.addEventListener("scroll", place, true)
    window.addEventListener("resize", place)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("scroll", place, true)
      window.removeEventListener("resize", place)
    }
  }, [open, action.tip, disabledReason])

  const openTip = () => setOpen(true)
  const closeTip = () => setOpen(false)

  const tipBody = disabled && disabledReason ? disabledReason : action.tip

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Escape") closeTip()
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      if (!disabled) onActivate(action)
    }
  }

  const tooltip =
    open && mounted && pos
      ? createPortal(
          <span
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className={`aqua-term-tip aqua-term-tip--portal aqua-chip-tip ${
              pos.above ? "aqua-term-tip--above" : "aqua-term-tip--below"
            }`}
            style={{
              left: pos.left,
              top: pos.top,
              transform: pos.above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
              backgroundColor: "#01070c",
              opacity: 1,
            }}
          >
            <strong className="aqua-term-tip-label">{action.label}</strong>
            <span className="aqua-term-tip-body">{tipBody}</span>
          </span>,
          document.body,
        )
      : null

  const className = `aqua-chip ${pulse ? "aqua-chip--pulse" : ""} ${armed ? "aqua-chip--armed" : ""} ${
    disabled ? "aqua-chip--locked" : ""
  }`

  return (
    <span
      ref={wrapRef}
      className={`aqua-chip-wrap ${pulse ? "aqua-chip-wrap--trail" : ""}`}
      onMouseEnter={openTip}
      onMouseLeave={closeTip}
    >
      {action.href ? (
        <Link
          href={action.href}
          className={className}
          aria-label={action.label}
          aria-describedby={open ? tipId : undefined}
          onFocus={openTip}
          onBlur={closeTip}
        >
          {action.label}
        </Link>
      ) : (
        <button
          type="button"
          className={className}
          aria-label={disabled && disabledReason ? `${action.label}: ${disabledReason}` : action.label}
          aria-describedby={open ? tipId : undefined}
          aria-expanded={open}
          aria-disabled={disabled || undefined}
          disabled={disabled}
          onClick={() => {
            if (!disabled) onActivate(action)
          }}
          onFocus={openTip}
          onBlur={closeTip}
          onKeyDown={handleKeyDown}
        >
          {action.label}
        </button>
      )}
      {tooltip}
    </span>
  )
}
