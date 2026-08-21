// Группы для зала: кто в какой группе и — как только пошли результаты —
// положение в ней. Составы и таблицы берутся тем же `buildPhaseStandingsCache`,
// что питает сетку у организатора: два независимых расчёта разошлись бы.

import type { MatchPlacement, TournamentFormat, TournamentParticipant } from '../../api/types'
import { participantName } from '../../api/types'
import type { TournamentGroup } from '../../api/groups'
import type { GroupStanding, StandingsMatch } from '../bracket/bracketUtils'
import { buildPhaseStandingsCache } from '../bracket/bracketUtils'
import { MUTED } from './boardStyle'
import { BoardNotice, FitBox } from './BoardFrame'

const MAX_COLUMNS = 4

export interface GroupsBoardProps {
  format: TournamentFormat | undefined
  participants: TournamentParticipant[]
  standingsSource: StandingsMatch[] | undefined
  placements: MatchPlacement[] | undefined
  savedGroups: TournamentGroup[] | undefined
}

export default function GroupsBoard({
  format, participants, standingsSource, placements, savedGroups,
}: GroupsBoardProps) {
  if (!format) return <BoardNotice text="Формат турнира не загружен" />

  const rrPhases = format.phases.filter(p => p.type === 'roundRobin')
  if (rrPhases.length === 0) return <BoardNotice text="В этом формате нет группового этапа" />

  const cache = buildPhaseStandingsCache(format, participants, standingsSource, placements, savedGroups)
  const nameOf = new Map(participants.map(p => [p.participantId, participantName(p)]))

  const refit = `${format.name}:${participants.length}:${standingsSource?.length ?? 0}`

  return (
    <FitBox refit={refit}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3vh' }}>
        {rrPhases.map(phase => {
          const cached = cache.get(phase.id)
          if (!cached) return null
          const columns = Math.min(MAX_COLUMNS, cached.assignments.length) || 1

          return (
            <div key={phase.id}>
              {rrPhases.length > 1 && (
                <div style={{ fontSize: '2.4vh', color: MUTED, marginBottom: '1.2vh', letterSpacing: 1 }}>
                  {phase.name}
                </div>
              )}
              {/* `max-content`, а не `auto`: колонка обязана быть шириной со
                  своё содержимое. `auto` разрешает сжатие, и длинные фамилии
                  наезжают на соседнюю группу — вписывать целиком это дело
                  `FitBox`, а не сетки. */}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, max-content)`, gap: '2.5vh 2vw' }}>
                {cached.assignments.map((group, gi) => (
                  <GroupCard
                    key={group.groupLabel}
                    label={group.groupLabel}
                    memberIds={group.participants.map(p => p.fighterId)}
                    standings={cached.standings[gi] ?? []}
                    nameOf={nameOf}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </FitBox>
  )
}

function GroupCard({
  label,
  memberIds,
  standings,
  nameOf,
}: {
  label: string
  memberIds: string[]
  standings: GroupStanding[]
  nameOf: Map<string, string>
}) {
  // Пока в группе не сыграно ни одной встречи, таблица — это нули, а её
  // сортировка по очкам ломает объявленный посев. До первого результата
  // показываем состав как есть и без цифр.
  const played = standings.some(s => s.wins + s.draws + s.losses > 0)
  const rows = played
    ? standings.map(s => ({ id: s.fighterId, standing: s }))
    : memberIds.map(id => ({ id, standing: undefined as GroupStanding | undefined }))

  return (
    // Размеры внутри карточки — в `em`, то есть от её собственного шрифта.
    // С `vw` на широком мониторе карточка растягивалась бы, а текст в ней нет:
    // ширина окна и высота, по которой считается кегль, между собой не связаны.
    <div style={{
      fontSize: '2.4vh',
      border: '1px solid #1c2130',
      borderRadius: '0.4em',
      padding: '0.6em 0.9em',
      minWidth: '9em',
    }}>
      <div style={{ fontSize: '1.1em', fontWeight: 800, marginBottom: '0.4em', color: '#6ea8ff' }}>
        Группа {label}
      </div>

      {rows.length === 0 ? (
        <div style={{ color: MUTED }}>состав не задан</div>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          {played && (
            <thead>
              <tr style={{ color: '#4b5265', fontSize: '0.75em' }}>
                <th style={{ ...TH, textAlign: 'left' }} />
                <th style={TH}>В</th>
                <th style={TH}>П</th>
                <th style={TH}>Оч</th>
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id}>
                <td style={{ ...TD, whiteSpace: 'nowrap', fontWeight: 700, paddingRight: '1em' }}>
                  <span style={{ color: '#4b5265', marginRight: '0.5em' }}>{i + 1}</span>
                  {nameOf.get(row.id) ?? '—'}
                </td>
                {row.standing && (
                  <>
                    <td style={{ ...TD, ...NUM }}>{row.standing.wins}</td>
                    <td style={{ ...TD, ...NUM }}>{row.standing.losses}</td>
                    <td style={{ ...TD, ...NUM, fontWeight: 800 }}>{row.standing.points}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const TH: React.CSSProperties = { padding: '0 0.4em', fontWeight: 600, textAlign: 'center' }
const TD: React.CSSProperties = { padding: '0.15em 0' }
const NUM: React.CSSProperties = {
  textAlign: 'center',
  padding: '0.15em 0.4em',
  fontVariantNumeric: 'tabular-nums',
}
