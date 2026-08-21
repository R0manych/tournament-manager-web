// Общий каркас табло для зала: экран, шапка, автомасштаб содержимого, подсказка
// по клавишам. Всё read-only — ни одной мутации (АР-14).
//
// Список экранов и их адреса — в `boardViews.ts`, переключение клавишами — в
// `useBoardNav.ts`.

import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Tournament } from '../../api/types'
import { MUTED, SCREEN } from './boardStyle'
import { BOARD_VIEWS, boardPath, type BoardView } from './boardViews'

export function BoardScreen({ children }: { children: React.ReactNode }) {
  return <div style={SCREEN}>{children}</div>
}

/**
 * Шапка: турнир и номинация слева, название экрана справа. Номинация — это то,
 * что зритель ищет глазами в первую очередь («а это какое оружие?»), поэтому
 * она не мельче названия турнира, а только тише по цвету.
 */
export function BoardHeader({
  tournament,
  section,
}: {
  tournament: Tournament | undefined
  section: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: '2vw',
        padding: '2.5vh 3vw 1.5vh',
        borderBottom: '1px solid #1c2130',
        flex: '0 0 auto',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '3.4vh', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {tournament?.name ?? ''}
        </div>
        {tournament?.nomination && (
          <div style={{ fontSize: '2.6vh', color: MUTED, marginTop: '0.4vh' }}>
            {tournament.nomination}
          </div>
        )}
      </div>
      <div style={{ fontSize: '2.4vh', color: MUTED, letterSpacing: 2, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
        {section}
      </div>
    </div>
  )
}

/**
 * Содержимое, вписанное в отведённую область целиком — без прокрутки, которую
 * в зале некому крутить.
 *
 * Меряем натуральный размер при `scale(1)` и уменьшаем ровно настолько, чтобы
 * влезло по обеим осям. Увеличивать не пытаемся: раздутая на полэкрана сетка из
 * двух пар выглядит сломанной, а не крупной. Пересчёт — на изменение размера
 * области (`ResizeObserver`) и на смену `refit` (данные приехали или менялись).
 */
export function FitBox({
  children,
  refit,
  align = 'center',
}: {
  children: React.ReactNode
  /** Любое значение, меняющееся вместе с содержимым. */
  refit?: unknown
  align?: 'center' | 'start'
}) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return

    const fit = () => {
      // Мерить трансформированный узел нельзя — сначала возвращаем масштаб 1.
      inner.style.transform = 'scale(1)'
      const availableW = outer.clientWidth
      const availableH = outer.clientHeight
      const neededW = inner.scrollWidth
      const neededH = inner.scrollHeight
      if (!availableW || !availableH || !neededW || !neededH) return
      const next = Math.min(1, (availableW * 0.98) / neededW, (availableH * 0.98) / neededH)
      // Пишем и напрямую: если значение не изменилось, React не перерисует, и
      // в узле остался бы измерительный `scale(1)`.
      inner.style.transform = `scale(${next})`
      setScale(next)
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(outer)
    window.addEventListener('resize', fit)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [refit])

  return (
    <div
      ref={outerRef}
      style={{
        flex: '1 1 auto',
        minHeight: 0,
        overflow: 'hidden',
        display: 'flex',
        justifyContent: 'center',
        alignItems: align === 'center' ? 'center' : 'flex-start',
        padding: '2vh 2vw',
      }}
    >
      <div
        ref={innerRef}
        style={{
          // Обязательно, иначе всё ломается: без `flex: 0 0 auto` внутренний
          // блок — обычный flex-элемент и ужимается до ширины экрана ЕЩЁ ДО
          // измерения. `scrollWidth` тогда возвращает уже сдавленную раскладку,
          // масштаб остаётся 1, а колонки наезжают друг на друга. Нам нужен
          // натуральный размер: сначала разложить как есть, потом уменьшить
          // целиком через `scale`. `max-content` — то же самое по ширине.
          flex: '0 0 auto',
          width: 'max-content',
          maxWidth: 'none',
          transformOrigin: align === 'center' ? 'center center' : 'top center',
          transform: `scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  )
}

/** Подсказка по клавишам — мелко, внизу, чтобы оператор не гадал. */
export function BoardNavHint({ tournamentId, current }: { tournamentId: string; current: BoardView }) {
  return (
    <div
      style={{
        flex: '0 0 auto',
        display: 'flex',
        gap: '1.4vw',
        justifyContent: 'center',
        padding: '1vh 0 1.6vh',
        fontSize: '1.5vh',
        color: '#4b5265',
      }}
    >
      {BOARD_VIEWS.map((v, i) => (
        <Link
          key={v.view}
          to={boardPath(tournamentId, v.view)}
          style={{
            color: v.view === current ? '#c8cede' : '#4b5265',
            textDecoration: 'none',
            letterSpacing: 1,
          }}
        >
          {i + 1} · {v.label}
        </Link>
      ))}
    </div>
  )
}

/** Экран без данных: «формат не загружен», «состав не сохранён» и подобное. */
export function BoardNotice({ text }: { text: string }) {
  return (
    <div style={{ margin: 'auto', color: MUTED, fontSize: '3vh', textAlign: 'center', padding: '0 6vw' }}>
      {text}
    </div>
  )
}
