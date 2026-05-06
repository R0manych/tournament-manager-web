import type { BracketRoundData, BracketMatchData } from './bracketUtils'

// Fixed geometry constants
const SLOT_H = 34   // height of one participant slot (px)
const MATCH_H = SLOT_H * 2 + 2  // 70px: two slots + divider
const GAP = 20      // gap between matches within a round (px)
const UNIT = MATCH_H + GAP      // 90px: space each first-round match occupies
const CONNECTOR_W = 24          // width of the connecting column (px)
const ROUND_W = 180             // width of each round column (px)

function matchWrapperHeight(roundIndex: number) {
  return UNIT * Math.pow(2, roundIndex) - GAP
}

function matchTopOffset(roundIndex: number) {
  return (UNIT * Math.pow(2, roundIndex) - MATCH_H) / 2
}

interface MatchBoxProps {
  match: BracketMatchData
  roundIndex: number
}

function MatchBox({ match, roundIndex }: MatchBoxProps) {
  const wrapH = matchWrapperHeight(roundIndex)
  const topOff = matchTopOffset(roundIndex)

  return (
    <div style={{
      height: wrapH,
      position: 'relative',
      flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute',
        top: topOff,
        left: 0,
        right: 0,
        height: MATCH_H,
        border: '1px solid #ccc',
        borderRadius: 4,
        overflow: 'hidden',
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
      }}>
        <Slot label={match.top.label} sublabel={match.top.sublabel} />
        <div style={{ height: 1, background: '#e8e8e8' }} />
        <Slot label={match.bottom.label} sublabel={match.bottom.sublabel} />
      </div>
    </div>
  )
}

function Slot({ label, sublabel }: { label: string; sublabel?: string }) {
  return (
    <div style={{
      height: SLOT_H,
      display: 'flex',
      alignItems: 'center',
      padding: '0 10px',
      gap: 6,
      fontSize: 13,
    }}>
      <span style={{ flexGrow: 1, color: '#1a1a1a' }}>{label}</span>
      {sublabel && <span style={{ color: '#999', fontSize: 11, whiteSpace: 'nowrap' }}>{sublabel}</span>}
    </div>
  )
}

// Connector column between round r and round r+1.
// Draws pairs of "]"-shaped connectors (vertical bar + two horizontal stubs).
function ConnectorColumn({ fromRoundIndex, matchCount }: { fromRoundIndex: number; matchCount: number }) {
  // matchCount = number of matches in round r (we connect pairs → matchCount/2 connectors)
  const pairCount = Math.ceil(matchCount / 2)
  const pairH = UNIT * Math.pow(2, fromRoundIndex + 1)   // height of one pair
  const halfH = pairH / 2                                  // center of top / bottom match

  return (
    <div style={{ width: CONNECTOR_W, flexShrink: 0, position: 'relative' }}>
      {Array.from({ length: pairCount }, (_, i) => {
        const pairTop = i * pairH
        const centerTop = pairTop + halfH / 2 + (MATCH_H / 2) - matchTopOffset(fromRoundIndex)
        const centerBottom = pairTop + pairH - halfH / 2 - (MATCH_H / 2) + matchTopOffset(fromRoundIndex)
        const lineTop = matchTopOffset(fromRoundIndex) + SLOT_H + pairTop   // center of top match
        const lineBottom = pairTop + halfH + matchTopOffset(fromRoundIndex) + SLOT_H  // center of bottom match

        return (
          <svg
            key={i}
            style={{ position: 'absolute', top: pairTop, left: 0, overflow: 'visible' }}
            width={CONNECTOR_W}
            height={pairH}
          >
            {/* Horizontal stub from top match center-right */}
            <line
              x1={0} y1={lineTop}
              x2={CONNECTOR_W / 2} y2={lineTop}
              stroke="#bbb" strokeWidth={1.5}
            />
            {/* Horizontal stub from bottom match center-right */}
            <line
              x1={0} y1={lineBottom}
              x2={CONNECTOR_W / 2} y2={lineBottom}
              stroke="#bbb" strokeWidth={1.5}
            />
            {/* Vertical bar connecting two stubs */}
            <line
              x1={CONNECTOR_W / 2} y1={lineTop}
              x2={CONNECTOR_W / 2} y2={lineBottom}
              stroke="#bbb" strokeWidth={1.5}
            />
            {/* Horizontal line going right to next round */}
            <line
              x1={CONNECTOR_W / 2} y1={(lineTop + lineBottom) / 2}
              x2={CONNECTOR_W} y2={(lineTop + lineBottom) / 2}
              stroke="#bbb" strokeWidth={1.5}
            />
          </svg>
        )
      })}
    </div>
  )
}

interface Props {
  name: string
  rounds: BracketRoundData[]
  thirdPlaceMatch?: boolean
}

export default function SingleEliminationView({ name, rounds, thirdPlaceMatch }: Props) {
  if (rounds.length === 0) return null

  const totalHeight = UNIT * rounds[0].matches.length - GAP

  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{ marginBottom: 12, color: '#444' }}>{name}</h3>
      <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', minWidth: 'max-content' }}>
          {rounds.map((round, ri) => (
            <div key={ri} style={{ display: 'flex', alignItems: 'flex-start' }}>
              {/* Round column */}
              <div style={{ width: ROUND_W, flexShrink: 0 }}>
                {/* Round header */}
                <div style={{
                  textAlign: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#4a6fa5',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 8,
                  padding: '4px 0',
                  borderBottom: '2px solid #4a6fa5',
                }}>
                  {round.name}
                </div>

                {/* Matches */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {round.matches.map((match, mi) => (
                    <MatchBox key={mi} match={match} roundIndex={ri} />
                  ))}
                </div>
              </div>

              {/* Connector to next round */}
              {ri < rounds.length - 1 && (
                <div style={{ marginTop: 32 /* account for header height */ }}>
                  <ConnectorColumn fromRoundIndex={ri} matchCount={round.matches.length} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {thirdPlaceMatch && (
        <div style={{ marginTop: 16, fontSize: 13, color: '#888' }}>
          * Матч за 3-е место предусмотрен
        </div>
      )}
    </div>
  )
}
