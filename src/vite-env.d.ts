/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the local service. Defaults to http://localhost:5055 in builds. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
