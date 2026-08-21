// Сетка плейофф для зала. Отдельный рендер, а не переиспользование
// `SingleEliminationView`/`DoubleEliminationView`: те свёрстаны под светлый
// экран администратора, рассчитаны на прокрутку и мелкий шрифт. Здесь всё
// наоборот — тёмный фон, крупные имена и обязательное «влезло целиком».
//
// Считать раскладку самостоятельно при этом нельзя: раунды, пары и резолв
// победителей берутся из тех же функций `bracketUtils`, что и у организатора.

import type { Match, MatchPlacement, TournamentFormat, TournamentParticipant } from '../../api/types'
import type { BracketRoundData, BracketSlot, DEPhase, StandingsMatch } from '../bracket/bracketUtils'
import {
  buildBracketRounds, buildLBRounds, buildPhaseStandingsCache, buildUBRounds,
  resolveDEFromCache, resolveSESlotIds,
} from '../bracket/bracketUtils'
import type { TournamentGroup } from '../../api/groups'
import { MUTED } from './boardStyle'
import { BoardNotice, FitBox } from './BoardFrame'

export interface BracketBoardProps {
  format: TournamentFormat | undefined
  participants: TournamentParticipant[]
  allMatches: Match[] | undefined
  standingsSource: StandingsMatch[] | undefined
  placements: MatchPlacement[] | undefined
  savedGroups: TournamentGroup[] | undefined
}

export default function BracketBoard({
  format, participants, allMatches, standingsSource, placements, savedGroups,
}: BracketBoardProps) {
  if (!format) return <BoardNotice text="Формат турнира не загружен" />

  const playoffPhases = format.phases.filter(
    p => p.type === 'singleElimination' || p.type === 'doubleElimination',
  )
  if (playoffPhases.length === 0) return <BoardNotice text="В этом формате нет плейофф" />

  const cache = buildPhaseStandingsCache(format, participants, standingsSource, placements, savedGroups)
  const refit = `${format.name}:${allMatches?.length ?? 0}:${playoffPhases.length}`

  return (
    <FitBox refit={refit}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3vh' }}>
        {playoffPhases.map(phase => {
          if (phase.type === 'singleElimination') {
            const se = phase as TournamentFormat['phases'][0] & { type: 'singleElimination' }
            const resolvedIds = resolveSESlotIds(se, cache, standingsSource, placements)
            const rounds = buildBracketRounds(se, resolvedIds, participants, standingsSource, placements)
            return (
              <Section key={phase.id} title={playoffPhases.length > 1 ? phase.name : undefined}>
                <RoundColumns rounds={rounds} />
              </Section>
            )
          }

          const de = phase as unknown as DEPhase
          const { ubPairs, lbPairs } = resolveDEFromCache(de, cache, allMatches, placements)
          const ub = buildUBRounds(de, ubPairs, participants)
          const lb = buildLBRounds(de, lbPairs, participants)
          return (
            <Section key={phase.id} title={playoffPhases.length > 1 ? phase.name : undefined}>
              {/* Две сетки одна под другой, как их и читают: сначала верхняя,
                  потом нижняя. Гранд-финал живёт в хвосте верхней. */}
              <SubTitle text="Верхняя сетка" />
              <RoundColumns rounds={ub} />
              <SubTitle text="Нижняя сетка" />
              <RoundColumns rounds={lb} />
            </Section>
          )
        })}
      </div>
    </FitBox>
  )
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div>
      {title && (
        <div style={{ fontSize: '2.4vh', color: MUTED, marginBottom: '1.2vh', letterSpacing: 1 }}>
          {title}
        </div>
      )}
      {children}
    </div>
  )
}

function SubTitle({ text }: { text: string }) {
  return (
    <div style={{ fontSize: '1.9vh', color: '#4b5265', margin: '1.2vh 0 0.6vh', letterSpacing: 1 }}>
      {text}
    </div>
  )
}

/**
 * Раунды колонками слева направо. Пары внутри колонки распределяются по высоте
 * равномерно, поэтому пара следующего раунда встаёт напротив промежутка между
 * своими предшественницами — коннекторы рисовать не нужно, связь читается
 * позицией. Линии из админской сетки здесь только съели бы контраст.
 */
function RoundColumns({ rounds }: { rounds: BracketRoundData[] }) {
  if (rounds.length === 0) return null
  return (
    // Размеры колонок — в `em` от кегля имён: ячейка обязана быть шириной со
    // своё содержимое, иначе длинные фамилии наезжают на соседний раунд.
    <div style={{ display: 'flex', alignItems: 'stretch', gap: '1.2em', fontSize: '2.2vh' }}>
      {rounds.map((round, ri) => (
        <div key={`${round.name}-${ri}`} style={{ display: 'flex', flexDirection: 'column', flex: '0 0 auto', minWidth: '8em' }}>
          <div style={{ fontSize: '0.85em', color: '#4b5265', letterSpacing: 1, marginBottom: '0.5em', whiteSpace: 'nowrap' }}>
            {round.name}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-around', gap: '0.5em' }}>
            {round.matches.map((m, mi) => (
              <div key={mi} style={{ border: '1px solid #1c2130', borderRadius: '0.3em', overflow: 'hidden' }}>
                <SlotRow slot={m.top} />
                <div style={{ height: 1, background: '#1c2130' }} />
                <SlotRow slot={m.bottom} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SlotRow({ slot }: { slot: BracketSlot }) {
  // Незанятый слот — это подпись вида «Группа A · место 1» либо «бай»: имени
  // ещё нет, и выдавать её за участника нельзя.
  const pending = slot.sublabel != null || slot.isBye
  return (
    <div
      style={{
        padding: '0.35em 0.5em',
        fontWeight: pending ? 500 : 700,
        color: slot.isBye ? '#4b5265' : pending ? MUTED : '#f5f7fa',
        whiteSpace: 'nowrap',
        display: 'flex',
        gap: '0.4em',
        alignItems: 'baseline',
      }}
    >
      <span>{slot.isBye ? 'бай' : slot.label}</span>
      {slot.sublabel && <span style={{ fontSize: '0.75em', color: '#4b5265' }}>{slot.sublabel}</span>}
    </div>
  )
}
