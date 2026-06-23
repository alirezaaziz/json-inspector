'use strict';

/**
 * Evaluates a JSONPath expression against a root value.
 * Supported: $ . .. [] [*] .* [n] ['key'] [start:end:step]
 * Returns an array of { value, path } objects, or null on parse error.
 */
function evalJSONPath(root, expr) {
  expr = expr.trim();
  if (!expr.startsWith('$')) return null;

  const results = [];

  function tokenize(e) {
    const toks = [{ t: 'root' }];
    let i = 1;
    while (i < e.length) {
      if (e[i] === '.') {
        if (e[i + 1] === '.') {
          i += 2;
          const s = i;
          while (i < e.length && /[\w$]/.test(e[i])) i++;
          toks.push({ t: 'rec', k: e.slice(s, i) });
        } else {
          i++;
          if (e[i] === '*') { toks.push({ t: 'wild' }); i++; }
          else {
            const s = i;
            while (i < e.length && e[i] !== '.' && e[i] !== '[') i++;
            if (i > s) toks.push({ t: 'child', k: e.slice(s, i) });
          }
        }
      } else if (e[i] === '[') {
        i++;
        if (e[i] === '*') {
          toks.push({ t: 'wild' }); i += 2;
        } else if (e[i] === '"' || e[i] === "'") {
          const q = e[i++], s = i;
          while (i < e.length && e[i] !== q) i++;
          toks.push({ t: 'child', k: e.slice(s, i) }); i += 2;
        } else {
          const s = i;
          while (i < e.length && e[i] !== ']') i++;
          const cont = e.slice(s, i); i++;
          if (cont.includes(':')) {
            const ps = cont.split(':').map(x => x.trim() === '' ? undefined : parseInt(x));
            toks.push({ t: 'slice', s: ps[0], e: ps[1], st: ps[2] });
          } else {
            toks.push({ t: 'idx', i: parseInt(cont) });
          }
        }
      } else {
        i++;
      }
    }
    return toks;
  }

  function go(node, toks, path) {
    if (toks.length === 0) { results.push({ value: node, path }); return; }
    const [tok, ...rest] = toks;

    if (tok.t === 'root') {
      go(root, rest, '$');
    } else if (tok.t === 'child') {
      if (node != null && typeof node === 'object' && tok.k in node)
        go(node[tok.k], rest, pathSeg(path, tok.k, false));
    } else if (tok.t === 'idx') {
      if (Array.isArray(node)) {
        const i = tok.i < 0 ? node.length + tok.i : tok.i;
        if (i >= 0 && i < node.length) go(node[i], rest, path + '[' + i + ']');
      }
    } else if (tok.t === 'wild') {
      if (Array.isArray(node))
        node.forEach((v, i) => go(v, rest, path + '[' + i + ']'));
      else if (node && typeof node === 'object')
        Object.keys(node).forEach(k => go(node[k], rest, pathSeg(path, k, false)));
    } else if (tok.t === 'rec') {
      function descend(n, p) {
        if (Array.isArray(n)) {
          n.forEach((v, i) => {
            go(v, [{ t: 'child', k: tok.k }, ...rest], p + '[' + i + ']');
            descend(v, p + '[' + i + ']');
          });
        } else if (n && typeof n === 'object') {
          Object.entries(n).forEach(([k, v]) => {
            go(v, [{ t: 'child', k: tok.k }, ...rest], pathSeg(p, k, false));
            descend(v, pathSeg(p, k, false));
          });
        }
      }
      descend(node, path);
    } else if (tok.t === 'slice') {
      if (Array.isArray(node)) {
        const len = node.length;
        let s = tok.s ?? 0, e = tok.e ?? len, st = tok.st ?? 1;
        if (s < 0) s = Math.max(0, len + s);
        if (e < 0) e = Math.max(0, len + e);
        e = Math.min(e, len);
        for (let i = s; i < e; i += st) go(node[i], rest, path + '[' + i + ']');
      }
    }
  }

  try {
    go(root, tokenize(expr), '$');
    return results;
  } catch(e) {
    return null;
  }
}
