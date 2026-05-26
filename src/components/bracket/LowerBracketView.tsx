import type { ReactElement } from 'react'
import type { DEBracketRound, BracketMatchData, BracketSlot } from './bracketUtils'

const SLOT_H = 34
const MATCH_H = SLOT_H * 2 + 2   // 70px
const GAP = 20
const UNIT = MATCH_H + GAP        // 90px per match
const CONNECTOR_W = 24
const ROUND_W = 180

// totalH = maxMatches * UNIT so that pairH = 2 * UNIT * 2^k = 2 * matchWrapperHeight,
// guaranteeing connector midpoints coincide with destination match centers.
function totalLBHeight(rounds: DEBracketRound[]): number {
  const maxMatches = Math.max(...rounds.map(r => r.matches.length))
  return maxMatches * UNIT
}

// Centers matches evenly using the formula: center(i,n) = totalH*(2i+1)/(2n).
// This ensures (center(2i) + center(2i+1))/2 == center(i, n/2),
// so BranchingConnector exits align exactly with the next round's match centers.
function matchCenter(matchIndex: number, matchCount: number, totalH: number): number {
  return totalH * (2 * matchIndex + 1) / (2 * matchCount)
}

function matchTopOffset(matchIndex: number, matchCount: number, totalH: number): number {
  return matchCenter(matchIndex, matchCount, totalH) - MATCH_H / 2
}

function Slot({ slot }: { slot: BracketSlot }) {
  const bg = slot.isDropdown ? '#fff8e1' : slot.isBye ? '#f0fff4' : 'transparent'
  const textColor = slot.isDropdown ? '#b45309' : slot.isBye ? '#065f46' : '#1a1a1a'
  return (
    <div style={{
      height: SLOT_H,
      display: 'flex',
      alignItems: 'center',
      padding: '0 8px',
      gap: 4,
      fontSize: 13,
      background: bg,
    }}>
      {slot.isDropdown && <span style={{ color: '#f59e0b', fontSize: 11 }}>▼</span>}
      {slot.isBye && <span style={{ color: '#059669', fontSize: 11 }}>↑</span>}
      <span style={{ flexGrow: 1, color: textColor }}>{slot.label}</span>
      {slot.sublabel && <span style={{ color: '#999', fontSize: 11 }}>{slot.sublabel}</span>}
    </div>
  )
}

function MatchBox({ match, top }: { match: BracketMatchData; top: number }) {
  return (
    <div style={{
      position: 'absolute',
      top,
      left: 0,
      right: 0,
      height: MATCH_H,
      border: '1px solid #ccc',
      borderRadius: 4,
      overflow: 'hidden',
      background: '#fff',
      boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
    }}>
      <Slot slot={match.top} />
      <div style={{ height: 1, background: '#e8e8e8' }} />
      <Slot slot={match.bottom} />
    </div>
  )
}

// Прямой коннектор: one-to-one (число матчей не меняется)
function StraightConnector({ matchCount, totalH }: { matchCount: number; totalH: number }) {
  const lines: ReactElement[] = []
  for (let i = 0; i < matchCount; i++) {
    const y = matchCenter(i, matchCount, totalH)
    lines.push(
      <line key={i} x1={0} y1={y} x2={CONNECTOR_W} y2={y} stroke="#bbb" strokeWidth={1.5} />
    )
  }
  return (
    <svg width={CONNECTOR_W} height={totalH} style={{ flexShrink: 0, display: 'block' }}>
      {lines}
    </svg>
  )
}

// Ветвящийся коннектор: two-to-one (число матчей уменьшается вдвое).
// yMid = (yTop + yBot) / 2 = matchCenter(i, toCount) по свойству формулы matchCenter.
function BranchingConnector({ fromCount, toCount, totalH }: {
  fromCount: number; toCount: number; totalH: number
}) {
  const pairs: ReactElement[] = []
  for (let i = 0; i < toCount; i++) {
    const yTop = matchCenter(i * 2,     fromCount, totalH)
    const yBot = matchCenter(i * 2 + 1, fromCount, totalH)
    const yMid = matchCenter(i,         toCount,   totalH)  // == (yTop + yBot) / 2
    const cx = CONNECTOR_W / 2
    pairs.push(
      <g key={i}>
        <line x1={0}  y1={yTop} x2={cx}          y2={yTop} stroke="#bbb" strokeWidth={1.5} />
        <line x1={0}  y1={yBot} x2={cx}          y2={yBot} stroke="#bbb" strokeWidth={1.5} />
        <line x1={cx} y1={yTop} x2={cx}          y2={yBot} stroke="#bbb" strokeWidth={1.5} />
        <line x1={cx} y1={yMid} x2={CONNECTOR_W} y2={yMid} stroke="#bbb" strokeWidth={1.5} />
      </g>
    )
  }
  return (
    <svg width={CONNECTOR_W} height={totalH} style={{ flexShrink: 0, display: 'block' }}>
      {pairs}
    </svg>
  )
}

interface Props {
  rounds: DEBracketRound[]
}

export default function LowerBracketView({ rounds }: Props) {
  if (rounds.length === 0) return null
  const totalH = totalLBHeight(rounds)

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: 'max-content' }}>
        {rounds.map((round, ri) => {
          const nextRound = rounds[ri + 1]
          const sameCount = nextRound && nextRound.matches.length === round.matches.length
          const halving = nextRound && nextRound.matches.length < round.matches.length

          return (
            <div key={ri} style={{ display: 'flex', alignItems: 'flex-start' }}>
              {/* Round column */}
              <div style={{ width: ROUND_W, flexShrink: 0 }}>
                {/* Header */}
                <div style={{
                  textAlign: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                  color: round.isDropout ? '#b45309' : '#4a6fa5',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 4,
                  padding: '4px 0',
                  borderBottom: `2px solid ${round.isDropout ? '#f59e0b' : '#4a6fa5'}`,
                }}>
                  {round.name}
                </div>
                {round.isDropout && (
                  <div style={{ fontSize: 11, color: '#b45309', textAlign: 'center', marginBottom: 6 }}>
                    ↓ из {round.dropFromRoundName}
                  </div>
                )}

                {/* Matches */}
                <div style={{ position: 'relative', height: totalH }}>
                  {round.matches.map((match, mi) => (
                    <MatchBox
                      key={mi}
                      match={match}
                      top={matchTopOffset(mi, round.matches.length, totalH)}
                    />
                  ))}
                </div>
              </div>

              {/* Connector to next round */}
              {nextRound && (
                <div style={{ marginTop: 44 /* header height */ }}>
                  {sameCount && (
                    <StraightConnector matchCount={round.matches.length} totalH={totalH} />
                  )}
                  {halving && (
                    <BranchingConnector
                      fromCount={round.matches.length}
                      toCount={nextRound.matches.length}
                      totalH={totalH}
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
