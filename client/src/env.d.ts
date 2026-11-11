/** Vite дозволяє імпортувати css як побічний ефект — для tsc це треба оголосити. */
declare module "*.css";

/**
 * Vite підставляє import.meta.env під час збірки. Оголошуємо лише ті
 * поля, якими справді користуємось: повний тип приїхав би з
 * vite/client, а це потягнуло б у перевірку весь пакет Vite.
 */
interface ImportMetaEnv {
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
