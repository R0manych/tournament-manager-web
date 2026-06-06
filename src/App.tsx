import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import TournamentsPage from './pages/TournamentsPage'
import TournamentCreatePage from './pages/TournamentCreatePage'
import TournamentDetailPage from './pages/TournamentDetailPage'
import TournamentMatchesPage from './pages/TournamentMatchesPage'
import FightersPage from './pages/FightersPage'
import MatchPage from './pages/MatchPage'
import EncounterPage from './pages/EncounterPage'
import NotFoundPage from './pages/NotFoundPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<TournamentsPage />} />
          <Route path="admin/tournaments/new" element={<TournamentCreatePage />} />
          <Route path="tournaments/:id" element={<TournamentDetailPage />} />
          <Route path="tournaments/:id/matches" element={<TournamentMatchesPage />} />
          <Route path="fighters" element={<FightersPage />} />
          <Route path="matches/:id" element={<MatchPage />} />
          <Route path="encounters/:id" element={<EncounterPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
