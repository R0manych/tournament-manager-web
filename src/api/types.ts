export type TournamentStatus = 'Draft' | 'Active' | 'Completed' | 'Cancelled'
export type MatchStatus = 'Scheduled' | 'InProgress' | 'Completed' | 'Cancelled'
export type MatchStage = 'Pool' | 'RoundOf16' | 'QuarterFinal' | 'SemiFinal' | 'Final' | 'ThirdPlace'

export interface Fighter {
  id: string
  firstName: string
  lastName: string
  club?: string
  city?: string
  birthDate?: string
  createdAt: string
}

export interface TournamentParticipant {
  fighterId: string
  firstName: string
  lastName: string
  club?: string
  seed?: number
  registeredAt: string
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
  defaultRoundDurationSeconds?: number
  defaultRoundsPerMatch?: number
  defaultMaxDoubles?: number
  defaultMaxWarnings?: number
  createdAt: string
  participants: TournamentParticipant[]
  matchesCount: number
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

export interface Match {
  id: string
  tournamentId: string
  fighter1Id: string
  fighter2Id: string
  stage: MatchStage
  scheduledAt?: string
  status: MatchStatus
  score1: number
  score2: number
  warnings1: number
  warnings2: number
  doubleHitsCount: number
  winnerId?: string
  roundDurationSeconds?: number
  totalRounds?: number
  maxDoubles?: number
  maxWarnings?: number
  effectiveRoundDurationSeconds?: number
  effectiveTotalRounds?: number
  effectiveMaxDoubles?: number
  effectiveMaxWarnings?: number
  startedAt?: string
  currentRoundNumber: number
  currentRoundStartedAt?: string
  endedAt?: string
  createdAt: string
  exchanges: Exchange[]
}

// Tournament format
export interface TournamentFormat {
  formatVersion: string
  name: string
  description?: string
  defaults: {
    roundDurationSeconds?: number
    roundsPerMatch?: number
    maxDoubles?: number
    maxWarnings?: number
  }
  participants: {
    count: number
    seeding: 'ranked' | 'random'
  }
  phases: Array<{
    id: string
    name: string
    type: 'roundRobin' | 'singleElimination' | 'doubleElimination'
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
  defaultRoundDurationSeconds?: number
  defaultRoundsPerMatch?: number
  defaultMaxDoubles?: number
  defaultMaxWarnings?: number
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
  fighter2Id: string
  stage: MatchStage
  scheduledAt?: string
  roundDurationSeconds?: number
  totalRounds?: number
  maxDoubles?: number
  maxWarnings?: number
}

export interface AddExchangeRequest {
  roundNumber: number
  points1: number
  points2: number
  isDoubleHit: boolean
  note?: string
}
