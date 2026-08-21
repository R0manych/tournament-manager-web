// Палитра табло. Экран смотрят из зала с нескольких метров, поэтому фон тёмный,
// а цвета участников — единственный источник цвета на экране.
//
// Стороны закреплены: участник 1 — синий слева, участник 2 — красный справа.
// Тот же порядок, что на карточке боя у организатора, чтобы судья за пультом и
// зал видели бойцов на одних и тех же сторонах.

export interface SideColor {
  label: string
  /** Цвет счёта и акцентов стороны. */
  text: string
  /** Полоса над панелью. */
  line: string
  /** Заливка панели, уходящая в фон. */
  wash: string
}

export const BLUE: SideColor = {
  label: 'Синий',
  text: '#6ea8ff',
  line: '#2563eb',
  wash: 'rgba(37, 99, 235, 0.22)',
}

export const RED: SideColor = {
  label: 'Красный',
  text: '#ff7b72',
  line: '#dc2626',
  wash: 'rgba(220, 38, 38, 0.22)',
}

export const MUTED = '#8b93a7'

export const SCREEN: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  background: '#0b0d12',
  color: '#f5f7fa',
  fontFamily: 'system-ui, "Segoe UI", Roboto, sans-serif',
  overflow: 'hidden',
}
