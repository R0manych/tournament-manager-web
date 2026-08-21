import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { BOARD_VIEWS, boardPath, type BoardView } from './boardViews'

/**
 * Клавиши переключения экранов табло: 1..5 — прямо на экран, ← → — по кругу.
 * Оператор стоит у машины с проектором, где мышь обычно неудобна.
 *
 * Модификаторы игнорируются: Ctrl+1 и Alt+← — это переключение вкладок и
 * «назад» в браузере, перехватывать их у оператора нельзя.
 */
export function useBoardNav(tournamentId: string | undefined, current: BoardView): void {
  const navigate = useNavigate()

  useEffect(() => {
    if (!tournamentId) return

    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return

      if (e.key >= '1' && e.key <= String(BOARD_VIEWS.length)) {
        navigate(boardPath(tournamentId, BOARD_VIEWS[Number(e.key) - 1].view))
        return
      }

      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const idx = BOARD_VIEWS.findIndex(v => v.view === current)
        const step = e.key === 'ArrowRight' ? 1 : -1
        const next = (idx + step + BOARD_VIEWS.length) % BOARD_VIEWS.length
        navigate(boardPath(tournamentId, BOARD_VIEWS[next].view))
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tournamentId, current, navigate])
}
