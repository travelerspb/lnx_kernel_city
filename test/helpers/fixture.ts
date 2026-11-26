import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EventFile } from '../../src/core/fixtureSource';

export const FIXTURE_PATH = fileURLToPath(new URL('../fixtures/cold-warm-read.events.json', import.meta.url));

export function loadFixture(): EventFile {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as EventFile;
}
