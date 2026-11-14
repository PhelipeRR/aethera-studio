/** Keeps preference patches in order so slower IPC responses cannot overwrite newer changes. */
export function createSerializedNeuraSettingsUpdater<TPatch extends object, TResult>(
  update: (patch: TPatch) => Promise<TResult>,
): (patch: TPatch) => Promise<TResult> {
  let pending = Promise.resolve();
  return (patch) => {
    const result = pending.then(() => update(patch));
    pending = result.then(() => undefined, () => undefined);
    return result;
  };
}
