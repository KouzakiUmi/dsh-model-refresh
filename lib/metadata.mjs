/** Merge exact-ID metadata without turning an approximate source into availability evidence. */
const present = value => Object.fromEntries(Object.entries(value ?? {}).filter(([, field]) => field !== undefined && field !== null));
export function combineMetadata(primary = {}, fallback = {}) {
  const models = Object.create(null), sources = Object.create(null);
  for (const [id, model] of Object.entries(fallback)) { models[id] = model; sources[id] = 'litellm'; }
  for (const [id, model] of Object.entries(primary)) {
    const secondary = fallback[id];
    models[id] = secondary ? { ...secondary, ...present(model),
      limit: { ...present(secondary.limit), ...present(model.limit) },
      modalities: { ...present(secondary.modalities), ...present(model.modalities) } } : model;
    sources[id] = 'models.dev';
  }
  return { models, sources };
}
