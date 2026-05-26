import type { TournamentParticipant } from '../../api/types'
import type { DEPhase } from './bracketUtils'
import { buildUBRounds, buildLBRounds } from './bracketUtils'
import LowerBracketView from './LowerBracketView'

interface Props {
  name: string
  phase: DEPhase
  participants?: TournamentParticipant[]
  ubPairs?: ([string | null, string | null])[][]
  lbPairs?: ([string | null, string | null])[][]
}

export default function DoubleEliminationView({ name, phase, participants, ubPairs, lbPairs }: Props) {
  const ubRounds = buildUBRounds(phase, ubPairs, participants)
  const lbRounds = buildLBRounds(phase, lbPairs, participants)

  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{ marginBottom: 4, color: '#444' }}>{name}</h3>
      <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
        Double elimination ·{' '}
        {phase.grandFinal === 'reset'
          ? 'Большой финал с bracket reset'
          : phase.grandFinal === 'advantage'
          ? 'Большой финал — серия до 2 побед, upper стартует 1:0'
          : 'Большой финал (один матч)'}
      </p>

      {/* Upper Bracket */}
      <div style={{ marginBottom: 24 }}>
        <div style={{
          display: 'inline-block',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#fff',
          background: '#4a6fa5',
          borderRadius: 4,
          padding: '3px 10px',
          marginBottom: 10,
        }}>
          Верхняя сетка
        </div>
        <LowerBracketView rounds={ubRounds} />
      </div>

      {/* Lower Bracket */}
      <div style={{ marginBottom: 24 }}>
        <div style={{
          display: 'inline-block',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#fff',
          background: '#b45309',
          borderRadius: 4,
          padding: '3px 10px',
          marginBottom: 10,
        }}>
          Нижняя сетка
        </div>
        <LowerBracketView rounds={lbRounds} />
      </div>

      {/* Grand Final */}
      <div>
        <div style={{
          display: 'inline-block',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#fff',
          background: '#7c3aed',
          borderRadius: 4,
          padding: '3px 10px',
          marginBottom: 10,
        }}>
          Большой финал
        </div>
        <div style={{
          border: '2px solid #7c3aed',
          borderRadius: 6,
          overflow: 'hidden',
          width: 220,
          background: '#fff',
          boxShadow: '0 2px 8px rgba(124,58,237,0.15)',
        }}>
          <GrandFinalSlot label="Победитель UB" color="#4a6fa5" />
          <div style={{ height: 1, background: '#e8e8e8' }} />
          <GrandFinalSlot label="Победитель LB" color="#b45309" />
        </div>
        {(phase.grandFinal === 'reset' || phase.grandFinal === 'advantage') && (
          <p style={{ fontSize: 12, color: '#7c3aed', marginTop: 6 }}>
            {phase.grandFinal === 'reset'
              ? '* При победе представителя нижней сетки — второй матч (bracket reset, счёт 0:0)'
              : '* При победе представителя нижней сетки — второй матч (счёт 1:1, победитель второго — чемпион)'}
          </p>
        )}
      </div>
    </div>
  )
}

function GrandFinalSlot({ label, color }: { label: string; color: string }) {
  return (
    <div style={{
      height: 40,
      display: 'flex',
      alignItems: 'center',
      padding: '0 14px',
      gap: 8,
      fontSize: 14,
      fontWeight: 500,
    }}>
      <span style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }} />
      {label}
    </div>
  )
}
