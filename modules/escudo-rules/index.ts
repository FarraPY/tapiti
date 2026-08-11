import { requireOptionalNativeModule } from 'expo';

/**
 * Puente al módulo nativo de bloqueo (Fase 2).
 *
 * `requireOptionalNativeModule` devuelve null cuando el módulo no está compilado
 * dentro de la app — que es el caso en Expo Go. Por eso todo esto es opcional: la
 * app sigue funcionando con el bloqueo por JavaScript mientras no exista una
 * versión compilada, y no hay dos caminos que mantener.
 */
type Native = {
  compile(identifier: string, json: string): Promise<boolean>;
  load(identifier: string): Promise<boolean>;
  stored(): Promise<string[]>;
  remove(identifier: string): Promise<boolean>;
  /** Devuelve los identificadores que no estaban cargados. */
  applyTo(viewTag: number, identifiers: string[]): Promise<string[]>;
  clearFrom(viewTag: number): Promise<boolean>;
};

const native = requireOptionalNativeModule<Native>('EscudoRules');

/** ¿Esta versión de la app tiene el bloqueo nativo? En Expo Go, no. */
export const hasNativeBlocking = native != null;

export async function compile(identifier: string, json: string): Promise<boolean> {
  if (!native) return false;
  return native.compile(identifier, json);
}

export async function load(identifier: string): Promise<boolean> {
  if (!native) return false;
  return native.load(identifier);
}

export async function stored(): Promise<string[]> {
  if (!native) return [];
  return native.stored();
}

export async function remove(identifier: string): Promise<boolean> {
  if (!native) return false;
  return native.remove(identifier);
}

export async function applyTo(viewTag: number, identifiers: string[]): Promise<string[]> {
  if (!native) return identifiers;
  return native.applyTo(viewTag, identifiers);
}

export async function clearFrom(viewTag: number): Promise<boolean> {
  if (!native) return false;
  return native.clearFrom(viewTag);
}
