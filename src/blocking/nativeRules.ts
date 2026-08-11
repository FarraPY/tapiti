/** Version de prueba: sin modulo nativo. Solo queda el tipo. */
export type NativeState =
  | { phase: 'unsupported' }
  | { phase: 'idle'; canCompile: boolean; failedBefore: boolean }
  | { phase: 'compiling'; done: number; total: number }
  | { phase: 'ready'; ids: string[] }
  | { phase: 'error'; message: string };
