/**
 * Small namespaced logger that can be silenced centrally if the app ever needs
 * less verbose diagnostics in production.
 */
export function createLogger(scope: string) {
  const prefix = `[save-sora:${scope}]`;

  return {
    debug: (...args: unknown[]) => console.debug(prefix, ...args),
    info: (...args: unknown[]) => console.info(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args)
  };
}
