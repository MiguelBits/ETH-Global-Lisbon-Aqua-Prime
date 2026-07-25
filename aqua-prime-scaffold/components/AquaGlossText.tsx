"use client"

import { Fragment, type ReactNode } from "react"
import { AquaTerm } from "~~/components/AquaTerm"
import { GLOSSARY_ALIASES_SORTED } from "~~/lib/jarvis/glossary"

type Props = {
  text: string
  className?: string
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const aliasPattern = (alias: string): string => {
  const esc = escapeRe(alias)
  // Multi-word / hyphenated: match as-is. Single tokens: word boundary.
  if (/\s|-/.test(alias) || alias.length <= 2) return esc
  return `\\b${esc}\\b`
}

/**
 * Walk a sentence and wrap known desk jargon in hover tips.
 * Longer aliases win (e.g. "quote-heavy" before "quote").
 */
export const AquaGlossText = ({ text, className }: Props): ReactNode => {
  if (!text) return null

  const pattern = GLOSSARY_ALIASES_SORTED.map(a => aliasPattern(a.alias)).join("|")
  if (!pattern) return <span className={className}>{text}</span>

  const re = new RegExp(`(${pattern})`, "gi")
  const parts = text.split(re)

  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (!part) return null
        const hit = GLOSSARY_ALIASES_SORTED.find(a => a.alias.toLowerCase() === part.toLowerCase())
        if (!hit) {
          return <Fragment key={`${i}-${part.slice(0, 12)}`}>{part}</Fragment>
        }
        return (
          <AquaTerm key={`${i}-${hit.entry.id}`} id={hit.entry.id}>
            {part}
          </AquaTerm>
        )
      })}
    </span>
  )
}
