import type { SVGProps } from 'react'

/** After Effects-style pick whip: drag from the spiral tail to a source property. */
export function PickWhipIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" {...props}>
      <path
        d="M21 12h-3.25a6.75 6.75 0 1 0-6.75 6.75 5.25 5.25 0 1 0 0-10.5 3.75 3.75 0 1 0 3.75 3.75A2.25 2.25 0 1 0 12.5 14.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  )
}
