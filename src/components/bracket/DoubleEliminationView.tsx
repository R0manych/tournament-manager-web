import type { Match, TournamentParticipant } from '../../api/types'
import { participantName } from '../../api/types'
import type { DEPhase, GrandFinalSeries } from './bracketUtils'
import { buildUBRounds, buildLBRounds } from './bracketUtils'
import LowerBracketView from './LowerBracketView'

const UB_COLOR = '#4a6fa5'
const LB_COLOR = '#b45309'
const GF_COLOR = '#7c3aed'

interface Props {
  name: string
  phase: DEPhase
  participants?: TournamentParticipant[]
  ubPairs?: ([string | null, string | null])[][]
  lbPairs?: ([string | null, string | null])[][]
  // Серия гранд-финала (АР-15): пара, счёт и чемпион считаются в bracketUtils,
  // здесь только подписи. Отсутствует, пока встречи турнира не загружены.
  grandFinal?: GrandFinalSeries<Match>
}

export default function DoubleEliminationView({
  name, phase, participants, ubPairs, lbPairs, grandFinal,
}: Props) {
  const ubRounds = buildUBRounds(phase, ubPairs, participants)
  const lbRounds = buildLBRounds(phase, lbPairs, participants)

  const isSeries = phase.grandFinal === 'reset' || phase.grandFinal === 'advantage'
  const nameOf = (fid: string | null | undefined): string | null => {
    if (!fid || !participants) return null
    const p = participants.find(x => x.participantId === fid)
    return p ? participantName(p) : null
  }

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
        <BracketBadge color={UB_COLOR}>Верхняя сетка</BracketBadge>
        <LowerBracketView rounds={ubRounds} />
      </div>

      {/* Lower Bracket */}
      <div style={{ marginBottom: 24 }}>
        <BracketBadge color={LB_COLOR}>Нижняя сетка</BracketBadge>
        <LowerBracketView rounds={lbRounds} />
      </div>

      {/* Grand Final */}
      <div>
        <BracketBadge color={GF_COLOR}>Большой финал</BracketBadge>

        {/* Счёт серии показывает `advantage`; `reset` вместо него подписывает
            матчи («Гранд-финал» / «Матч-сброс») — граф встреч у них общий. */}
        {phase.grandFinal === 'advantage' && grandFinal && grandFinal.state !== 'waiting' && (
          <div style={{ fontSize: 13, color: GF_COLOR, marginBottom: 8 }}>
            Счёт серии <strong>{grandFinal.score[0]}:{grandFinal.score[1]}</strong>
            {' '}({nameOf(grandFinal.ubWinnerId) ?? 'победитель UB'} — {nameOf(grandFinal.lbWinnerId) ?? 'победитель LB'})
          </div>
        )}

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <GrandFinalBox
            title={isSeries ? 'Матч 1 · Гранд-финал' : 'Гранд-финал'}
            match={grandFinal?.gf}
            ubId={grandFinal?.ubWinnerId ?? null}
            lbId={grandFinal?.lbWinnerId ?? null}
            nameOf={nameOf}
          />
          {isSeries && (
            <GrandFinalBox
              title="Матч 2 · Матч-сброс"
              match={grandFinal?.reset}
              ubId={grandFinal?.ubWinnerId ?? null}
              lbId={grandFinal?.lbWinnerId ?? null}
              nameOf={nameOf}
              // Второй матч играется, только если первый выиграл представитель
              // нижней сетки (инвариант 39) — до этого ячейка условная.
              dimmed={!grandFinal?.reset && !grandFinal?.resetRequired}
              note={
                grandFinal?.reset ? undefined
                : grandFinal?.resetRequired ? 'Нужен по результату первого матча — сгенерируйте раунд'
                : 'Только при победе представителя нижней сетки'
              }
            />
          )}
        </div>

        {grandFinal?.championId && (
          <p style={{ fontSize: 14, color: GF_COLOR, marginTop: 10, fontWeight: 600 }}>
            🏆 Чемпион: {nameOf(grandFinal.championId) ?? '—'}
          </p>
        )}

        {isSeries && !grandFinal?.championId && (
          <p style={{ fontSize: 12, color: GF_COLOR, marginTop: 6 }}>
            {phase.grandFinal === 'reset'
              ? '* При победе представителя нижней сетки — второй матч (bracket reset, счёт 0:0)'
              : '* Победителю верхней сетки достаточно одной победы, победитель нижней обязан выиграть оба матча'}
          </p>
        )}
      </div>
    </div>
  )
}

function BracketBadge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'inline-block',
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: '#fff',
      background: color,
      borderRadius: 4,
      padding: '3px 10px',
      marginBottom: 10,
    }}>
      {children}
    </div>
  )
}

// Одна встреча гранд-финала. Верхний слот — всегда представитель верхней сетки:
// в том же порядке встреча и создаётся (`fighter1Id` = победитель UB).
function GrandFinalBox({ title, match, ubId, lbId, nameOf, dimmed, note }: {
  title: string
  match?: Match
  ubId: string | null
  lbId: string | null
  nameOf: (fid: string | null | undefined) => string | null
  dimmed?: boolean
  note?: string
}) {
  // При двойном поражении (АР-16) встреча тоже сыграна, но победителя у неё
  // нет: `winnerId` null, поэтому ни один слот не подсветится.
  const decided =
    match?.status === 'Completed' ||
    match?.status === 'WalkoverWin' ||
    match?.status === 'DoubleLoss'
  // Порядок слотов встречи совпадает с (UB, LB), но подстраховываемся: встречу
  // мог завести вручную кто угодно.
  const swapped = match != null && match.fighter1Id === lbId && match.fighter2Id === ubId
  const topScore = match ? (swapped ? match.score2 : match.score1) : null
  const botScore = match ? (swapped ? match.score1 : match.score2) : null

  return (
    <div style={{ opacity: dimmed ? 0.55 : 1 }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </div>
      <div style={{
        border: `2px ${dimmed ? 'dashed' : 'solid'} ${GF_COLOR}`,
        borderRadius: 6,
        overflow: 'hidden',
        width: 260,
        background: '#fff',
        boxShadow: dimmed ? 'none' : '0 2px 8px rgba(124,58,237,0.15)',
      }}>
        <GrandFinalSlot
          label={nameOf(ubId) ?? 'Победитель UB'}
          color={UB_COLOR}
          score={topScore}
          isWinner={decided && match?.winnerId != null && match.winnerId === ubId}
        />
        <div style={{ height: 1, background: '#e8e8e8' }} />
        <GrandFinalSlot
          label={nameOf(lbId) ?? 'Победитель LB'}
          color={LB_COLOR}
          score={botScore}
          isWinner={decided && match?.winnerId != null && match.winnerId === lbId}
        />
      </div>
      {note && <div style={{ fontSize: 11, color: '#888', marginTop: 4, width: 260 }}>{note}</div>}
    </div>
  )
}

function GrandFinalSlot({ label, color, score, isWinner }: {
  label: string
  color: string
  score?: number | null
  isWinner?: boolean
}) {
  return (
    <div style={{
      height: 40,
      display: 'flex',
      alignItems: 'center',
      padding: '0 14px',
      gap: 8,
      fontSize: 14,
      fontWeight: isWinner ? 700 : 500,
      background: isWinner ? '#f5f3ff' : 'transparent',
    }}>
      <span style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }} />
      <span style={{ flexGrow: 1 }}>{label}</span>
      {score != null && <span style={{ color: '#555', fontVariantNumeric: 'tabular-nums' }}>{score}</span>}
    </div>
  )
}
