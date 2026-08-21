import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { encountersApi } from '../../api/encounters'
import { fightersApi } from '../../api/fighters'
import { matchesApi } from '../../api/matches'
import { teamsApi } from '../../api/teams'
import { tournamentsApi } from '../../api/tournaments'
import type { Encounter, Match, Team, Tournament } from '../../api/types'
import { participantName } from '../../api/types'
import { formatClock, formatCountdown, remainingSeconds, remainingUntil } from '../../lib/timer'
import { readTimerOffset, timerOffsetKey } from '../../lib/timerOffset'
import type { TimerOffset } from '../../lib/timerOffset'
import type { DisplayLink } from './useDisplayLink'
import { BLUE, RED, SCREEN, MUTED } from './boardStyle'

/** Сколько держать итог завершённого боя, прежде чем уйти в экран ожидания. */
const RESULT_HOLD_MS = 20_000

export default function MatchBoard({ matchId, link }: { matchId: string; link: DisplayLink }) {
  const { data: match, isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ['matches', matchId],
    queryFn: () => matchesApi.get(matchId),
    refetchInterval: q => (q.state.data?.status === 'InProgress' ? 2000 : false),
    refetchOnWindowFocus: true,
  })

  const { data: tournament } = useQuery({
    queryKey: ['tournaments', match?.tournamentId],
    queryFn: () => tournamentsApi.get(match!.tournamentId),
    enabled: !!match?.tournamentId,
  })

  const { data: f1 } = useQuery({
    queryKey: ['fighters', match?.fighter1Id],
    queryFn: () => fightersApi.get(match!.fighter1Id),
    enabled: !!match?.fighter1Id,
  })

  const { data: f2 } = useQuery({
    queryKey: ['fighters', match?.fighter2Id],
    queryFn: () => fightersApi.get(match!.fighter2Id!),
    enabled: !!match?.fighter2Id,
  })

  // Серия команды: агрегированный счёт, номер боя, приоритет в tie-break.
  const { data: encounter } = useQuery({
    queryKey: ['encounters', match?.encounterId],
    queryFn: () => encountersApi.get(match!.encounterId!),
    enabled: !!match?.encounterId,
    refetchInterval: q => (q.state.data?.status === 'InProgress' ? 2000 : false),
  })

  // Только ради «следующей пары»: список боёв турнира / составы команд.
  const { data: tournamentMatches } = useQuery({
    queryKey: ['tournament-matches', match?.tournamentId],
    queryFn: () => matchesApi.listByTournament(match!.tournamentId),
    enabled: !!match?.tournamentId && !match?.encounterId,
    refetchInterval: 10_000,
  })

  const { data: teams } = useQuery({
    queryKey: ['teams', match?.tournamentId],
    queryFn: () => teamsApi.listByTournament(match!.tournamentId),
    enabled: !!match?.tournamentId && !!match?.encounterId,
  })

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [])

  const anchorIso = match?.currentRoundStartedAt ?? match?.startedAt
  const anchorMs =
    match?.status === 'InProgress' && anchorIso ? new Date(anchorIso).getTime() : null

  // Фолбэк, когда пульт не отвечает: серверная производная плюс клиентский
  // сдвиг из localStorage (он общий для вкладок одного браузера — B-3).
  const [offset, setOffset] = useState<TimerOffset | null>(null)
  useEffect(() => {
    if (anchorMs == null) {
      setOffset(null)
      return
    }
    setOffset(readTimerOffset(matchId, anchorMs))
    const onStorage = (e: StorageEvent) => {
      if (e.key === timerOffsetKey(matchId)) setOffset(readTimerOffset(matchId, anchorMs))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [matchId, anchorMs])

  if (isLoading) return <Screen><div style={{ color: MUTED }}>Загрузка…</div></Screen>
  if (isError || !match) return <Screen><div style={{ color: MUTED }}>Бой не найден</div></Screen>

  const totalSeconds = match.effectiveRoundDurationSeconds ?? tournament?.defaultRoundDurationSeconds

  // Итог завершённого боя держим на экране, потом уходим в ожидание.
  const endedMs = match.endedAt ? new Date(match.endedAt).getTime() : null
  const isDoubleLoss = match.status === 'DoubleLoss'
  const isFinished = match.status === 'Completed' || match.status === 'WalkoverWin' || isDoubleLoss
  if (isFinished && endedMs != null && now - endedMs > RESULT_HOLD_MS) {
    return <WaitingBoard tournamentId={match.tournamentId} />
  }
  if (match.status === 'Cancelled') return <WaitingBoard tournamentId={match.tournamentId} />

  // Счёт от пульта приходит в момент схода, ответ поллинга — до двух секунд
  // спустя. Берём тот, что новее: запоздавший ответ API не должен «откатывать»
  // уже показанный счёт, а после ручной правки на сервере поллинг догонит сам.
  const pushed = link.scoreFor(matchId)
  const live = pushed && pushed.atMs > dataUpdatedAt ? pushed : match

  const isBye = match.fighter2Id == null
  const left = {
    first: f1?.firstName ?? '',
    last: f1?.lastName ?? '…',
    club: f1?.club,
    score: live.score1,
  }
  const right = {
    first: isBye ? '' : f2?.firstName ?? '',
    last: isBye ? 'БАЙ' : f2?.lastName ?? '…',
    club: isBye ? undefined : f2?.club,
    score: live.score2,
  }

  const winnerSide =
    !isFinished ? null
    : match.winnerId && match.winnerId === match.fighter1Id ? 'left'
    : match.winnerId && match.winnerId === match.fighter2Id ? 'right'
    : null

  // Таймер: состояние пульта, если оно живое и про этот бой; иначе считаем сами.
  const pultTimer = link.hasTimerFor(matchId) ? link.timer : null
  let seconds: number | null = null
  let frozen = false
  if (pultTimer?.state === 'running') {
    seconds = remainingUntil(pultTimer.deadlineMs, now)
  } else if (pultTimer?.state === 'paused') {
    seconds = pultTimer.remainingSec
    frozen = true
  } else if (anchorMs != null) {
    frozen = offset?.paused ?? false
    seconds = remainingSeconds({
      anchorMs,
      nowMs: frozen ? offset?.pauseStartedMs ?? now : now,
      totalSeconds,
      pauseAccSec: offset?.pauseAccSec ?? 0,
    })
  }
  const expired = seconds != null && totalSeconds != null && seconds === 0

  const nextPair = resolveNextPair({ match, encounter, tournament, tournamentMatches, teams })

  return (
    <Screen>
      <header style={HEADER}>
        <span style={{ color: MUTED }}>{tournament?.name ?? ''}</span>
        <BoutContext match={match} encounter={encounter} tournament={tournament} />
        <span style={{ display: 'flex', gap: '1.4vh', alignItems: 'center' }}>
          {match.status === 'Scheduled' && <span style={{ color: MUTED }}>Ожидание старта</span>}
          {isDoubleLoss && <span style={{ color: RED.text, fontWeight: 700 }}>Двойное поражение</span>}
          {isFinished && !isDoubleLoss && <span style={{ color: MUTED }}>Бой завершён</span>}
          {/* Пометка означает «время может быть неточным»: нет ни состояния от
              пульта, ни его сдвига в хранилище, то есть паузы табло не знает. */}
          {match.status === 'InProgress' && !pultTimer && !offset && (
            <span style={NO_LINK} title="Вкладка организатора не отвечает — время считается по данным сервера, без пауз">
              нет связи с пультом
            </span>
          )}
        </span>
      </header>

      <main style={MAIN}>
        <SidePanel side="left" color={BLUE} {...left} isWinner={winnerSide === 'left'} />

        <div style={CENTER}>
          <div
            style={{
              ...TIMER,
              color: expired ? RED.text : frozen ? MUTED : '#ffffff',
            }}
          >
            {seconds == null ? '—' : totalSeconds != null ? formatCountdown(seconds) : formatClock(seconds)}
          </div>
          {frozen && !expired && <div style={TIMER_NOTE}>пауза</div>}
          {expired && <div style={{ ...TIMER_NOTE, color: RED.text }}>время вышло</div>}
          {live.doubleHitsCount > 0 && (
            <div style={DOUBLES}>
              ⚔ {live.doubleHitsCount}
              {match.effectiveMaxDoubles != null && ` / ${match.effectiveMaxDoubles}`}
            </div>
          )}
        </div>

        <SidePanel side="right" color={RED} {...right} isWinner={winnerSide === 'right'} />
      </main>

      <footer style={FOOTER}>
        {nextPair ? (
          <>
            <span style={{ color: MUTED }}>Следующая пара:&nbsp;</span>
            <span>{nextPair}</span>
          </>
        ) : (
          <span style={{ color: MUTED }}>Следующая пара не назначена</span>
        )}
      </footer>
    </Screen>
  )
}

// ─── Экран ожидания ───────────────────────────────────────────────────────────

export function WaitingBoard({ tournamentId }: { tournamentId?: string }) {
  const { data: tournament } = useQuery({
    queryKey: ['tournaments', tournamentId],
    queryFn: () => tournamentsApi.get(tournamentId!),
    enabled: !!tournamentId,
  })

  const { data: matches } = useQuery({
    queryKey: ['tournament-matches', tournamentId],
    queryFn: () => matchesApi.listByTournament(tournamentId!),
    enabled: !!tournamentId,
    refetchInterval: 5000,
  })

  const next = byStartOrder(matches ?? []).find(m => m.status === 'Scheduled')
  const label = next && tournament ? pairLabel(next, tournament) : null

  return (
    <Screen>
      <div style={{ margin: 'auto', textAlign: 'center', padding: '0 4vw' }}>
        <div style={{ fontSize: '5vh', fontWeight: 700 }}>{tournament?.name ?? ''}</div>
        <div style={{ fontSize: '3vh', color: MUTED, marginTop: '3vh' }}>
          {label ? 'Следующая пара' : 'Активного боя нет'}
        </div>
        {label && (
          // Пара двух полных имён — самая длинная строка на этом экране.
          <FitText text={label} maxVh={7} style={{ fontWeight: 800, marginTop: '1vh' }} />
        )}
      </div>
    </Screen>
  )
}

// ─── Части экрана ─────────────────────────────────────────────────────────────

/**
 * Строка, которая гарантированно влезает в свою колонку.
 *
 * Считать кегль из длины строки нельзя: «ВЛАДЫКА РАЗРУШЕНИЯ» и «ЛИЛИЛИЛИЛИЛИЛИ»
 * при равной длине занимают разную ширину, а ширина самой панели зависит от
 * центральной колонки, то есть от текущего размера таймера. Поэтому здесь
 * честное измерение: рисуем в максимальном кегле, сравниваем `scrollWidth`
 * строки с шириной колонки и уменьшаем пропорционально. Ширина текста линейна
 * по кеглю, поэтому одного прохода достаточно; 0.98 — запас на округления.
 *
 * Пересчитывается при смене текста и при любом изменении ширины колонки
 * (`ResizeObserver`), в `useLayoutEffect` — до отрисовки, без мигания.
 */
function FitText({
  text,
  maxVh,
  style,
}: {
  text: string
  maxVh: number
  style?: React.CSSProperties
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const spanRef = useRef<HTMLSpanElement>(null)
  const [fontPx, setFontPx] = useState<number | null>(null)

  useLayoutEffect(() => {
    const box = boxRef.current
    const span = spanRef.current
    if (!box || !span) return

    const fit = () => {
      const base = (window.innerHeight * maxVh) / 100
      span.style.fontSize = `${base}px`
      const available = box.clientWidth
      const needed = span.scrollWidth
      const next =
        needed > available && needed > 0 && available > 0
          ? Math.floor((base * available * 0.98) / needed)
          : base
      // Пишем и напрямую: если значение не изменилось, React не перерисует, и
      // без этой строки в узле остался бы измерительный (максимальный) кегль.
      span.style.fontSize = `${next}px`
      setFontPx(next)
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    window.addEventListener('resize', fit)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [text, maxVh])

  return (
    <div ref={boxRef} style={{ width: '100%', minWidth: 0, overflow: 'hidden', ...style }}>
      <span
        ref={spanRef}
        style={{
          display: 'inline-block',
          whiteSpace: 'nowrap',
          fontSize: fontPx != null ? `${fontPx}px` : `${maxVh}vh`,
        }}
      >
        {text}
      </span>
    </div>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div style={SCREEN}>{children}</div>
}

function SidePanel({
  side,
  color,
  first,
  last,
  club,
  score,
  isWinner,
}: {
  side: 'left' | 'right'
  color: typeof BLUE
  first: string
  last: string
  club?: string
  score: number
  isWinner: boolean
}) {
  const align = side === 'left' ? 'flex-start' : 'flex-end'
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: align,
        justifyContent: 'center',
        gap: '1vh',
        padding: '2vh 3vw',
        textAlign: side === 'left' ? 'left' : 'right',
        background: `linear-gradient(${side === 'left' ? '90deg' : '270deg'}, ${color.wash}, transparent)`,
        borderTop: `0.8vh solid ${color.line}`,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: '3.2vh', color: MUTED, textTransform: 'uppercase', letterSpacing: '0.2vh' }}>
        {color.label}
      </div>
      {first && <FitText text={first} maxVh={4.5} style={{ lineHeight: 1.1 }} />}
      <FitText text={last.toUpperCase()} maxVh={8} style={{ fontWeight: 800, lineHeight: 1 }} />
      {club && <FitText text={club} maxVh={3} style={{ color: MUTED }} />}

      <FitText
        text={String(score)}
        maxVh={30}
        style={{
          fontWeight: 900,
          lineHeight: 0.9,
          color: color.text,
          fontVariantNumeric: 'tabular-nums',
        }}
      />

      {isWinner && <div style={{ fontSize: '3.6vh', fontWeight: 700, color: '#5ddc7a' }}>Победа</div>}
    </section>
  )
}

function BoutContext({
  match,
  encounter,
  tournament,
}: {
  match: Match
  encounter?: Encounter
  tournament?: Tournament
}) {
  if (!match.encounterId || !encounter) return <span />
  const team = (id?: string) =>
    tournament?.participants.find(p => p.participantId === id)
  const t1 = team(encounter.participant1Id)
  const t2 = team(encounter.participant2Id)
  const priority = encounter.priorityParticipantId ? team(encounter.priorityParticipantId) : undefined

  return (
    <span style={{ display: 'flex', gap: '1.6vh', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontWeight: 700 }}>
        {t1 ? participantName(t1) : '?'} {encounter.score1}
        <span style={{ color: MUTED }}> : </span>
        {encounter.score2} {t2 ? participantName(t2) : '?'}
      </span>
      <span style={{ color: MUTED }}>
        {match.boutNumber === 10 ? 'Tie-break' : `Бой ${match.boutNumber} из 9`}
      </span>
      {priority && (
        <span style={{ color: '#f0b849' }}>приоритет: {participantName(priority)}</span>
      )}
    </span>
  )
}

// ─── Следующая пара ───────────────────────────────────────────────────────────

function byStartOrder(matches: Match[]): Match[] {
  return [...matches].sort((a, b) =>
    (a.scheduledAt ?? a.createdAt).localeCompare(b.scheduledAt ?? b.createdAt)
  )
}

function pairLabel(match: Match, tournament: Tournament): string {
  const name = (id?: string) => {
    const p = tournament.participants.find(x => x.participantId === id)
    return p ? participantName(p) : '?'
  }
  return match.fighter2Id == null
    ? `${name(match.fighter1Id)} — БАЙ`
    : `${name(match.fighter1Id)} — ${name(match.fighter2Id)}`
}

function resolveNextPair(args: {
  match: Match
  encounter?: Encounter
  tournament?: Tournament
  tournamentMatches?: Match[]
  teams?: Team[]
}): string | null {
  const { match, encounter, tournament, tournamentMatches, teams } = args

  // Боут: следующий бой той же серии, имена — из составов команд.
  if (match.encounterId) {
    if (!encounter) return null
    const next = [...encounter.bouts]
      .sort((a, b) => (a.boutNumber ?? 0) - (b.boutNumber ?? 0))
      .find(b => (b.boutNumber ?? 0) > (match.boutNumber ?? 0) && b.status === 'Scheduled')
    if (!next) return null
    const names = new Map<string, string>()
    for (const t of teams ?? []) {
      for (const m of t.members) names.set(m.fighterId, `${m.firstName} ${m.lastName}`)
    }
    const name = (id?: string) => (id ? names.get(id) ?? '?' : '?')
    return `${name(next.fighter1Id)} — ${name(next.fighter2Id)}`
  }

  if (!tournament || !tournamentMatches) return null
  const ordered = byStartOrder(tournamentMatches)
  const idx = ordered.findIndex(m => m.id === match.id)
  const next = ordered.slice(idx + 1).find(m => m.status === 'Scheduled')
  return next ? pairLabel(next, tournament) : null
}

// ─── Стили ────────────────────────────────────────────────────────────────────

const HEADER: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'center',
  gap: '2vw',
  padding: '1.6vh 2vw',
  fontSize: '2.8vh',
}

const MAIN: React.CSSProperties = {
  flex: 1,
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'stretch',
  minHeight: 0,
}

const CENTER: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '1vh',
  padding: '0 2vw',
}

const TIMER: React.CSSProperties = {
  fontSize: 'min(18vh, 16vw)',
  fontWeight: 800,
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '0.4vh',
}

const TIMER_NOTE: React.CSSProperties = {
  fontSize: '3vh',
  color: MUTED,
  textTransform: 'uppercase',
  letterSpacing: '0.3vh',
}

const DOUBLES: React.CSSProperties = {
  fontSize: '3.4vh',
  color: MUTED,
  marginTop: '2vh',
  fontVariantNumeric: 'tabular-nums',
}

const FOOTER: React.CSSProperties = {
  padding: '1.8vh 2vw',
  fontSize: '3.4vh',
  fontWeight: 600,
  borderTop: '0.2vh solid #232838',
  textAlign: 'center',
}

const NO_LINK: React.CSSProperties = {
  padding: '0.4vh 1.4vh',
  borderRadius: '3vh',
  background: '#3a2a12',
  color: '#f0b849',
  fontSize: '2.4vh',
  whiteSpace: 'nowrap',
}
