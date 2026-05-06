import type { DEBracketRound, BracketMatchData, BracketSlot } from './bracketUtils'

const SLOT_H = 34
const MATCH_H = SLOT_H * 2 + 2   // 70px
const GAP = 20
const UNIT = MATCH_H + GAP        // 90px per match
const CONNECTOR_W = 24
const ROUND_W = 180

// Максимальное число матчей в первом раунде — задаёт общую высоту LB
function totalLBHeight(rounds: DEBracketRound[]): number {
  const maxMatches = Math.max(...rounds.map(r => r.matches.length))
  return maxMatches * UNIT - GAP
}

function matchTopOffset(matchIndex: number, matchCount: number, totalH: number): number {
  const used = matchCount * MATCH_H + (matchCount - 1) * GAP
  const startY = (totalH - used) / 2
  return startY + matchIndex * (MATCH_H + GAP)
}

function Slot({ slot }: { slot: BracketSlot }) {
  return (
    <div style={{
      height: SLOT_H,
      display: 'flex',
      alignItems: 'center',
      padding: '0 8px',
      gap: 4,
      fontSize: 13,
      background: slot.isDropdown ? '#fff8e1' : 'transparent',
    }}>
      {slot.isDropdown && <span style={{ color: '#f59e0b', fontSize: 11 }}>▼</span>}
      <span style={{ flexGrow: 1, color: slot.isDropdown ? '#b45309' : '#1a1a1a' }}>{slot.label}</span>
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

// Прямой коннектор: one-to-one (когда число матчей не меняется из-за дропов)
function StraightConnector({ matchCount, totalH }: { matchCount: number; totalH: number }) {
  const lines: JSX.Element[] = []
  for (let i = 0; i < matchCount; i++) {
    const y = matchTopOffset(i, matchCount, totalH) + MATCH_H / 2
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

// Ветвящийся коннектор: two-to-one (когда число матчей уменьшается вдвое)
function BranchingConnector({ fromCount, toCount, totalH }: {
  fromCount: number; toCount: number; totalH: number
}) {
  const pairs: JSX.Element[] = []
  for (let i = 0; i < toCount; i++) {
    const topMatchIdx = i * 2
    const botMatchIdx = i * 2 + 1
    const yTop = matchTopOffset(topMatchIdx, fromCount, totalH) + MATCH_H / 2
    const yBot = matchTopOffset(botMatchIdx, fromCount, totalH) + MATCH_H / 2
    const yMid = (yTop + yBot) / 2
    const cx = CONNECTOR_W / 2
    pairs.push(
      <g key={i}>
        <line x1={0} y1={yTop} x2={cx} y2={yTop} stroke="#bbb" strokeWidth={1.5} />
        <line x1={0} y1={yBot} x2={cx} y2={yBot} stroke="#bbb" strokeWidth={1.5} />
        <line x1={cx} y1={yTop} x2={cx} y2={yBot} stroke="#bbb" strokeWidth={1.5} />
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
