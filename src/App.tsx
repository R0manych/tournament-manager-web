import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import TournamentsPage from './pages/TournamentsPage'
import TournamentCreatePage from './pages/TournamentCreatePage'
import TournamentDetailPage from './pages/TournamentDetailPage'
import TournamentMatchesPage from './pages/TournamentMatchesPage'
import FightersPage from './pages/FightersPage'
import MatchPage from './pages/MatchPage'
import EncounterPage from './pages/EncounterPage'
import DisplayMatchPage from './pages/DisplayMatchPage'
import DisplayPistePage from './pages/DisplayPistePage'
import DisplayTournamentPage from './pages/DisplayTournamentPage'
import DisplayBoardPage from './pages/DisplayBoardPage'
import NotFoundPage from './pages/NotFoundPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Табло для зала — вне <Layout>: ни шапки, ни навигации (АР-14). */}
        <Route path="display/match/:id" element={<DisplayMatchPage />} />
        {/* Табло площадки (АР-17): показывает бой, идущий на этом ристалище, и
            очередь этой же площадки — за оператором не следует. */}
        <Route path="display/piste/:id" element={<DisplayPistePage />} />
        <Route path="display/tournament/:id" element={<DisplayTournamentPage />} />
        {/* Остальные экраны зала. Адрес — источник истины: табло переживает F5
            и не зависит от того, открыт ли пульт (переключение — клавиши 1–5). */}
        <Route path="display/tournament/:id/info" element={<DisplayBoardPage view="info" />} />
        <Route path="display/tournament/:id/list" element={<DisplayBoardPage view="list" />} />
        <Route path="display/tournament/:id/groups" element={<DisplayBoardPage view="groups" />} />
        <Route path="display/tournament/:id/bracket" element={<DisplayBoardPage view="bracket" />} />
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
