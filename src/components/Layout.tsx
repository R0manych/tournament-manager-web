import { Link, Outlet } from 'react-router-dom'

export default function Layout() {
  return (
    <div>
      <nav style={{ position: 'relative', padding: '8px 24px', borderBottom: '1px solid #ddd', display: 'flex', gap: '24px', alignItems: 'center', minHeight: '72px' }}>
        <Link to="/">Турниры</Link>
        <Link to="/fighters">Бойцы</Link>
        <Link to="/" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center' }}>
          <img src="/logo.png" alt="Zettel — турнир начинается с регламента" style={{ height: '64px' }} />
        </Link>
      </nav>
      <main style={{ padding: '24px' }}>
        <Outlet />
      </main>
    </div>
  )
}
