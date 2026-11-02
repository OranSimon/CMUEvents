import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicQuery } from '../src/lib/fetcher.mjs';

const endpoint = 'https://community.cmu.edu/s/sfsites/aura';
const body = (descriptor = 'apex://CommunityEventTileController/ACTION$getEventStartDate', token = 'null') => new URLSearchParams({
  message: JSON.stringify({ actions: [{ descriptor, callingDescriptor: 'markup://c:Community_Event_Tile', params: { eventId: 'a7D000000000001' } }] }),
  'aura.token': token, 'aura.pageURI': '/s/events',
}).toString();

test('anonymous event-clock queries have a bounded, explicit read-only transport', () => {
  assert.doesNotThrow(() => validatePublicQuery(endpoint, body()));
  for (const [url, form] of [
    ['https://other.example/s/sfsites/aura', body()],
    ['https://community.cmu.edu/s/login', body()],
    ['https://user:password@community.cmu.edu/s/sfsites/aura', body()],
    [endpoint, body('apex://EventFilterController/ACTION$register')],
    [endpoint, body('apex://EventFilterController/ACTION$getEvents')],
    [endpoint, body(undefined, 'private-token')],
    [endpoint, 'message=not-json'],
    [endpoint, `${body()}&aura.token=private-token`],
    [endpoint, `${body()}&message=%7B%7D`],
  ]) assert.throws(() => validatePublicQuery(url, form));
});
