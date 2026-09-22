export type Store<T> = {
  readonly state: Readonly<T>;
  set(patch: Partial<T>): void;
  subscribe(listener: (state: Readonly<T>) => void): () => void;
  dispose(): void;
};

// State applies synchronously; notification is coalesced into one animation frame so a
// busy traffic log cannot force a panel render per request.
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  let frame = 0;
  const listeners = new Set<(state: Readonly<T>) => void>();
  const notify = () => { frame = 0; for (const listener of [...listeners]) listener(state); };
  return {
    get state() { return state; },
    set(patch) {
      let changed = false;
      for (const key of Object.keys(patch) as Array<keyof T>) if (!Object.is(state[key], patch[key])) changed = true;
      if (!changed) return;
      state = { ...state, ...patch };
      if (!frame) frame = requestAnimationFrame(notify);
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { if (frame) cancelAnimationFrame(frame); frame = 0; listeners.clear(); },
  };
}
