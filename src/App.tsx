import { lazy, Suspense } from 'react'
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

// Экраны зала — отдельным чанком. Машина у проектора грузит только табло, а не
// весь код организатора: на слабом ноутбуке и гостевом Wi-Fi это разница между
// «открылось к первому бою» и «открывается».
const DisplayMatchPage = lazy(() => import('./pages/DisplayMatchPage'))
const DisplayPistePage = lazy(() => import('./pages/DisplayPistePage'))
const DisplayTournamentPage = lazy(() => import('./pages/DisplayTournamentPage'))
const DisplayBoardPage = lazy(() => import('./pages/DisplayBoardPage'))

// Заставка на время подгрузки чанка — на чёрном фоне табло, а не на белом
// листе: иначе экран в зале моргает белым при каждом открытии.
const BoardLoading = (
  <div style={{
    position: 'fixed', inset: 0, background: '#0d0f14', color: '#6b7280',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3vh',
  }}>
    Загрузка…
  </div>
)

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={BoardLoading}>
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
      </Suspense>
    </BrowserRouter>
  )
}
