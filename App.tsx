import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import TournamentsPage from './pages/TournamentsPage'
import TournamentDetailPage from './pages/TournamentDetailPage'
import FightersPage from './pages/FightersPage'
import MatchPage from './pages/MatchPage'
import NotFoundPage from './pages/NotFoundPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<TournamentsPage />} />
          <Route path="tournaments/:id" element={<TournamentDetailPage />} />
          <Route path="fighters" element={<FightersPage />} />
          <Route path="matches/:id" element={<MatchPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
