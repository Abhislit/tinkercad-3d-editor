// Selection is a sorted, unique list of scene indices. Kept as plain index
// arithmetic here so it is independent of the scene and DOM; the app normalises
// after every structural change and derives a single "primary" for the UI.

export function normalizeSelection(indices, sceneLength) {
  const seen = new Set();
  for (const index of indices) {
    if (Number.isInteger(index) && index >= 0 && index < sceneLength) seen.add(index);
  }
  return [...seen].sort((a, b) => a - b);
}

export function toggleSelection(indices, index) {
  return indices.includes(index)
    ? indices.filter((i) => i !== index)
    : [...indices, index].sort((a, b) => a - b);
}

export function primaryIndex(indices) {
  return indices.length ? indices[indices.length - 1] : -1;
}

export function hasIndex(indices, index) {
  return indices.includes(index);
}
