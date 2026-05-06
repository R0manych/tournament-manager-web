import { Link, Outlet } from 'react-router-dom'

export default function Layout() {
  return (
    <div>
      <nav style={{ padding: '12px 24px', borderBottom: '1px solid #ddd', display: 'flex', gap: '24px' }}>
        <Link to="/">Турниры</Link>
        <Link to="/fighters">Бойцы</Link>
      </nav>
      <main style={{ padding: '24px' }}>
        <Outlet />
      </main>
    </div>
  )
}
