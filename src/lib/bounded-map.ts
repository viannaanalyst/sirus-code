/** Sets `key` as the newest entry and drops the oldest past `limit`, so app-lifetime caches stay small. */
export function remember<K, V>(map: Map<K, V>, key: K, value: V, limit: number) {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value as K);
}
