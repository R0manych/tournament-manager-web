import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { fightersApi } from '../api/fighters'
import { matchesApi } from '../api/matches'
import { tournamentsApi } from '../api/tournaments'
import { encountersApi } from '../api/encounters'
import type { AddExchangeRequest, Exchange, Match, MatchStatus } from '../api/types'
import { participantShortName, participantName } from '../api/types'
import { formatClock, formatCountdown, remainingSeconds } from '../lib/timer'
import {
  clearTimerOffset,
  parseTimerOffset,
  readTimerOffset,
  timerOffsetKey,
  writeTimerOffset,
} from '../lib/timerOffset'
import {
  boardTimerOf,
  openDisplayChannel,
  parseDisplayMessage,
  postDisplay,
} from '../lib/displayChannel'
import { setHallBoardMatch, useHallBoardMatchId } from '../components/display/useHallBoard'
import PisteAssign from '../components/PisteAssign'
import { usePistes } from '../components/usePistes'
import { pisteBoardPath } from '../lib/pisteBoard'
import { SIDE1, SIDE2 } from '../lib/sideColors'

// ─── Fight Timer ──────────────────────────────────────────────────────────────

function FightTimer({
  anchorMs,
  totalSeconds,
  paused,
  pauseAccSec,
  pauseStartedMs,
}: {
  /** Якорь отсчёта — `currentRoundStartedAt` (ТЗ §7.4). */
  anchorMs: number
  totalSeconds?: number
  paused: boolean
  pauseAccSec: number
  /** `Date.now()` начала текущей паузы — момент, на который заморожен остаток. */
  pauseStartedMs: number | null
}) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    // В паузе остаток берётся на её начало, а не на «сейчас»: `pauseAccSec`
    // текущую паузу ещё не включает. Пока пауза начиналась в этой же вкладке
    // секунду назад, разницы не было, но восстановленная пауза (F5, возврат
    // завершённого боя в работу) началась в прошлом — и «сейчас» показало бы
    // остаток меньше настоящего, вплоть до нуля. Та же логика у табло
    // (`boardTimerOf`), иначе пульт и зал разойдутся.
    const compute = () =>
      remainingSeconds({
        anchorMs,
        nowMs: paused ? (pauseStartedMs ?? Date.now()) : Date.now(),
        totalSeconds,
        pauseAccSec,
      })
    setDisplay(compute())
    if (paused) return
    const id = setInterval(() => setDisplay(compute()), 200)
    return () => clearInterval(id)
  }, [anchorMs, totalSeconds, paused, pauseAccSec, pauseStartedMs])

  // `remainingSeconds` зажимает остаток в ноль, поэтому «время вышло» — это
  // ровно ноль, а не «меньше секунды осталось».
  const expired = totalSeconds != null && display === 0

  return (
    <div style={{ textAlign: 'center', margin: '4px 0' }}>
      <div style={{
        fontSize: '4em',
        fontWeight: 900,
        letterSpacing: 4,
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
        color: expired ? 'var(--c-danger)' : paused ? '#aaa' : undefined,
      }}>
        {totalSeconds != null ? formatCountdown(display) : formatClock(display)}
      </div>
      {expired && (
        <div style={{ color: 'var(--c-danger)', fontSize: '0.85em', marginTop: 4 }}>— время вышло</div>
      )}
      {paused && !expired && (
        <div style={{ color: '#aaa', fontSize: '0.85em', marginTop: 4 }}>пауза</div>
      )}
    </div>
  )
}

// ─── Exchange row ─────────────────────────────────────────────────────────────

function ExchangeRow({
  exchange,
  editable,
  onUpdate,
  onDelete,
}: {
  exchange: Exchange
  editable: boolean
  onUpdate: (data: AddExchangeRequest) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<AddExchangeRequest>({
    roundNumber: exchange.roundNumber,
    points1: exchange.points1,
    points2: exchange.points2,
    isDoubleHit: exchange.isDoubleHit,
    note: exchange.note ?? '',
  })

  function reset() {
    setForm({
      roundNumber: exchange.roundNumber,
      points1: exchange.points1,
      points2: exchange.points2,
      isDoubleHit: exchange.isDoubleHit,
      note: exchange.note ?? '',
    })
    setEditing(false)
  }

  if (editing) {
    return (
      <tr style={{ background: '#fffbe6' }}>
        <td style={TD}>{exchange.sequence}</td>
        <td style={TD}>
          <input
            type="number" min={0} value={form.points1}
            onChange={e => setForm(f => ({ ...f, points1: +e.target.value }))}
            style={{ width: 44 }}
          />
        </td>
        <td style={TD}>
          <input
            type="number" min={0} value={form.points2}
            onChange={e => setForm(f => ({ ...f, points2: +e.target.value }))}
            style={{ width: 44 }}
          />
        </td>
        <td style={{ ...TD, textAlign: 'center' }}>
          <input
            type="checkbox" checked={form.isDoubleHit}
            onChange={e => setForm(f => ({ ...f, isDoubleHit: e.target.checked }))}
          />
        </td>
        <td style={TD}>
          <input
            type="text" value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            style={{ width: 140 }}
          />
        </td>
        <td style={TD}>
          <button onClick={() => { onUpdate({ ...form, note: form.note || undefined }); setEditing(false) }}>
            ✓
          </button>
          {' '}
          <button onClick={reset}>✕</button>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td style={TD}>{exchange.sequence}</td>
      <td style={TD}>{exchange.points1}</td>
      <td style={TD}>{exchange.points2}</td>
      <td style={{ ...TD, textAlign: 'center' }}>{exchange.isDoubleHit ? '✓' : ''}</td>
      <td style={{ ...TD, color: '#666' }}>{exchange.note}</td>
      {editable && (
        <td style={TD}>
          <button onClick={() => setEditing(true)} style={ICON_BTN} title="Изменить">✎</button>
          {' '}
          <button onClick={onDelete} style={{ ...ICON_BTN, color: 'var(--c-danger)' }} title="Удалить">✕</button>
        </td>
      )}
    </tr>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MatchPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()

  // Client-side pause state
  const [paused, setPaused] = useState(false)
  const [pauseAcc, setPauseAcc] = useState(0)
  // Момент начала текущей паузы. Состояние, а не ref: его читает рендер —
  // остаток в паузе считается на её начало, иначе восстановленная пауза
  // показывала бы время меньше настоящего (см. FightTimer).
  const [pauseStartedMs, setPauseStartedMs] = useState<number | null>(null)

  // Exchange entry state
  const [note, setNote] = useState('')

  const { data: match, isLoading } = useQuery({
    queryKey: ['matches', id],
    queryFn: () => matchesApi.get(id!),
    enabled: !!id,
    refetchOnWindowFocus: true,
    refetchInterval: q => (q.state.data?.status === 'InProgress' ? 5000 : false),
  })

  const { data: tournament } = useQuery({
    queryKey: ['tournaments', match?.tournamentId],
    queryFn: () => tournamentsApi.get(match!.tournamentId),
    enabled: !!match?.tournamentId,
  })

  const { data: tournamentMatches } = useQuery({
    queryKey: ['tournament-matches', match?.tournamentId],
    queryFn: () => matchesApi.listByTournament(match!.tournamentId),
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

  // Team bout: load the parent encounter for series context (aggregate score, cap).
  const { data: encounter } = useQuery({
    queryKey: ['encounters', match?.encounterId],
    queryFn: () => encountersApi.get(match!.encounterId!),
    enabled: !!match?.encounterId,
    refetchInterval: q => (q.state.data?.status === 'InProgress' ? 5000 : false),
  })

  // Ристалища турнира: подпись площадки и ссылка на её табло. Пустой список —
  // штатный турнир на одной площадке (docs/09 §3.3), тогда всё это не рисуется.
  const { data: pistes } = usePistes(match?.tournamentId)

  // Якорь отсчёта — `currentRoundStartedAt` (ТЗ §7.4). Перехода раунда в UI нет
  // (раундов в дисциплине нет, серия — это отдельные встречи, АР-15), поэтому
  // якорь совпадает со `startedAt`; он же и фолбэк, если метки раунда нет.
  const anchorIso = match?.currentRoundStartedAt ?? match?.startedAt
  const anchorMs =
    match?.status === 'InProgress' && anchorIso ? new Date(anchorIso).getTime() : null

  // Резолв эффективных настроек — целиком на сервере (ТЗ §5.3): встреча ?? override
  // раунда ?? дефолт турнира, а для боута ещё и длительность серии. Клиент его не
  // повторяет и не перебивает: с тех пор как раунд встречи известен из размещения,
  // турнирный дефолт поверх `effective*` съедал бы `overrides` формата — например,
  // 150-секундный гранд-финал показывался бы как обычный бой (B-3, docs/04 §8).
  const totalFightSeconds =
    match?.effectiveRoundDurationSeconds ?? tournament?.defaultRoundDurationSeconds

  // Взведён ли таймер на этот якорь и видели ли мы встречу в этой вкладке.
  const armedAnchorRef = useRef<number | null>(null)
  const observedRef = useRef(false)

  // Перевзвод «с полного времени»: уже прошедшее с якоря сворачивается в
  // `pauseAcc`, таймер встаёт в паузу. Одна и та же операция нужна при старте
  // боя, при возврате в бой без сохранённого сдвига и по кнопке «Сбросить».
  const armFullTimePaused = useCallback((matchId: string, anchor: number) => {
    const folded = Math.max(0, (Date.now() - anchor) / 1000)
    const startedMs = Date.now()
    setPaused(true)
    setPauseAcc(folded)
    setPauseStartedMs(startedMs)
    writeTimerOffset(matchId, {
      anchorMs: anchor,
      pauseAccSec: folded,
      paused: true,
      pauseStartedMs: startedMs,
    })
  }, [])

  // Перевзвод таймера при смене якоря. Правило (B-3): смена якоря в живой
  // вкладке — пауза с полным временем; первое наблюдение (открытие страницы,
  // F5) — восстановление на ходу по ТЗ §7.4.
  useEffect(() => {
    if (!match) return
    const firstObservation = !observedRef.current
    observedRef.current = true

    if (anchorMs == null) {
      // Бой не идёт: следующее появление якоря — снова смена, надо перевзвести.
      // Сдвиг при этом НЕ стирается: сервер якорь не двигает при «Вернуть в бой»
      // (инвариант 12), поэтому замороженная запись под тем же якорем — это
      // единственное место, где живёт остаток на момент «Завершить». Стирание
      // здесь заодно убивало бы запись пульта в соседней вкладке, которая
      // узнаёт о завершении из поллинга.
      // Идущий сдвиг под этот бой — чужой и протухший: его писала эта вкладка,
      // пока считала бой живым, а «Завершить» нажали в другом браузере, где
      // заморозка и произошла. Оставить его — значит вернуть бой в работу с
      // отсчётом от старого якоря, то есть с нулём. Стираем: возврат честно
      // даст полное время.
      const armed = armedAnchorRef.current
      if (armed != null && readTimerOffset(match.id, armed)?.paused === false) {
        clearTimerOffset(match.id)
      }
      armedAnchorRef.current = null
      return
    }
    if (armedAnchorRef.current === anchorMs) return
    armedAnchorRef.current = anchorMs

    // Готовая запись под этот якорь старше собственного перевзвода — и после F5,
    // и когда вторая вкладка узнала о новом раунде из поллинга уже после того,
    // как его взвёл пульт. Иначе она перевзвела бы таймер по-своему и вернула
    // идущий у пульта отсчёт в паузу.
    const saved = readTimerOffset(match.id, anchorMs)
    if (saved) {
      setPaused(saved.paused)
      setPauseAcc(saved.pauseAccSec)
      // Пауза, начатая до перезагрузки, продолжает копиться: «Продолжить»
      // добавит и время, пока вкладки не было.
      setPauseStartedMs(saved.pauseStartedMs ?? Date.now())
      return
    }

    if (firstObservation) {
      // Открытие страницы или F5, сдвига в браузере нет: сервер пауз не хранит
      // (§7.3), поэтому восстанавливаем на ходу по ТЗ §7.4.
      setPaused(false)
      setPauseAcc(0)
      setPauseStartedMs(null)
      writeTimerOffset(match.id, { anchorMs, pauseAccSec: 0, paused: false, pauseStartedMs: null })
      return
    }
    // Старт боя, а также возврат в бой, когда замороженной записи не нашлось
    // (другой браузер, приватный режим, протухший TTL): сворачиваем уже
    // прошедшее с якоря, чтобы раунд начался с полного времени по «Продолжить».
    // Заодно это гасит расхождение часов клиента и сервера — работающий таймер
    // считает от момента перевзвода, а не от серверной метки.
    armFullTimePaused(match.id, anchorMs)
  }, [match, anchorMs, armFullTimePaused])

  // Соседняя вкладка того же боя изменила сдвиг (пауза, «Продолжить») —
  // подхватываем. Событие `storage` приходит только в другие вкладки, поэтому
  // обратной записи здесь нет и зацикливания не возникает.
  useEffect(() => {
    const matchId = match?.id
    if (!matchId || anchorMs == null) return
    const onStorage = (e: StorageEvent) => {
      if (e.key !== timerOffsetKey(matchId)) return
      const next = parseTimerOffset(e.newValue, anchorMs)
      if (!next) return
      setPaused(next.paused)
      setPauseAcc(next.pauseAccSec)
      setPauseStartedMs(next.pauseStartedMs ?? Date.now())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [match?.id, anchorMs])

  // ─── Вещание на табло (АР-14) ───────────────────────────────────────────────
  // Эта вкладка — пульт: она сообщает табло нормализованное состояние таймера и
  // счёт сразу после схода. Тик не передаётся: табло тикает само от
  // `deadlineMs`. Пауза живёт только на клиенте (АР-1), поэтому без этого канала
  // табло разошлось бы с пультом на всех паузах.
  //
  // Чего здесь больше НЕТ — `show` при открытии страницы. Открытая карточка боя
  // означала «показывай это залу», и зал переключался на бой, в который
  // оператор просто заглянул уточнить счёт (B-12). Теперь `show` уходит только
  // по кнопке «Вывести на табло зала» (docs/09 §7).
  const channelRef = useRef<BroadcastChannel | null>(null)
  const publishRef = useRef<() => void>(() => {})

  useEffect(() => {
    const channel = openDisplayChannel()
    channelRef.current = channel
    if (!channel) return
    const onMessage = (e: MessageEvent) => {
      // Табло открылось или перезагрузилось — отвечаем текущим состоянием.
      if (parseDisplayMessage(e.data)?.type === 'hello') publishRef.current()
    }
    channel.addEventListener('message', onMessage)
    return () => {
      channel.removeEventListener('message', onMessage)
      channel.close()
      channelRef.current = null
    }
  }, [])

  const score = match
    ? { score1: match.score1, score2: match.score2, doubleHitsCount: match.doubleHitsCount }
    : null

  useEffect(() => {
    const matchId = match?.id
    const tournamentId = match?.tournamentId
    if (!matchId || !tournamentId) return
    publishRef.current = () => {
      const channel = channelRef.current
      if (!channel) return
      postDisplay(channel, {
        type: 'timer',
        matchId,
        timer: boardTimerOf({
          anchorMs,
          totalSeconds: totalFightSeconds,
          paused,
          pauseAccSec: pauseAcc,
          pauseStartedMs: paused ? pauseStartedMs : null,
        }),
      })
      if (score != null) {
        postDisplay(channel, {
          type: 'score',
          matchId,
          score1: score.score1,
          score2: score.score2,
          doubleHitsCount: score.doubleHitsCount,
        })
      }
    }
    publishRef.current()
  }, [
    match?.id,
    match?.tournamentId,
    anchorMs,
    totalFightSeconds,
    paused,
    pauseAcc,
    pauseStartedMs,
    score?.score1,
    score?.score2,
    score?.doubleHitsCount,
  ])

  // ─── «Вывести на табло зала» (B-12, docs/09 §7) ─────────────────────────────
  // Явное действие вместо автопубликации: зал переключается по решению
  // оператора, а не по тому, какую вкладку он открыл. Решение хранится (общее
  // для вкладок одного браузера) — иначе табло, перезагруженное после нажатия,
  // о нём бы не узнало: отвечать на `hello` теперь некому.
  //
  // Это про турниры без ристалищ (docs/09 §3.3). Там, где площадки заведены,
  // табло ристалища знает свой бой из данных, и кнопка ему не нужна.
  const hallBoardMatchId = useHallBoardMatchId(match?.tournamentId)
  const onHallBoard = hallBoardMatchId != null && hallBoardMatchId === match?.id

  function toggleHallBoard() {
    if (!match) return
    setHallBoardMatch(match.tournamentId, onHallBoard ? null : match.id, channelRef.current)
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['matches', id] })
    // A bout score change moves the encounter aggregate — refresh it too.
    if (match?.encounterId) {
      qc.invalidateQueries({ queryKey: ['encounters', match.encounterId] })
      qc.invalidateQueries({ queryKey: ['tournament-matches', match.tournamentId] })
    }
  }

  const statusMut = useMutation({
    mutationFn: (s: MatchStatus) => matchesApi.setStatus(id!, s),
    onSuccess: (updated) => {
      // Immediately put server response into cache — no wait for refetch.
      // This ensures FightTimer sees the new anchor right away when going InProgress.
      qc.setQueryData(['matches', id], updated)
      // Отмена встречи освобождает её ячейку сетки (инвариант 44) — сетка на
      // странице турнира обязана увидеть, что ячейка опустела.
      if (updated.status === 'Cancelled') {
        qc.invalidateQueries({ queryKey: ['tournament-matches', updated.tournamentId] })
      }
      if (updated.status !== 'InProgress') freezeOffset(updated)
      // Взвод таймера живёт в эффекте по смене якоря (см. выше), а не здесь:
      // якорь меняется и при старте боя, и при «Вернуть в бой».
      invalidate()
    },
  })
  // Ответ сервера — уже пересчитанная встреча (инвариант 1), поэтому кладём её
  // в кэш сразу: и пульт, и табло видят новый счёт, не дожидаясь рефетча.
  const applyUpdated = (updated: Match) => {
    qc.setQueryData(['matches', id], updated)
    invalidate()
  }

  const warnMut = useMutation({
    mutationFn: ({ f1d, f2d }: { f1d?: number; f2d?: number }) =>
      matchesApi.updateWarnings(id!, f1d, f2d),
    onSuccess: applyUpdated,
  })
  // Видеоповторы — тот же контракт, что у предупреждений: дельты, зажим в ноль
  // на сервере, только при `InProgress` (иначе 409).
  const replayMut = useMutation({
    mutationFn: ({ f1d, f2d }: { f1d?: number; f2d?: number }) =>
      matchesApi.updateVideoReplays(id!, f1d, f2d),
    onSuccess: applyUpdated,
  })
  const addExchangeMut = useMutation({
    mutationFn: (data: AddExchangeRequest) => matchesApi.addExchange(id!, data),
    onSuccess: (updated) => { setNote(''); applyUpdated(updated) },
  })
  const updateExchangeMut = useMutation({
    mutationFn: ({ exchangeId, data }: { exchangeId: string; data: AddExchangeRequest }) =>
      matchesApi.updateExchange(exchangeId, data),
    onSuccess: applyUpdated,
  })
  const delExchangeMut = useMutation({
    mutationFn: (eid: string) => matchesApi.deleteExchange(eid),
    onSuccess: invalidate,
  })

  // Снятие очков. Счёт — производная от сходов (инвариант 1), а отрицательные
  // очки сервер не принимает (400, ExchangesController), поэтому «−N» не пишет
  // корректирующий сход, а откатывает журнал с конца: у последних сходов этой
  // стороны очки убавляются, а сход, оставшийся пустым (0:0 и не обоюдный),
  // удаляется. Обоюдные сходы не трогаются — они очков не дают, и снимать их
  // счётчик судья не просил.
  const undoScoreMut = useMutation({
    mutationFn: async ({ side, points }: { side: 1 | 2; points: number }) => {
      let remaining = points
      let updated: Match | undefined
      const fromLast = [...(match?.exchanges ?? [])].sort((a, b) => b.sequence - a.sequence)
      for (const e of fromLast) {
        if (remaining === 0) break
        const own = side === 1 ? e.points1 : e.points2
        if (own === 0) continue
        const take = Math.min(own, remaining)
        const p1 = side === 1 ? e.points1 - take : e.points1
        const p2 = side === 2 ? e.points2 - take : e.points2
        // Строго последовательно: каждый ответ — уже пересчитанная встреча,
        // параллельные правки одного счёта разъехались бы.
        updated = p1 === 0 && p2 === 0 && !e.isDoubleHit
          ? await matchesApi.deleteExchange(e.id)
          : await matchesApi.updateExchange(e.id, {
              roundNumber: e.roundNumber,
              points1: p1,
              points2: p2,
              isDoubleHit: e.isDoubleHit,
              note: e.note,
            })
        remaining -= take
      }
      return updated
    },
    onSuccess: (updated) => { if (updated) applyUpdated(updated); else invalidate() },
  })

  // Снятие обоюдного. Обоюдные очков не дают, они считаются отдельно
  // (инвариант 2: `DoubleHitsCount = count(Exchanges where IsDoubleHit)`),
  // поэтому «⚔−» снимает флаг с последнего такого схода, а не убавляет счёт.
  // Пустой сход (0:0) при этом удаляется целиком, а сход, которому судья
  // руками проставил очки, остаётся с ними: их отмена — отдельное решение и
  // отдельная кнопка «−N».
  const undoDoubleMut = useMutation({
    mutationFn: async () => {
      const last = [...(match?.exchanges ?? [])]
        .sort((a, b) => b.sequence - a.sequence)
        .find(e => e.isDoubleHit)
      if (!last) return undefined
      if (last.points1 === 0 && last.points2 === 0) return matchesApi.deleteExchange(last.id)
      return matchesApi.updateExchange(last.id, {
        roundNumber: last.roundNumber,
        points1: last.points1,
        points2: last.points2,
        isDoubleHit: false,
        note: last.note,
      })
    },
    onSuccess: (updated) => { if (updated) applyUpdated(updated); else invalidate() },
  })

  // Каждое изменение сдвига пишем сразу в точке изменения, а не эффектом:
  // эффект в том же коммите видел бы ещё старое состояние и затирал бы запись,
  // которую только что восстановила вторая вкладка.
  function persistOffset(pauseAccSec: number, paused: boolean, pauseStartedMs: number | null) {
    if (!match || anchorMs == null) return
    writeTimerOffset(match.id, { anchorMs, pauseAccSec, paused, pauseStartedMs })
  }

  // Бой перестал идти. Сервер якорь при «Вернуть в бой» не двигает (инвариант
  // 12), а остатка не хранит вовсе (АР-1), поэтому остаток на момент
  // «Завершить» существует только как клиентский сдвиг: замораживаем его
  // паузой под тем же якорем. Возврат в бой найдёт запись и продолжит с того
  // же места, а время, пока встреча стояла завершённой, доберётся в `pauseAcc`
  // механикой обычной паузы. Отменённая встреча в бой не возвращается
  // (инвариант 16) — её запись только занимает место.
  function freezeOffset(updated: Match) {
    if (updated.status === 'Cancelled') {
      clearTimerOffset(updated.id)
      return
    }
    const iso = updated.currentRoundStartedAt ?? updated.startedAt
    if (!iso) return   // встреча не начиналась (обоюдная неявка) — замораживать нечего
    writeTimerOffset(updated.id, {
      anchorMs: new Date(iso).getTime(),
      pauseAccSec: pauseAcc,
      paused: true,
      pauseStartedMs: paused ? (pauseStartedMs ?? Date.now()) : Date.now(),
    })
  }

  function handlePause() {
    const startedMs = Date.now()
    setPauseStartedMs(startedMs)
    setPaused(true)
    persistOffset(pauseAcc, true, startedMs)
  }

  // Ручная правка остатка (судья отмерил время не по секундомеру, таймер
  // запустили позже команды «Бой»). Отдельного поля не заводим: `pauseAcc` и
  // есть клиентский сдвиг — в него же сворачивается прошедшее при перевзводе.
  // Поэтому правка автоматически переживает F5, видна соседним вкладкам и
  // уезжает на табло тем же путём, что пауза.
  function adjustTimer(deltaSec: number) {
    if (anchorMs == null || totalFightSeconds == null) return
    // В паузе точка отсчёта — её начало, как и в самом расчёте остатка.
    const nowMs = paused ? (pauseStartedMs ?? Date.now()) : Date.now()
    const wallSec = (nowMs - anchorMs) / 1000
    // Остаток = total − wall + pauseAcc, поэтому границы «не больше полного
    // времени» и «не меньше нуля» — это границы для самого сдвига.
    const next = Math.min(wallSec, Math.max(wallSec - totalFightSeconds, pauseAcc + deltaSec))
    setPauseAcc(next)
    persistOffset(next, paused, paused ? pauseStartedMs : null)
  }

  function handleResume() {
    const acc = pauseAcc + (Date.now() - (pauseStartedMs ?? Date.now())) / 1000
    setPauseAcc(acc)
    setPaused(false)
    persistOffset(acc, false, null)
  }

  function quickScore(p1: number, p2: number, isDouble = false) {
    if (!match) return
    addExchangeMut.mutate({
      roundNumber: match.currentRoundNumber,
      points1: p1,
      points2: p2,
      isDoubleHit: isDouble,
      note: note || undefined,
    })
  }

  // Начисление и снятие правят один и тот же журнал сходов — пока летит одно,
  // второе недоступно, иначе «−1» посчитается по устаревшему списку.
  const scoreBusy = addExchangeMut.isPending || undoScoreMut.isPending || undoDoubleMut.isPending

  if (isLoading) return <p>Загрузка...</p>
  if (!match) return <p>Встреча не найдена</p>

  // Площадка боя — эффективная: у боута собственный `pisteId` пуст всегда
  // (инвариант 54), площадку задаёт его серия.
  const matchPiste = pistes?.find(p => p.id === match.effectivePisteId)

  const isBye = match.fighter2Id == null
  const name1 = f1 ? `${f1.firstName} ${f1.lastName}` : '…'
  const name2 = isBye ? 'БАЙ' : (f2 ? `${f2.firstName} ${f2.lastName}` : '…')
  const short1 = name1.split(' ')[0]
  const short2 = name2.split(' ')[0]

  const isScheduled = match.status === 'Scheduled'
  const isInProgress = match.status === 'InProgress'
  const isCompleted = match.status === 'Completed'
  const isWalkover = match.status === 'WalkoverWin'
  const isDoubleLoss = match.status === 'DoubleLoss'

  const winnerName =
    match.winnerId === match.fighter1Id ? name1
    : match.winnerId === match.fighter2Id ? name2
    : null

  // Team bout context
  const isBout = match.encounterId != null
  const isTieBreak = match.boutNumber === 10

  // Soft cap: encounter aggregate (which already includes this in-progress bout)
  // reaching the bout's targetCumulativeScore signals the referee to end the bout.
  const teamName1 = encounter ? tournament?.participants.find(p => p.participantId === encounter.participant1Id) : undefined
  const teamName2 = encounter ? tournament?.participants.find(p => p.participantId === encounter.participant2Id) : undefined
  const capReached =
    isBout && !isTieBreak && match.targetCumulativeScore != null && encounter != null &&
    (encounter.score1 >= match.targetCumulativeScore || encounter.score2 >= match.targetCumulativeScore)
  const priorityTeam =
    isTieBreak && encounter?.priorityParticipantId
      ? tournament?.participants.find(p => p.participantId === encounter.priorityParticipantId)
      : undefined

  // Adjacent match navigation
  const sortedMatches = [...(tournamentMatches ?? [])].sort((a, b) => {
    const ta = a.scheduledAt ?? a.createdAt
    const tb = b.scheduledAt ?? b.createdAt
    return ta.localeCompare(tb)
  })
  const currentIdx = sortedMatches.findIndex(m => m.id === id)
  // Bouts are navigated through their encounter page, not the flat match list.
  const prevMatch = !isBout && currentIdx > 0 ? sortedMatches[currentIdx - 1] : null
  const nextMatch = !isBout && currentIdx >= 0 && currentIdx < sortedMatches.length - 1
    ? sortedMatches[currentIdx + 1]
    : null

  function matchLabel(m: typeof sortedMatches[0]) {
    const p1 = tournament?.participants.find(p => p.participantId === m.fighter1Id)
    const p2 = tournament?.participants.find(p => p.participantId === m.fighter2Id)
    return `${p1 ? participantShortName(p1) : '?'} – ${p2 ? participantShortName(p2) : '?'}`
  }

  const warn1Over = match.effectiveMaxWarnings != null && match.warnings1 >= match.effectiveMaxWarnings
  const warn2Over = match.effectiveMaxWarnings != null && match.warnings2 >= match.effectiveMaxWarnings
  const doublesLimit = match.effectiveMaxDoubles
  const doublesOver = doublesLimit != null && match.doubleHitsCount > doublesLimit

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 16px' }}>
      {/* Breadcrumb + adjacent navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0 4px', fontSize: '0.9em', flexWrap: 'wrap' }}>
        <Link to={`/tournaments/${match.tournamentId}/matches`} style={{ color: '#888', whiteSpace: 'nowrap' }}>
          ← Встречи
        </Link>
        {/* Три табло с честными подписями (B-12, п. 3): раньше отсюда была
            достижима только закреплённая ссылка, и оператор переоткрывал её на
            каждый бой, считая это единственным табло. */}
        {matchPiste && (
          <a
            href={pisteBoardPath(matchPiste.id)}
            target="_blank"
            rel="noopener"
            title="Табло площадки: само показывает бой, идущий на этом ристалище, и следующую пару этой же площадки. Переоткрывать на каждый бой не нужно."
            style={{ color: '#1976d2', whiteSpace: 'nowrap' }}
          >
            🖵 Табло ристалища «{matchPiste.name}»
          </a>
        )}
        <a
          href={`/display/match/${match.id}`}
          target="_blank"
          rel="noopener"
          title="Табло, закреплённое за этим боем: не переключится ни на какой другой. Для финала на большом экране."
          style={{ color: '#888', whiteSpace: 'nowrap' }}
        >
          🖵 Табло этого боя (не переключится)
        </a>
        <a
          href={`/display/tournament/${match.tournamentId}`}
          target="_blank"
          rel="noopener"
          title="Табло зала: показывает бой, выведенный кнопкой «Вывести на табло зала», иначе начатый последним."
          style={{ color: '#888', whiteSpace: 'nowrap' }}
        >
          🖵 Табло зала (следует за выбором)
        </a>
        <button
          onClick={toggleHallBoard}
          title={
            onHallBoard
              ? 'Сейчас на табло зала этот бой. Снять — зал вернётся к бою, начатому последним.'
              : 'Показать этот бой на табло зала. Пока не нажать, зал не переключится: открытая карточка боя сама по себе ничего не выводит.'
          }
          style={{
            whiteSpace: 'nowrap',
            fontSize: '0.9em',
            cursor: 'pointer',
            borderRadius: 4,
            padding: '2px 10px',
            border: onHallBoard ? '1px solid #2e7d32' : '1px solid #ccc',
            background: onHallBoard ? '#e8f9ec' : '#fff',
            color: onHallBoard ? '#2e7d32' : '#555',
            fontWeight: onHallBoard ? 600 : 400,
          }}
        >
          {onHallBoard ? '● Сейчас на табло зала' : 'Вывести на табло зала'}
        </button>
        <span style={{ flex: 1 }} />
        {prevMatch && (
          <Link
            to={`/matches/${prevMatch.id}`}
            title={matchLabel(prevMatch)}
            style={{ color: '#888', whiteSpace: 'nowrap' }}
          >
            ← {matchLabel(prevMatch)}
          </Link>
        )}
        {prevMatch && nextMatch && <span style={{ color: '#ddd' }}>|</span>}
        {nextMatch && (
          <Link
            to={`/matches/${nextMatch.id}`}
            title={matchLabel(nextMatch)}
            style={{
              whiteSpace: 'nowrap',
              fontWeight: nextMatch.status !== 'Completed' && nextMatch.status !== 'Cancelled' ? 600 : undefined,
              color: nextMatch.status === 'Scheduled' ? '#1976d2'
                : nextMatch.status === 'InProgress' ? '#2e7d32'
                : '#888',
            }}
          >
            {matchLabel(nextMatch)} →
          </Link>
        )}
      </div>

      {/* Team series context */}
      {isBout && encounter && (
        <div style={{
          border: '1px solid #d6e4f0', background: '#f3f8fd', borderRadius: 8,
          padding: '10px 14px', margin: '4px 0 12px',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <Link to={`/encounters/${match.encounterId}`} style={{ color: '#1976d2', whiteSpace: 'nowrap' }}>
            ← К серии
          </Link>
          <span style={{ fontWeight: 600 }}>
            {teamName1 ? participantName(teamName1) : '?'} {encounter.score1}
            <span style={{ color: '#bbb' }}> : </span>
            {encounter.score2} {teamName2 ? participantName(teamName2) : '?'}
          </span>
          <span style={{ fontSize: '0.85em', color: '#888' }}>
            {isTieBreak ? 'Tie-break (10-й бой)' : `Бой ${match.boutNumber} из 9`}
            {!isTieBreak && match.targetCumulativeScore != null && ` · лимит серии ${match.targetCumulativeScore}`}
          </span>
          {priorityTeam && (
            <span style={{
              fontSize: '0.78em', padding: '1px 8px', borderRadius: 10,
              background: '#fff4e5', color: '#a86500', fontWeight: 600,
            }}>
              Приоритет: {participantName(priorityTeam)}
            </span>
          )}
        </div>
      )}

      {capReached && isInProgress && (
        <p style={{
          textAlign: 'center', margin: '0 0 12px', padding: '8px 12px',
          background: '#fff4e5', color: '#a86500', borderRadius: 6, fontWeight: 600,
        }}>
          ⚠ Достигнут лимит серии — завершите бой.
        </p>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 12px', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: '1.3em' }}>{isBout ? (isTieBreak ? 'Tie-break' : `Бой ${match.boutNumber}`) : 'Бой'}</h1>
        <span style={{
          padding: '2px 10px',
          borderRadius: 12,
          fontSize: '0.8em',
          fontWeight: 600,
          background: isScheduled ? '#e8f4fd' : isInProgress ? '#e8f9ec' : isDoubleLoss ? '#fdeceb' : '#f0f0f0',
          color: isScheduled ? '#1976d2' : isInProgress ? '#2e7d32' : isDoubleLoss ? '#b3261e' : '#555',
        }}>
          {match.status === 'Scheduled' && 'Запланирован'}
          {match.status === 'InProgress' && 'Идёт бой'}
          {match.status === 'Completed' && 'Завершён'}
          {match.status === 'Cancelled' && 'Отменён'}
          {match.status === 'WalkoverWin' && 'Бай (тех. победа)'}
          {match.status === 'DoubleLoss' && 'Двойное поражение'}
        </span>
        {match.scheduledAt && (
          <span style={{ fontSize: '0.85em', color: '#888' }}>
            {new Date(match.scheduledAt).toLocaleString('ru')}
          </span>
        )}
        {/* Ристалище — рядом со статусом (docs/09 §6.2). У боута оно своё
            только через серию, поэтому здесь оно показано, но не правится:
            назначить площадку отдельному боуту нельзя (инвариант 54). */}
        {isBout ? (
          matchPiste && (
            <span style={{ fontSize: '0.85em', color: '#888' }} title="Площадка серии: боут идёт там же, где вся серия">
              🏟 {matchPiste.name} <span style={{ color: '#bbb' }}>(от серии)</span>
            </span>
          )
        ) : (
          <PisteAssign
            target={{ kind: 'match', match }}
            disabled={isCompleted || isWalkover || isDoubleLoss || match.status === 'Cancelled'}
            disabledTitle="Бой завершён: назначать площадку задним числом нечему"
            compact
          />
        )}
      </div>

      {/* Scoreboard. Стороны маркированы цветом так же, как на табло (АР-14):
          участник 1 — синий слева, участник 2 — красный справа. Судья за
          пультом и зал смотрят один бой, и расхождение сторон стоит укола,
          начисленного не тому. */}
      <div style={SCOREBOARD}>
        <div style={{ ...SIDE_PANEL, borderTopColor: SIDE1.line, background: SIDE1.wash, textAlign: 'right' }}>
          <div style={{ fontSize: '1.15em', fontWeight: 700, color: SIDE1.text }}>{name1}</div>
          {f1?.club && <div style={{ fontSize: '0.82em', color: '#888' }}>{f1.club}</div>}
          {(match.warnings1 > 0 || isInProgress) && (
            <div style={{ marginTop: 6, fontSize: '0.85em', color: warn1Over ? 'var(--c-danger)' : '#c88' }}>
              ⚠ {match.warnings1}
              {match.effectiveMaxWarnings != null && ` / ${match.effectiveMaxWarnings}`}
            </div>
          )}
          {match.videoReplays1 > 0 && (
            <div style={{ marginTop: 4, fontSize: '0.85em', color: '#888' }}>🎥 {match.videoReplays1}</div>
          )}
        </div>

        <div style={{ textAlign: 'center', minWidth: 140, padding: '0 12px' }}>
          <div style={{
            fontSize: '4em',
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: 6,
            fontVariantNumeric: 'tabular-nums',
          }}>
            <span style={{ color: SIDE1.text }}>{match.score1}</span>
            <span style={{ color: '#ccc', margin: '0 4px', fontWeight: 300 }}>:</span>
            <span style={{ color: SIDE2.text }}>{match.score2}</span>
          </div>
          <div style={{ marginTop: 6, fontSize: '0.8em', color: doublesOver ? 'var(--c-danger)' : '#aaa' }}>
            ⚔ {match.doubleHitsCount}{doublesLimit != null && ` / ${doublesLimit}`}
            {doublesOver && ' ⚠'}
          </div>
        </div>

        <div style={{ ...SIDE_PANEL, borderTopColor: SIDE2.line, background: SIDE2.wash }}>
          <div style={{ fontSize: '1.15em', fontWeight: 700, color: SIDE2.text }}>{name2}</div>
          {f2?.club && <div style={{ fontSize: '0.82em', color: '#888' }}>{f2.club}</div>}
          {(match.warnings2 > 0 || isInProgress) && (
            <div style={{ marginTop: 6, fontSize: '0.85em', color: warn2Over ? 'var(--c-danger)' : '#c88' }}>
              ⚠ {match.warnings2}
              {match.effectiveMaxWarnings != null && ` / ${match.effectiveMaxWarnings}`}
            </div>
          )}
          {match.videoReplays2 > 0 && (
            <div style={{ marginTop: 4, fontSize: '0.85em', color: '#888' }}>🎥 {match.videoReplays2}</div>
          )}
        </div>
      </div>

      {/* Winner */}
      {/* Двойное поражение — не ничья (АР-16): победителя нет, проиграли оба,
          а счёт остаётся как есть и виден выше. */}
      {isDoubleLoss && (
        <p style={{ textAlign: 'center', fontWeight: 700, fontSize: '1.2em', color: '#b3261e', margin: '8px 0' }}>
          Двойное поражение — победителя нет, поражение засчитано обоим
        </p>
      )}
      {(isCompleted || isWalkover) && (
        <p style={{ textAlign: 'center', fontWeight: 700, fontSize: '1.2em', color: winnerName ? '#2e7d32' : '#555', margin: '8px 0' }}>
          {isWalkover ? `Победитель (бай): ${name1}` : winnerName ? `Победитель: ${winnerName}` : 'Ничья'}
        </p>
      )}

      {/* Timer + action buttons */}
      <div style={{ textAlign: 'center', margin: '16px 0 20px' }}>
        {isInProgress && anchorMs != null && (
          <FightTimer
            anchorMs={anchorMs}
            totalSeconds={totalFightSeconds}
            paused={paused}
            pauseAccSec={pauseAcc}
            pauseStartedMs={paused ? pauseStartedMs : null}
          />
        )}

        {/* Ручная правка остатка. Только при заданной длительности: в режиме
            секундомера (длительность не резолвится) «+10» означало бы обратное. */}
        {isInProgress && anchorMs != null && totalFightSeconds != null && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 6 }}>
            <button onClick={() => adjustTimer(-10)} style={BTN_TIME_ADJUST} title="Убавить 10 секунд">
              −10 с
            </button>
            <button onClick={() => adjustTimer(10)} style={BTN_TIME_ADJUST} title="Добавить 10 секунд">
              +10 с
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 14 }}>
          {isScheduled && (
            <button
              onClick={() => statusMut.mutate('InProgress')}
              disabled={statusMut.isPending}
              style={BTN_PRIMARY}
            >
              Старт
            </button>
          )}
          {isInProgress && !paused && (
            <button onClick={handlePause} style={BTN_SECONDARY}>
              Стоп
            </button>
          )}
          {isInProgress && paused && (
            <button onClick={handleResume} style={BTN_PRIMARY}>
              {pauseAcc === 0 ? 'Старт таймера' : 'Продолжить'}
            </button>
          )}
          {/* Возврат в бой продолжает с сохранённого остатка. Если бой надо
              переиграть с начала, а не доиграть, время возвращается сюда. */}
          {isInProgress && anchorMs != null && (
            <button
              onClick={() => {
                if (!window.confirm('Сбросить таймер на полное время раунда?')) return
                armFullTimePaused(match.id, anchorMs)
              }}
              style={BTN_SECONDARY}
              title="Отсчёт начнётся заново с полного времени"
            >
              ⟲ Сбросить таймер
            </button>
          )}
          {isInProgress && (
            <button
              onClick={() => statusMut.mutate('Completed')}
              disabled={statusMut.isPending}
              style={BTN_SUCCESS}
            >
              Завершить бой
            </button>
          )}
          {/* Двойное поражение (АР-16) — только вручную и только осознанно:
              автоматики по лимитам нет, а статус терминальный. */}
          {(isScheduled || isInProgress) && (
            <button
              onClick={() => {
                if (!window.confirm(
                  'Двойное поражение: победителя не будет, поражение засчитается обоим участникам. ' +
                  'Набранный счёт сохранится. Продолжить?'
                )) return
                statusMut.mutate('DoubleLoss')
              }}
              disabled={statusMut.isPending}
              style={BTN_DANGER}
            >
              Двойное поражение
            </button>
          )}
          {(isCompleted || isDoubleLoss) && (
            <button
              onClick={() => statusMut.mutate('InProgress')}
              disabled={statusMut.isPending}
              style={BTN_SECONDARY}
            >
              ↩ Вернуть в бой
            </button>
          )}
          {statusMut.isError && (
            <span style={{ color: 'var(--c-danger)', alignSelf: 'center', fontSize: '0.9em' }}>Ошибка</span>
          )}
        </div>
      </div>

      {isInProgress && (
        <>
          {/* Warnings */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 16px', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#666', fontSize: '0.85em' }}>Предупреждения:</span>
            <button onClick={() => warnMut.mutate({ f1d: 1 })} disabled={warnMut.isPending} style={SIDE_BTN1}>⚠+ {short1}</button>
            <button onClick={() => warnMut.mutate({ f1d: -1 })} disabled={warnMut.isPending || match.warnings1 === 0} style={SIDE_BTN1}>⚠− {short1}</button>
            <button onClick={() => warnMut.mutate({ f2d: 1 })} disabled={warnMut.isPending} style={SIDE_BTN2}>⚠+ {short2}</button>
            <button onClick={() => warnMut.mutate({ f2d: -1 })} disabled={warnMut.isPending || match.warnings2 === 0} style={SIDE_BTN2}>⚠− {short2}</button>
          </div>

          {/* Видеоповторы. Отдельным рядом от предупреждений: это не санкция, а
              израсходованный ресурс стороны, и путать их кнопками нельзя. */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 16px', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#666', fontSize: '0.85em' }}>Видеоповторы:</span>
            <button onClick={() => replayMut.mutate({ f1d: 1 })} disabled={replayMut.isPending} style={SIDE_BTN1}>🎥+ {short1}</button>
            <button onClick={() => replayMut.mutate({ f1d: -1 })} disabled={replayMut.isPending || match.videoReplays1 === 0} style={SIDE_BTN1}>🎥− {short1}</button>
            <button onClick={() => replayMut.mutate({ f2d: 1 })} disabled={replayMut.isPending} style={SIDE_BTN2}>🎥+ {short2}</button>
            <button onClick={() => replayMut.mutate({ f2d: -1 })} disabled={replayMut.isPending || match.videoReplays2 === 0} style={SIDE_BTN2}>🎥− {short2}</button>
          </div>

          {/* Quick score */}
          <div style={{ margin: '0 0 20px', padding: '16px', border: '1px solid #ddd', borderRadius: 8, background: '#fafafa' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              {/* Колонка начисления окрашена в цвет своей стороны: под
                  таймером судья целится в кнопку, а не читает подпись, и
                  промах здесь — укол не тому бойцу. */}
              <div style={{ ...SCORE_COLUMN, borderTopColor: SIDE1.line, background: SIDE1.wash }}>
                <div style={{ fontSize: '0.85em', color: SIDE1.text, marginBottom: 6, fontWeight: 700 }}>{short1}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1, 2, 3].map(p => (
                    <button
                      key={p}
                      onClick={() => quickScore(p, 0)}
                      disabled={scoreBusy}
                      style={{ ...BTN_SCORE, color: SIDE1.text, borderColor: SIDE1.border }}
                    >
                      +{p}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  {[1, 2, 3].map(p => (
                    <button
                      key={p}
                      onClick={() => undoScoreMut.mutate({ side: 1, points: p })}
                      disabled={scoreBusy || match.score1 < p}
                      title={`Снять ${p} у «${short1}»`}
                      style={BTN_SCORE_MINUS}
                    >
                      −{p}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ textAlign: 'center' }}>
                <button
                  onClick={() => quickScore(0, 0, true)}
                  disabled={scoreBusy}
                  style={{ ...BTN_SCORE, background: '#f0e6ff', minWidth: 90, fontSize: '0.95em' }}
                >
                  ⚔ Обоюдный
                </button>
                <div style={{ marginTop: 6 }}>
                  <button
                    onClick={() => undoDoubleMut.mutate()}
                    disabled={scoreBusy || match.doubleHitsCount === 0}
                    title="Снять последний обоюдный"
                    style={{ ...BTN_SCORE_MINUS, minWidth: 90, width: '100%' }}
                  >
                    ⚔−
                  </button>
                </div>
              </div>

              <div style={{ ...SCORE_COLUMN, borderTopColor: SIDE2.line, background: SIDE2.wash }}>
                <div style={{ fontSize: '0.85em', color: SIDE2.text, marginBottom: 6, fontWeight: 700 }}>{short2}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1, 2, 3].map(p => (
                    <button
                      key={p}
                      onClick={() => quickScore(0, p)}
                      disabled={scoreBusy}
                      style={{ ...BTN_SCORE, color: SIDE2.text, borderColor: SIDE2.border }}
                    >
                      +{p}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  {[1, 2, 3].map(p => (
                    <button
                      key={p}
                      onClick={() => undoScoreMut.mutate({ side: 2, points: p })}
                      disabled={scoreBusy || match.score2 < p}
                      title={`Снять ${p} у «${short2}»`}
                      style={BTN_SCORE_MINUS}
                    >
                      −{p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Заметка к следующему сходу"
                value={note}
                onChange={e => setNote(e.target.value)}
                style={{ flex: 1, fontSize: '0.9em' }}
              />
              {(addExchangeMut.isError || undoScoreMut.isError || undoDoubleMut.isError) && (
                <span style={{ color: 'var(--c-danger)', fontSize: '0.85em' }}>Ошибка</span>
              )}
            </div>

          </div>
        </>
      )}

      {/* Exchanges table */}
      <h2 style={{ margin: '0 0 8px', fontSize: '1em', color: '#555', fontWeight: 600 }}>
        Сходы ({match.exchanges.length})
      </h2>
      {match.exchanges.length === 0 ? (
        <p style={{ color: '#aaa', fontSize: '0.9em' }}>Сходов нет</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={TH}>#</th>
              <th style={{ ...TH, color: SIDE1.text, borderTop: `3px solid ${SIDE1.line}` }}>{name1}</th>
              <th style={{ ...TH, color: SIDE2.text, borderTop: `3px solid ${SIDE2.line}` }}>{name2}</th>
              <th style={{ ...TH, textAlign: 'center' }}>Обоюдный</th>
              <th style={TH}>Заметка</th>
              {isInProgress && <th style={TH} />}
            </tr>
          </thead>
          <tbody>
            {match.exchanges.map(e => (
              <ExchangeRow
                key={e.id}
                exchange={e}
                editable={isInProgress}
                onUpdate={data => updateExchangeMut.mutate({ exchangeId: e.id, data })}
                onDelete={() => delExchangeMut.mutate(e.id)}
              />
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 600, background: '#f9f9f9' }}>
              <td style={TD}>Итого</td>
              <td style={{ ...TD, color: SIDE1.text }}>{match.score1}</td>
              <td style={{ ...TD, color: SIDE2.text }}>{match.score2}</td>
              <td style={{ ...TD, textAlign: 'center' }}>{match.doubleHitsCount}</td>
              <td style={TD} colSpan={isInProgress ? 2 : 1} />
            </tr>
          </tfoot>
        </table>
      )}

      {/* Settings */}
      <details style={{ marginTop: 20, fontSize: '0.8em', color: '#888' }}>
        <summary style={{ cursor: 'pointer' }}>Настройки встречи</summary>
        <ul style={{ marginTop: 6 }}>
          <li>Время боя: {totalFightSeconds != null ? `${totalFightSeconds} с` : '—'}</li>
          {/* Те же значения, по которым выше подсвечиваются перелимиты, — иначе
              панель настроек расходилась бы с табло на встрече с `overrides`. */}
          <li>Лимит обоюдных: {match.effectiveMaxDoubles ?? tournament?.defaultMaxDoubles ?? '—'}</li>
          <li>Лимит предупреждений: {match.effectiveMaxWarnings ?? tournament?.defaultMaxWarnings ?? '—'}</li>
        </ul>
      </details>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const SCOREBOARD: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  margin: '0 0 8px',
  padding: '12px 14px',
  border: '1px solid #e0e0e0',
  borderRadius: 8,
  background: '#fafafa',
}

// Блок стороны в шапке и колонка её кнопок. Цвет задаётся на месте (`borderTopColor`
// и `background` из `SIDE1`/`SIDE2`): форма у сторон общая, различает их только
// цвет — и позиция, которая от него не зависит.
//
// Полоса сверху, а не рамка целиком: так блок читается как «шапка стороны» и
// повторяет табло, где над панелью участника идёт такая же полоса.
// Кнопки предупреждений и повторов подписаны фамилией, но подпись читают уже
// после того, как рука пошла к кнопке: цвет здесь работает раньше текста.
const SIDE_BTN: React.CSSProperties = {
  borderWidth: 1,
  borderStyle: 'solid',
  borderRadius: 4,
  padding: '3px 10px',
  cursor: 'pointer',
  background: '#fff',
}

const SIDE_BTN1: React.CSSProperties = { ...SIDE_BTN, color: SIDE1.text, borderColor: SIDE1.border }
const SIDE_BTN2: React.CSSProperties = { ...SIDE_BTN, color: SIDE2.text, borderColor: SIDE2.border }

const SIDE_PANEL: React.CSSProperties = {
  flex: 1,
  padding: '10px 14px',
  borderRadius: 6,
  borderTop: '3px solid transparent',
}

const SCORE_COLUMN: React.CSSProperties = {
  textAlign: 'center',
  padding: '10px 14px',
  borderRadius: 6,
  borderTop: '3px solid transparent',
}

const TH: React.CSSProperties = {
  border: '1px solid #ddd',
  padding: '5px 10px',
  textAlign: 'left',
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

const TD: React.CSSProperties = {
  border: '1px solid #ddd',
  padding: '4px 10px',
}

const ICON_BTN: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: '1em',
  padding: '0 2px',
}

const BTN_SCORE: React.CSSProperties = {
  minWidth: 52,
  padding: '10px 14px',
  fontSize: '1.1em',
  fontWeight: 700,
  borderRadius: 6,
  cursor: 'pointer',
  border: '1px solid #ddd',
  background: '#fff',
}

// Снятие — исправление ошибки, а не основное действие судьи: та же ширина и
// форма, что у «+N», но ниже и красным, чтобы под таймером не промахиваться.
const BTN_SCORE_MINUS: React.CSSProperties = {
  ...BTN_SCORE,
  padding: '6px 14px',
  fontSize: '1em',
  color: '#b3261e',
  borderColor: '#e6c9c6',
  background: '#fff8f7',
}

// Правка времени стоит вплотную к цифрам таймера, поэтому кнопки нарочито
// мелкие: промах по ним дешевле промаха по «Стоп».
const BTN_TIME_ADJUST: React.CSSProperties = {
  padding: '3px 10px',
  fontSize: '0.85em',
  fontWeight: 600,
  borderRadius: 6,
  cursor: 'pointer',
  border: '1px solid #ddd',
  background: '#fff',
  color: '#555',
  fontVariantNumeric: 'tabular-nums',
}

const BTN_PRIMARY: React.CSSProperties = {
  padding: '10px 24px',
  fontSize: '1em',
  fontWeight: 600,
  borderRadius: 6,
  cursor: 'pointer',
  border: 'none',
  background: '#1976d2',
  color: '#fff',
}

const BTN_SECONDARY: React.CSSProperties = {
  padding: '10px 24px',
  fontSize: '1em',
  fontWeight: 600,
  borderRadius: 6,
  cursor: 'pointer',
  border: '1px solid #bbb',
  background: '#fff',
  color: '#333',
}

const BTN_DANGER: React.CSSProperties = {
  padding: '10px 24px',
  fontSize: '1em',
  fontWeight: 600,
  borderRadius: 6,
  cursor: 'pointer',
  border: '1px solid #b3261e',
  background: '#fff',
  color: '#b3261e',
}

const BTN_SUCCESS: React.CSSProperties = {
  padding: '10px 24px',
  fontSize: '1em',
  fontWeight: 600,
  borderRadius: 6,
  cursor: 'pointer',
  border: 'none',
  background: '#2e7d32',
  color: '#fff',
}
