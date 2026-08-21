/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `Development` | `Production`. Разбор и значение по умолчанию — `src/lib/env.ts`. */
  readonly VITE_APP_ENV?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
