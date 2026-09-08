'use client'

import type { FieldHint } from '@/lib/fieldGuide'

/**
 * Label + the house example for that field, on one line.
 *
 * The example sits beside the label rather than inside the input, because a
 * placeholder vanishes the moment you start typing — which is exactly when
 * you want to check you are matching the format everyone else used.
 */
export default function FieldLabel({
  htmlFor,
  children,
  required,
  hint,
}: {
  htmlFor?: string
  children: React.ReactNode
  required?: boolean
  hint?: FieldHint
}) {
  return (
    <label className="lbl lbl-row" htmlFor={htmlFor}>
      <span className="lbl-name">
        {children}
        {required && <span className="req"> *</span>}
        {hint?.help && (
          <span className="lbl-help" tabIndex={0} role="note" aria-label={hint.help}>
            ⓘ
            <span className="lbl-tip">{hint.help}</span>
          </span>
        )}
      </span>
      {hint?.example && <span className="lbl-eg">e.g. {hint.example}</span>}
    </label>
  )
}
