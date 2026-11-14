declare module '*.css';

/** Image assets bundled by Vite: the import is the served URL. */
declare module '*.webp' {
  const src: string;
  export default src;
}
