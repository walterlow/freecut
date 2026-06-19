import type { ReactNode, RefObject } from 'react'
import { cn } from '@/shared/ui/cn'
import { SCOPE_LUMA_GUIDES, VECTOR_SCOPE_TARGETS } from './color-scope-overlay-data'

type ScopeOverlayKind = 'waveform' | 'parade' | 'histogram' | 'vectorscope'

interface ScopeCanvasFrameProps {
  children: ReactNode
  className?: string
  containerRef: RefObject<HTMLDivElement | null>
  kind: ScopeOverlayKind
}

export function ScopeCanvasFrame({
  children,
  className,
  containerRef,
  kind,
}: ScopeCanvasFrameProps) {
  return (
    <div
      ref={containerRef}
      className={cn(
        'relative overflow-hidden rounded border border-border/70 bg-black/80',
        className,
      )}
    >
      {children}
      <ScopeOverlay kind={kind} />
    </div>
  )
}

function ScopeOverlay({ kind }: { kind: ScopeOverlayKind }) {
  if (kind === 'vectorscope') return <VectorScopeOverlay />
  return <LumaScopeOverlay parade={kind === 'parade'} histogram={kind === 'histogram'} />
}

function LumaScopeOverlay({ parade, histogram }: { parade: boolean; histogram: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {SCOPE_LUMA_GUIDES.map((level) => {
        const top = `${100 - level}%`
        return (
          <div
            key={level}
            className="absolute left-0 right-0 border-t border-slate-400/18"
            style={{ top }}
          >
            <span className="absolute left-1 -translate-y-1/2 rounded-sm bg-black/45 px-1 font-mono text-[9px] leading-4 text-slate-300/80">
              {level}
            </span>
          </div>
        )
      })}
      {histogram ? (
        <>
          <div className="absolute bottom-1 left-1 font-mono text-[9px] text-slate-400/80">0</div>
          <div className="absolute bottom-1 right-1 font-mono text-[9px] text-slate-400/80">
            255
          </div>
        </>
      ) : null}
      {parade ? <ParadeOverlay /> : null}
    </div>
  )
}

function ParadeOverlay() {
  return (
    <>
      {[1, 2].map((index) => (
        <div
          key={index}
          className="absolute top-0 bottom-0 border-l border-slate-400/25"
          style={{ left: `${(index / 3) * 100}%` }}
        />
      ))}
      {[
        ['R', '16.666%', 'text-red-300/90'],
        ['G', '50%', 'text-emerald-300/90'],
        ['B', '83.333%', 'text-blue-300/90'],
      ].map(([label, left, color]) => (
        <span
          key={label}
          className={cn(
            'absolute top-1 -translate-x-1/2 rounded-sm bg-black/45 px-1 font-mono text-[10px] leading-4',
            color,
          )}
          style={{ left }}
        >
          {label}
        </span>
      ))}
    </>
  )
}

function VectorScopeOverlay() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      viewBox="0 0 100 100"
    >
      <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(148,163,184,0.24)" />
      <circle cx="50" cy="50" r="30" fill="none" stroke="rgba(148,163,184,0.18)" />
      <circle cx="50" cy="50" r="15" fill="none" stroke="rgba(148,163,184,0.12)" />
      <path d="M50 5 V95 M5 50 H95" stroke="rgba(148,163,184,0.2)" strokeWidth="0.8" />
      <path d="M50 50 L36 15" stroke="rgba(251,191,36,0.72)" strokeWidth="1.2" />
      <text x="35" y="12" fill="rgba(251,191,36,0.9)" fontSize="4" fontFamily="monospace">
        skin
      </text>
      {VECTOR_SCOPE_TARGETS.map((target) => (
        <g key={target.label}>
          <rect
            x={target.x - 3}
            y={target.y - 3}
            width="6"
            height="6"
            fill="none"
            stroke="rgba(226,232,240,0.34)"
            strokeWidth="0.8"
          />
          <text
            x={target.x}
            y={target.y - 4.5}
            fill="rgba(226,232,240,0.78)"
            fontSize="4"
            fontFamily="monospace"
            textAnchor="middle"
          >
            {target.label}
          </text>
        </g>
      ))}
    </svg>
  )
}
