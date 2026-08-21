// Окружение приложения. Источник один на весь проект — переменная `APP_ENV`
// в `.env` рядом с compose-файлом. Оттуда она раздаётся:
//   API   — как `ASPNETCORE_ENVIRONMENT` (штатный механизм ASP.NET Core,
//           им же включается Scalar/OpenAPI в Program.cs);
//   фронт — как build-arg `VITE_APP_ENV` (Vite отдаёт только переменные с
//           префиксом `VITE_`).
//
// ВАЖНО, иначе будет сюрприз на проде: Vite подставляет переменные **на
// сборке**, а не в рантайме. Собранный образ web уже содержит своё значение
// внутри бандла, и правка `.env` на сервере его не изменит — `.env` там влияет
// только на API. Готовый образ из GHCR собирается скриптом релиза с
// `VITE_APP_ENV=Production`; чтобы получить сборку в режиме разработки, её
// надо собрать самому (`docker compose build frontend` при `APP_ENV=Development`)
// либо запускать `npm run dev`.

export type AppEnv = 'Development' | 'Production'

const raw = import.meta.env.VITE_APP_ENV?.trim()

export const appEnv: AppEnv = raw
  // Всё, что не «development», считаем продом: незнакомое значение (опечатка,
  // «staging») должно прятать тестовые кнопки, а не показывать их.
  ? (raw.toLowerCase() === 'development' ? 'Development' : 'Production')
  // Переменной нет вовсе: `npm run dev` — разработка, `npm run build` — прод.
  : (import.meta.env.PROD ? 'Production' : 'Development')

export const isProduction = appEnv === 'Production'
export const isDevelopment = !isProduction
