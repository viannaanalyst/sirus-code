// Run from the repository root: node src/components/arc/demo/verify-previews.mjs
// This catches missing catalog registrations and invalid render-time component APIs.
import console from 'node:console';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { ArcPreview, previews } = await server.ssrLoadModule('/src/components/arc/demo/previews.tsx');
  const entries = JSON.parse(fs.readFileSync('src/components/arc/catalog.json', 'utf8')).components;
  assert.equal(entries.length, 100);
  assert.ok(entries.every(entry => entry.tier === 'free'));
  assert.deepEqual(Object.keys(previews).sort(), entries.map(entry => entry.name).sort());
  for (const { name } of entries) {
    assert.ok(renderToString(createElement(ArcPreview, { name })).length > 0, `${name} renders`);
  }
  console.log(`Catalog coverage and real server renders: ${entries.length}/${entries.length} passed`);
} finally {
  await server.close();
}
