"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { formulaFor, glossaryById, tipFor } from "~~/lib/jarvis/glossary"

type Props = {
  /** Glossary id from AQUA_GLOSSARY */
  id: string
  children?: ReactNode
  className?: string
}

type TipPos = {
  left: number
  top: number
  /** Place tip above the trigger (preferred). */
  above: boolean
}

/**
 * Underlined jargon with a plain-language tip portaled above the chat / HUD
 * so overflow parents never clip it.
 */
export const AquaTerm = ({ id, children, className = "" }: Props) => {
  const entry = glossaryById[id]
  const tip = tipFor(id)
  const formula = formulaFor(id)
  const tipId = useId()
  const btnRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<TipPos | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setPos(null)
      return
    }

    const place = () => {
      const btn = btnRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const tipEl = tipRef.current
      const tipH = tipEl?.offsetHeight ?? 72
      const tipW = tipEl?.offsetWidth ?? 220
      const gap = 10
      const spaceAbove = r.top
      const above = spaceAbove >= tipH + gap + 8
      let left = r.left + r.width / 2
      left = Math.max(tipW / 2 + 8, Math.min(left, window.innerWidth - tipW / 2 - 8))
      const top = above ? r.top - gap : r.bottom + gap
      setPos({ left, top, above })
    }

    place()
    // Re-measure after tip mounts for accurate height
    const id = window.requestAnimationFrame(place)
    window.addEventListener("scroll", place, true)
    window.addEventListener("resize", place)
    return () => {
      window.cancelAnimationFrame(id)
      window.removeEventListener("scroll", place, true)
      window.removeEventListener("resize", place)
    }
  }, [open, tip, formula])

  if (!entry || !tip) {
    return <span className={className}>{children ?? id}</span>
  }

  const ariaTip = formula ? `${tip} Formula: ${formula}` : tip

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Escape") setOpen(false)
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      setOpen(v => !v)
    }
  }

  const tooltip =
    open && mounted && pos
      ? createPortal(
          <span
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className={`aqua-term-tip aqua-term-tip--portal ${pos.above ? "aqua-term-tip--above" : "aqua-term-tip--below"}`}
            style={{
              left: pos.left,
              top: pos.top,
              transform: pos.above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
              backgroundColor: "#01070c",
              opacity: 1,
            }}
          >
            <strong className="aqua-term-tip-label">{entry.label}</strong>
            <span className="aqua-term-tip-body">{tip}</span>
            {formula ? <code className="aqua-term-tip-formula">{formula}</code> : null}
          </span>,
          document.body,
        )
      : null

  return (
    <span className={`aqua-term-wrap ${className}`.trim()}>
      <button
        ref={btnRef}
        type="button"
        className="aqua-term"
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        aria-label={`${entry.label}: ${ariaTip}`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      >
        {children ?? entry.label}
      </button>
      {tooltip}
    </span>
  )
}
