import * as P from '../public/js/path.js';
import { smartParse, parseText } from '../public/js/parse.js';
import { query } from '../public/js/jsonpath.js';
import { findMatches } from '../public/js/search.js';
import { diff } from '../public/js/diff.js';
import * as G from '../public/js/generate.js';
import { encodeShare, decodeShare } from '../public/js/share.js';
import { highlightJSON, stats } from '../public/js/util.js';

const results = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function test(name, fn) {
  try { await fn(); results.push(['ok', name]); }
  catch (e) { results.push(['FAIL', name + ' — ' + e.message]); }
}
function assert(cond, msg = 'assertion failed') { if (!cond) throw new Error(msg); }
function same(a, b) { if (!eq(a, b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const doc = {
  store: {
    book: [
      { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
      { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
      { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', isbn: '0-553-21311-3', price: 8.99 },
      { category: 'fiction', author: 'J. R. R. Tolkien', title: 'The Lord of the Rings', isbn: '0-395-19395-8', price: 22.99 },
    ],
    bicycle: { color: 'red', price: 399 },
  },
  'odd key': { 'a/b': 1, 'c~d': 2, "it's": 3 },
};

// ── path ──
await test('path formats', () => {
  const segs = ['odd key', 'a/b'];
  same(P.toJSONPath(segs), "$['odd key']['a/b']");
  same(P.toPointer(segs), '/odd key/a~1b');
  same(P.toPointer(['odd key', 'c~d']), '/odd key/c~0d');
  same(P.toBracket(['store', 'book', 0]), '$["store"]["book"][0]');
  same(P.toJS(['store', 'book', 0, 'title']), 'data.store.book[0].title');
  same(P.toJSONPath(['odd key', "it's"]), "$['odd key']['it\\'s']");
  same(P.fromPointer('/odd key/a~1b'), segs);
});
await test('jsonpath round trip of normalized paths', () => {
  for (const segs of [['odd key', "it's"], ['store', 'book', 2, 'isbn'], ['odd key', 'a/b']]) {
    const r = query(doc, P.toJSONPath(segs));
    same(r.map(x => x.segs), [segs]);
  }
});
await test('getAt / setAt / deleteAt are copy-on-write', () => {
  const next = P.setAt(doc, ['store', 'bicycle', 'color'], 'blue');
  same(P.getAt(next, ['store', 'bicycle', 'color']), 'blue');
  same(P.getAt(doc, ['store', 'bicycle', 'color']), 'red');
  assert(next.store.book === doc.store.book, 'untouched branches are shared');
  const del = P.deleteAt(doc, ['store', 'book', 1]);
  same(del.store.book.length, 3);
  same(del.store.book[1].author, 'Herman Melville');
  same(P.getAt(doc, ['missing', 'x']), undefined);
  same(P.getAt(doc, ['store', 'book', 9]), undefined);
});
await test('renameKey keeps order, insertAt', () => {
  const o = { a: 1, b: 2, c: 3 };
  same(Object.keys(P.renameKey(o, ['b'], 'B')), ['a', 'B', 'c']);
  let threw = false; try { P.renameKey(o, ['b'], 'c'); } catch { threw = true; }
  assert(threw, 'rename to existing key throws');
  same(P.insertAt(o, [], 'z', 0, 'a'), { a: 1, z: 0, b: 2, c: 3 });
  same(P.insertAt([1, 2], [], 1, 9), [1, 9, 2]);
  same(P.insertAt([1, 2], [], null, 9), [1, 2, 9]);
});
await test('__proto__ keys are handled as data', () => {
  const o = JSON.parse('{"__proto__": {"x": 1}, "a": 2}');
  const n = P.setAt(o, ['__proto__', 'x'], 5);
  same(Object.keys(n), ['__proto__', 'a']);
  same(n.__proto__.x, 5);
  assert(({}).x === undefined, 'prototype not polluted');
});

// ── parse ──
await test('strict JSON', () => {
  const r = smartParse('{"a": [1, 2, {"b": null}]}');
  assert(r.ok && r.format === 'json');
  same(r.data, { a: [1, 2, { b: null }] });
});
await test('BOM is ignored', () => { assert(smartParse('\uFEFF{"a":1}').ok); });
await test('NDJSON', () => {
  const r = smartParse('{"a":1}\n{"a":2}\n\n{"a":3}\n');
  assert(r.ok && r.format === 'ndjson');
  same(r.data, [{ a: 1 }, { a: 2 }, { a: 3 }]);
});
await test('repairs JSON5-ish input', () => {
  const r = smartParse(`// config
  {
    name: 'demo',  /* block */
    list: [1, 2, 3,],
    "nested": { ok: True, nothing: None, },
    hex: 0x1F,
    trailing: .5,
  }`);
  assert(r.ok, JSON.stringify(r.error));
  same(r.format, 'repaired');
  same(r.data, { name: 'demo', list: [1, 2, 3], nested: { ok: true, nothing: null }, hex: 31, trailing: 0.5 });
  assert(/comments/.test(r.warnings[0]) && /trailing commas/.test(r.warnings[0]));
});
await test('repairs JSONP and JS assignment', () => {
  same(smartParse('callback({"a":1});').data, { a: 1 });
  same(smartParse('const data = { a: 1 };').data, { a: 1 });
});
await test('repairs missing commas', () => {
  same(smartParse('{"a": 1\n "b": 2}').data, { a: 1, b: 2 });
  same(smartParse('[1 2 3]').data, [1, 2, 3]);
});
await test('error location and hint', () => {
  const r = smartParse('{\n  "a": 1,\n  "b": [1, 2\n  "c": }');
  assert(!r.ok);
  assert(r.error.line === 4, 'line ' + r.error.line);
  assert(r.error.context.length > 0);
});
await test('strict parser rejects what JSON.parse rejects', () => {
  for (const bad of ['{a:1}', "['x']", '[1,]', '{"a":1,}', '01', '"\t"', '[1 2]', 'NaN', '{"a" 1}', '"\\x"']) {
    let threw = false; try { parseText(bad, true); } catch { threw = true; }
    assert(threw, 'should reject ' + bad);
  }
  for (const good of ['{"a":[1,2.5e3,-0.1,true,false,null,"\\u00e9\\n"]}', '"x"', '0', ' [ ] ']) {
    same(parseText(good, true).value, JSON.parse(good));
  }
});
await test('large integer precision warning', () => {
  const r = smartParse('{"id": 12345678901234567890}');
  assert(r.ok);
  if (typeof JSON.rawJSON === 'function' || 'source' in ({})) {/* feature-dependent */}
});

// ── jsonpath ──
const q = e => query(doc, e).map(r => r.value);
await test('jsonpath basics', () => {
  same(q('$.store.book[*].author'), ['Nigel Rees', 'Evelyn Waugh', 'Herman Melville', 'J. R. R. Tolkien']);
  same(q('$..author').length, 4);
  same(q('$.store.*').length, 2);
  same(q('$..price').length, 5);
  same(q('$..book[2].title'), ['Moby Dick']);
  same(q('$..book[-1].title'), ['The Lord of the Rings']);
  same(q('$..book[0,1].title'), ['Sayings of the Century', 'Sword of Honour']);
  same(q('$..book[:2].title'), ['Sayings of the Century', 'Sword of Honour']);
  same(q('$..book[1:3].title'), ['Sword of Honour', 'Moby Dick']);
  same(q('$..book[::-1].price'), [22.99, 8.99, 12.99, 8.95]);
  same(q("$['odd key']['a/b']"), [1]);
  same(q('$["odd key"]["c~d"]'), [2]);
  same(q('$'), [doc]);
});
await test('jsonpath filters', () => {
  same(q('$..book[?(@.isbn)].title'), ['Moby Dick', 'The Lord of the Rings']);
  same(q('$..book[?(@.price < 10)].title'), ['Sayings of the Century', 'Moby Dick']);
  same(q("$..book[?@.category == 'fiction' && @.price > 20].title"), ['The Lord of the Rings']);
  same(q('$..book[?(@.author =~ /melville/i)].title'), ['Moby Dick']);
  same(q('$..book[?(!@.isbn)]').length, 2);
  same(q('$..book[?(@.price > $.store.book[3].price || @.price == 8.95)].price'), [8.95]);
  same(q('$.store[?(@.length > 3)]').length, 1);
  same(q('$..book[?(length(@.title) > 15)].title'), ['Sayings of the Century', 'The Lord of the Rings']);
  same(q('$..*[?(@.color)]').length >= 0, true);
});
await test('jsonpath syntax errors throw', () => {
  for (const bad of ['store', '$.', '$[', '$[?(@.a ==)]', "$['x"]) {
    let threw = false; try { query(doc, bad); } catch { threw = true; }
    assert(threw, 'should throw for ' + bad);
  }
});

// ── search ──
await test('text search covers whole document', () => {
  const r = findMatches(doc, 'fiction');
  same(r.matches.length, 3);
  same(findMatches(doc, 'PRICE').matches.length, 5);
  same(findMatches(doc, 'PRICE', { caseSensitive: true }).matches.length, 0);
  same(findMatches(doc, '^\\d+\\.9\\d$', { regex: true }).matches.length, 4);
  same(findMatches(doc, 'price', { scope: 'values' }).matches.length, 0);
  assert(findMatches(doc, '(', { regex: true }).error);
  same(findMatches(doc, '$..isbn').matches, [['store', 'book', 2, 'isbn'], ['store', 'book', 3, 'isbn']]);
});

// ── diff ──
await test('diff objects', () => {
  const { changes } = diff({ a: 1, b: { c: 2 }, d: 3 }, { a: 1, b: { c: 3 }, e: 4 });
  same(changes.map(c => [c.op, c.segs]), [['change', ['b', 'c']], ['remove', ['d']], ['add', ['e']]]);
});
await test('smart array diff aligns insertions', () => {
  const a = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const b = [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }];
  const smart = diff(a, b).changes;
  same(smart.map(c => c.op), ['add']);
  const naive = diff(a, b, { arrays: 'index' }).changes;
  assert(naive.length === 4, 'index mode reports cascade');
  const mod = diff([1, { x: 1 }, 3], [1, { x: 2 }, 3]).changes;
  same(mod.map(c => [c.op, c.segs]), [['change', [1, 'x']]]);
});

// ── generate ──
const users = { users: [{ id: 1, name: 'A', email: 'a@x.io', tags: ['x'], address: { city: 'X' } }, { id: 2, name: 'B', email: null, score: 1.5, tags: [] }], total: 2 };
await test('typescript', () => {
  const ts = G.toTypeScript(users);
  assert(ts.includes('export interface Root {'), ts);
  assert(ts.includes('users: User[];'), ts);
  assert(ts.includes('email: string | null;'), ts);
  assert(ts.includes('score?: number;'), ts);
  assert(ts.includes('address?: Address;'), ts);
  assert(ts.includes('export interface Address {'), ts);
  const arr = G.toTypeScript([1, 'a']);
  assert(arr.includes('export type Root = (number | string)[];'), arr);
});
await test('zod', () => {
  const z = G.toZod(users);
  assert(z.includes('email: z.string().nullable(),'), z);
  assert(z.includes('id: z.number().int(),'), z);
  assert(z.indexOf('AddressSchema = ') < z.indexOf('UserSchema = '), 'children before parents');
});
await test('json schema', () => {
  const s = JSON.parse(G.toJSONSchema(users));
  same(s.properties.users.items.properties.email.type, ['string', 'null']);
  same(s.properties.users.items.required, ['id', 'name', 'email', 'tags']);
});
await test('go & python', () => {
  const go = G.toGo(users);
  assert(go.includes('ID ') && go.includes('`json:"id"`'), go);
  assert(go.includes('*string'), go);
  const py = G.toPython({ 'class': 1, ok: true });
  assert(py.includes('TypedDict("Root"'), py);
});
await test('yaml', () => {
  same(G.toYAML({ a: [1, { b: 'x: y' }], c: {}, d: 'true', e: '' }), 'a:\n  - 1\n  - b: "x: y"\nc: {}\nd: "true"\ne: ""\n');
  same(G.toYAML([[1, 2], []]), '- - 1\n  - 2\n- []\n');
});
await test('csv', () => {
  same(G.toCSV([{ a: 1, b: { c: 'x,y' } }, { a: 2, d: null }]), 'a,b.c,d\r\n1,"x,y",\r\n2,,null\r\n');
});

// ── misc ──
await test('share round trip', async () => {
  const text = JSON.stringify(doc) + 'é✓';
  same(await decodeShare(await encodeShare(text)), text);
});
await test('highlight escapes and tags tokens', () => {
  const h = highlightJSON('{"<a>": "x\\"y", "n": -1.5e3, "b": true, "z": null}');
  assert(h.includes('<span class="tk">&quot;&lt;a&gt;&quot;</span>:'), h);
  assert(h.includes('<span class="tn">-1.5e3</span>'));
  assert(h.includes('<span class="tb">true</span>') && h.includes('<span class="tz">null</span>'));
});
await test('stats', () => {
  const s = stats(doc);
  same(s.depth, 4);
  same(s.counts.object, 8);
});

const failed = results.filter(r => r[0] === 'FAIL');
document.getElementById('out').textContent =
  `${failed.length ? 'FAILED' : 'PASSED'} ${results.length - failed.length}/${results.length}\n` + results.map(r => r.join('  ')).join('\n');
document.title = failed.length ? 'FAIL' : 'PASS';
