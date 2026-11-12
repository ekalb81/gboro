import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestFileName, messageText, digestFileText, getAccessToken, gmailClient, htmlToText } from '../scripts/gmail.mjs';
import { parseDigest } from '../scripts/lib.mjs';

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const ITEM =
  'ITEM | news | Guilford County Animal Shelter pauses cat intake to Nov. 25 | Guilford County Animal Shelter | 980 Guilford College Road, Greensboro | n/a | n/a | https://greensborojournal.com/guilford-county-animal-shelter-cat-intake-paused/ | Greensboro Journal Newsroom | news | Nov 10, 2026 | yes';

const multipart = {
  id: 'abc123',
  internalDate: String(Date.parse('2026-11-11T18:10:10Z')),
  payload: {
    mimeType: 'multipart/alternative',
    headers: [{ name: 'Subject', value: 'Greensboro update — 1 new item — Wed Nov 11, 12:52 PM EST' }],
    parts: [
      { mimeType: 'text/plain', body: { data: b64url(`Hi Blake — one new item (café, “quotes”).\n\n${ITEM}\n`) } },
      { mimeType: 'text/html', body: { data: b64url('<p>ignored</p>') } },
    ],
  },
};

test('names files by received UTC minute, like the hand-saved digests', () => {
  assert.equal(digestFileName(Date.parse('2026-11-11T19:02:54Z')), '2026-11-11T1902Z');
  assert.equal(digestFileName('1794406020000'), '2026-11-11T1407Z');
  assert.throws(() => digestFileName('nope'));
});

test('prefers the plain-text part and decodes UTF-8', () => {
  const text = messageText(multipart);
  assert.match(text, /café, “quotes”/);
  assert.ok(text.includes(ITEM));
});

test('falls back to stripped HTML when there is no plain-text part', () => {
  const htmlOnly = { payload: { mimeType: 'text/html', body: { data: b64url(`<div>Hi&nbsp;Blake</div><p>${ITEM.replace(/&/g, '&amp;')}</p>`) } } };
  const text = messageText(htmlOnly);
  assert.match(text, /^Hi Blake/);
  assert.ok(text.split('\n').includes(ITEM));
  assert.equal(htmlToText('a<br>b &amp; c'), 'a\nb & c');
});

test('saved file parses with the existing digest parser', () => {
  const file = digestFileText(multipart);
  assert.match(file, /^Subject: Greensboro update/);
  assert.match(file, /^Received: 2026-11-11T18:10:10Z$/m);
  const { items, problems } = parseDigest(file, '2026-11-11T1810Z');
  assert.equal(problems.length, 0);
  assert.equal(items.length, 1);
  assert.equal(items[0].venue, 'Guilford County Animal Shelter');
});

test('token refresh and paginated listing use the Gmail REST API', async () => {
  const calls = [];
  const fakeFetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const u = new URL(url);
    if (u.host === 'oauth2.googleapis.com') return Response.json({ access_token: 'tok' });
    if (u.pathname.endsWith('/messages') && !u.searchParams.get('pageToken'))
      return Response.json({ messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'p2' });
    if (u.pathname.endsWith('/messages')) return Response.json({ messages: [{ id: 'c' }] });
    return new Response('nope', { status: 404 });
  };
  const token = await getAccessToken({ clientId: 'i', clientSecret: 's', refreshToken: 'r' }, fakeFetch);
  assert.equal(token, 'tok');
  const ids = await gmailClient(token, fakeFetch).listMessageIds('subject:"Greensboro update"');
  assert.deepEqual(ids, ['a', 'b', 'c']);
  assert.equal(calls[1].opts.headers.authorization, 'Bearer tok');
  assert.equal(new URL(calls[1].url).searchParams.get('q'), 'subject:"Greensboro update"');
});

test('a failed token refresh says why', async () => {
  const fakeFetch = async () => Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 });
  await assert.rejects(getAccessToken({ clientId: 'i', clientSecret: 's', refreshToken: 'r' }, fakeFetch), /expired or revoked/);
});
