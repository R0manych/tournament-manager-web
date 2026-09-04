// Draft → Scheduled (бои сгенерированы, группы заблокированы) → Active (бои идут)
export type TournamentStatus = 'Draft' | 'Scheduled' | 'Active' | 'Completed' | 'Cancelled'
// DoubleLoss — двойное техническое поражение (АР-16): победителя нет, обоим
// засчитывается поражение, счёт и ячейка сетки сохраняются. Это не ничья.
export type MatchStatus =
  | 'Scheduled'
  | 'InProgress'
  | 'Completed'
  | 'Cancelled'
  | 'WalkoverWin'
  | 'DoubleLoss'
export type ParticipantKind = 'Fighter' | 'Team'

export interface Fighter {
  id: string
  firstName: string
  lastName: string
  club?: string
  city?: string
  birthDate?: string
  createdAt: string
}

// ── Polymorphic tournament participant ──────────────────────────────────────
// kind === 'Fighter' → `fighter` is populated (singles tournament).
// kind === 'Team'    → `team` is populated (team tournament).
export interface FighterParticipantInfo {
  firstName: string
  lastName: string
  club?: string
}

export interface TeamParticipantInfo {
  name: string
  club?: string
  city?: string
}

export interface TournamentParticipant {
  participantId: string
  kind: ParticipantKind
  fighter?: FighterParticipantInfo
  team?: TeamParticipantInfo
  seed?: number
  registeredAt: string
}

// Status wording is user-facing in several places (tournament header, format
// freeze warnings) — keep one map so they never drift apart.
export const TOURNAMENT_STATUS_LABELS: Record<TournamentStatus, string> = {
  Draft: 'Черновик (настройка)',
  Scheduled: 'Бои сгенерированы',
  Active: 'Бои идут',
  Completed: 'Завершён',
  Cancelled: 'Отменён',
}

// Display helpers — single source of truth for rendering a participant label.
export function participantName(p: TournamentParticipant): string {
  if (p.kind === 'Team') return p.team?.name ?? p.participantId.slice(0, 8)
  return p.fighter ? `${p.fighter.firstName} ${p.fighter.lastName}` : p.participantId.slice(0, 8)
}

// Short label for compact contexts (bracket cells, match navigation).
export function participantShortName(p: TournamentParticipant): string {
  if (p.kind === 'Team') return p.team?.name ?? p.participantId.slice(0, 8)
  return p.fighter?.lastName ?? p.participantId.slice(0, 8)
}

export function participantClub(p: TournamentParticipant): string | undefined {
  return p.kind === 'Team' ? p.team?.club : p.fighter?.club
}

export interface Tournament {
  id: string
  name: string
  description?: string
  nomination?: string
  location?: string
  startDate: string
  endDate: string
  status: TournamentStatus
  participantKind: ParticipantKind
  defaultRoundDurationSeconds?: number
  defaultMaxDoubles?: number
  defaultMaxWarnings?: number
  defaultTeamTargetScore?: number
  defaultTeamBoutDurationSeconds?: number
  createdAt: string
  participants: TournamentParticipant[]
  matchesCount: number
}

// ── Ристалище (АР-17, docs/09) ──────────────────────────────────────────────
// Площадка, на которой физически идут бои. Заводится внутри турнира; турнир на
// одной площадке не заводит ни одного — это основной сценарий, а не деградация
// (§3.3), поэтому весь UI ристалищ обязан работать при пустом списке.
export interface Piste {
  id: string
  tournamentId: string
  name: string
  orderIndex: number
  createdAt: string
  // Что занимает площадку прямо сейчас. Считает сервер (§5.1), чтобы UI не
  // собирал занятость из полного списка встреч турнира.
  currentMatchId?: string
  currentEncounterId?: string
}

export interface Exchange {
  id: string
  sequence: number
  roundNumber: number
  points1: number
  points2: number
  isDoubleHit: boolean
  note?: string
  createdAt: string
}

// ── Bracket placement (B-5, docs/08) ────────────────────────────────────────
// Which cell of the format a match occupies. The pair of participants is no
// longer an identifier: the same two can meet again in the playoff, in the LB,
// in the grand final and in its reset. A cell holds at most one match and a
// match stands in at most one cell (инвариант 43).
export interface MatchPlacementRef {
  phaseId: string
  roundId: string    // rounds[].id, системный id SE, grandFinal(Reset), round{N} swiss, метка группы RR
  slotIndex: number  // >= 0, номер ячейки внутри раунда (сверху вниз)
}

export interface MatchPlacement extends MatchPlacementRef {
  matchId: string
}

export interface Match {
  id: string
  tournamentId: string
  fighter1Id: string
  fighter2Id?: string  // null/absent = bye (auto-win for fighter1, no opponent)
  scheduledAt?: string
  status: MatchStatus
  score1: number
  score2: number
  warnings1: number
  warnings2: number
  // Запрошенные видеоповторы. Лимита нет ни на встрече, ни в формате — счётчик
  // только считает, регламент турнира решает, сколько повторов положено стороне.
  videoReplays1: number
  videoReplays2: number
  doubleHitsCount: number
  winnerId?: string
  roundDurationSeconds?: number
  maxDoubles?: number
  maxWarnings?: number
  effectiveRoundDurationSeconds?: number
  effectiveMaxDoubles?: number
  effectiveMaxWarnings?: number
  // Team-tournament bout fields (null for singles matches):
  encounterId?: string
  boutNumber?: number            // 1..9, or 10 for the tie-break bout
  targetCumulativeScore?: number // 5×boutNumber for 1..9; null for tie-break
  // Ристалище. У боута собственный `pisteId` всегда пуст (инвариант 54) —
  // площадку задаёт его серия, поэтому показывать и фильтровать надо по
  // `effectivePisteId` (= pisteId ?? encounter.pisteId). `pisteName` — подпись
  // эффективного ристалища, чтобы табло и списки не делали второй запрос.
  pisteId?: string
  effectivePisteId?: string
  pisteName?: string
  startedAt?: string
  currentRoundNumber: number
  currentRoundStartedAt?: string
  endedAt?: string
  createdAt: string
  exchanges: Exchange[]
  // Ячейка сетки, если встреча в ней стоит. Отсутствует у ручных встреч и у
  // турниров, созданных до размещений (инвариант 46).
  placement?: MatchPlacement
}

// ── Teams (team tournaments only) ───────────────────────────────────────────
export interface TeamMember {
  fighterId: string
  firstName: string
  lastName: string
  club?: string
  position: number   // 1..3
  addedAt: string
}

export interface Team {
  id: string
  tournamentId: string
  name: string
  club?: string
  city?: string
  createdAt: string
  members: TeamMember[]
}

// ── Encounter (team series of 9 bouts + optional tie-break) ─────────────────
export interface Encounter {
  id: string
  tournamentId: string
  participant1Id: string   // Team.Id
  participant2Id: string   // Team.Id
  scheduledAt?: string
  status: MatchStatus
  targetTotalScore: number
  boutDurationSeconds: number
  // Серия занимает площадку целиком, от первого боута до tie-break (§3.2):
  // назначается она, боуты наследуют.
  pisteId?: string
  pisteName?: string
  score1: number           // computed aggregate from bouts
  score2: number
  winnerParticipantId?: string
  priorityParticipantId?: string   // tie-break advantage holder (set by server)
  requiresTieBreak: boolean
  startedAt?: string
  endedAt?: string
  createdAt: string
  bouts: Match[]
}

// Tournament format
export interface TournamentFormat {
  formatVersion: string
  name: string
  description?: string
  participantsKind?: ParticipantKind
  defaults: {
    roundDurationSeconds?: number
    maxDoubles?: number
    maxWarnings?: number
  }
  participants: {
    count: number
    seeding: 'ranked' | 'random'
  }
  team?: {
    size: number
    targetTotalScore?: number
    boutDurationSeconds?: number
  }
  phases: Array<{
    id: string
    name: string
    type: 'roundRobin' | 'singleElimination' | 'doubleElimination' | 'swiss'
    [key: string]: unknown
  }>
}

// Request bodies
export interface CreateTournamentRequest {
  name: string
  description?: string
  nomination?: string
  location?: string
  startDate: string
  endDate: string
  participantKind?: ParticipantKind
  defaultRoundDurationSeconds?: number
  defaultMaxDoubles?: number
  defaultMaxWarnings?: number
  defaultTeamTargetScore?: number
  defaultTeamBoutDurationSeconds?: number
}

export type UpdateTournamentRequest = CreateTournamentRequest

export interface CreateFighterRequest {
  firstName: string
  lastName: string
  club?: string
  city?: string
  birthDate?: string
}

export type UpdateFighterRequest = CreateFighterRequest

export interface CreateMatchRequest {
  fighter1Id: string
  fighter2Id?: string  // omit for a bye — backend auto-completes as a win for fighter1
  scheduledAt?: string
  roundDurationSeconds?: number
  maxDoubles?: number
  maxWarnings?: number
  // Ячейка сетки. Занятая ячейка → 409: на этом держится идемпотентность
  // генерации плейофф (docs/08 §8).
  placement?: MatchPlacementRef
}

export interface AddExchangeRequest {
  roundNumber: number
  points1: number
  points2: number
  isDoubleHit: boolean
  note?: string
}

// ── Team / Encounter request bodies ─────────────────────────────────────────
export interface CreateTeamRequest {
  name: string
  club?: string
  city?: string
}

export interface AddTeamMemberRequest {
  fighterId: string
  position: number   // 1..3
}

export interface CreateEncounterRequest {
  participant1Id: string
  participant2Id: string
  scheduledAt?: string
  targetTotalScore?: number
  boutDurationSeconds?: number
}

export interface CreateTieBreakRequest {
  participant1Id: string   // Fighter.Id from team 1
  participant2Id: string   // Fighter.Id from team 2
}

// ── Ристалища ───────────────────────────────────────────────────────────────
export interface CreatePisteRequest {
  name: string
  orderIndex?: number   // по умолчанию — следующий свободный
}

export interface UpdatePisteRequest {
  name: string
  orderIndex: number
}

// Частичное обновление встречи (`PATCH /matches/{id}`). Тело заменяет блок
// настроек целиком, поэтому назначение ристалища обязано передать текущие
// настройки как есть — иначе они обнулятся (спека §8.1, п. 5). Явный `null` в
// `pisteId` снимает назначение (инвариант 58), поэтому поле не optional.
export interface AssignPisteRequest {
  scheduledAt?: string | null
  roundDurationSeconds?: number | null
  maxDoubles?: number | null
  maxWarnings?: number | null
  pisteId: string | null
}
