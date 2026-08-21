// Экраны табло для зала и их адреса. Отдельный модуль от компонентов: на них
// ссылаются и карточка турнира, и сами экраны, и хук навигации.
//
// Экран адресуется URL-ом, а не сообщением из канала `zettel-display`: табло
// переживает F5, работает при закрытом пульте и не зависит от того, что
// показывает соседнее ристалище. Канал остаётся только для боя (`show`/`timer`).

export type BoardView = 'match' | 'info' | 'list' | 'groups' | 'bracket'

/** Порядок — он же порядок клавиш 1..5 и обхода стрелками. */
export const BOARD_VIEWS: Array<{ view: BoardView; label: string; path: string }> = [
  { view: 'match', label: 'Бой', path: '' },
  { view: 'info', label: 'Заставка', path: '/info' },
  { view: 'list', label: 'Участники', path: '/list' },
  { view: 'groups', label: 'Группы', path: '/groups' },
  { view: 'bracket', label: 'Сетка', path: '/bracket' },
]

export function boardPath(tournamentId: string, view: BoardView): string {
  const item = BOARD_VIEWS.find(v => v.view === view) ?? BOARD_VIEWS[0]
  return `/display/tournament/${tournamentId}${item.path}`
}
