'use strict';

/**
 * Tiny glob matcher supporting: *, **, and exact segment matching.
 * Covers the small set of patterns we use in protected paths and is far
 * lighter than pulling in a full glob library. Not a general-purpose glob.
 */
function minimatch(str, pattern) {
  return matchSegments(str.split('/'), pattern.split('/'));
}

function matchSegments(strParts, patParts) {
  for (let i = 0; i < patParts.length; i++) {
    const pat = patParts[i];
    const seg = strParts[i];

    if (pat === '**') {
      const rest = patParts.slice(i + 1);
      if (rest.length === 0) return true; // ** at end matches everything left
      for (let j = i; j <= strParts.length; j++) {
        if (matchSegments(strParts.slice(j), rest)) return true;
      }
      return false;
    }

    if (seg === undefined) return false;

    if (!matchSegment(seg, pat)) return false;
  }
  return strParts.length === patParts.length;
}

function matchSegment(seg, pat) {
  return toRegex(pat).test(seg);
}

function toRegex(pat) {
  let src = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '*') {
      src += '[^/]*';
    } else {
      src += escapeRegex(c);
    }
  }
  return new RegExp('^' + src + '$');
}

function escapeRegex(c) {
  return /[.+^${}()|[\]\\?]/.test(c) ? '\\' + c : c;
}

module.exports = { minimatch };
