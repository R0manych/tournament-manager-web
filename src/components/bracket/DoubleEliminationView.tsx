import type { DEPhase } from './bracketUtils'
import { buildUBRounds, buildLBRounds } from './bracketUtils'
import SingleEliminationView from './SingleEliminationView'
import LowerBracketView from './LowerBracketView'

interface Props {
  name: string
  phase: DEPhase
}

export default function DoubleEliminationView({ name, phase }: Props) {
  const ubRounds = buildUBRounds(phase)
  const lbRounds = buildLBRounds(phase)

  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{ marginBottom: 4, color: '#444' }}>{name}</h3>
      <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
        Double elimination ·{' '}
        {phase.grandFinal === 'reset' ? 'Большой финал с bracket reset' : 'Большой финал (один матч)'}
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
        <SingleEliminationView
          name=""
          rounds={ubRounds}
          thirdPlaceMatch={false}
        />
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
        {phase.grandFinal === 'reset' && (
          <p style={{ fontSize: 12, color: '#7c3aed', marginTop: 6 }}>
            * При победе представителя нижней сетки — второй матч (bracket reset)
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
