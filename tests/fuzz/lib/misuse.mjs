// Table-driven API misuse. A recipe names one call with valid arguments; this module derives every hostile variant of
// those arguments (one leaf changed at a time) and checks the contract of docs/ERRORS.md for each:
//
//   refused  -> the thrown value is an EngineError whose code is in the taxonomy and whose message says what was wrong,
//               and the subject's state is byte-identical to the state before the call;
//   accepted -> only for values that are legal for that parameter, and the subject is still healthy afterwards
//               (every number finite, it still steps);
//   never    -> a TypeError or RangeError from deep inside, a WASM trap, a hang, a NaN in the state.
import {writeSync} from 'node:fs';
import {BAD_QUATS, BAD_VECTORS, EXTREME, NON_FINITE, NON_POSITIVE, WRONG_TYPES, describe} from './hostile.mjs';

export const MUST_REJECT = 'must-reject', EITHER = 'either';
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const numericArray = value => (Array.isArray(value) || ArrayBuffer.isView(value)) && value.length > 0 && Array.prototype.every.call(value, n => typeof n === 'number');
const setAt = (root, path, value) => {
  if (path.length === 0) return value;
  const clone = Array.isArray(root) ? [...root] : ArrayBuffer.isView(root) ? Array.from(root) : {...root};
  clone[path[0]] = setAt(root[path[0]], path.slice(1), value);
  return clone;
};

/**
 * Every hostile variant of `args`. `hints` refines what a leaf must refuse:
 *   positive: RegExp over the dotted path of leaves that must be > 0 (sizes, masses, time steps)
 *   handles:  Map from a handle in `args` to the hostile handles that must be refused in its place
 *   lenient:  RegExp over paths where any value may be accepted (free-form user data, callbacks)
 *   integer:  RegExp over paths that must be whole numbers
 *   wide:     RegExp over paths that take any finite double, not only float32 values
 */
export function* mutations(args, hints = {}) {
  const {positive, handles, lenient, integer, optional, wide} = hints;
  function* walk(value, path) {
    const name = path.join('.'), soft = lenient?.test(name) ?? false, verdict = soft ? EITHER : MUST_REJECT;
    // null and undefined stand for "use the default" throughout the API, so each may be accepted wherever a default exists.
    const out = (bad, expect, why) => ({path, name, bad, expect: soft || bad === null || bad === undefined ? EITHER : expect, why, args: setAt(args, path, bad)});
    if (handles?.has(value)) {
      for (const [why, bad] of handles.get(value)) yield out(bad, MUST_REJECT, why);
      for (const bad of [7, 'x', {}, [], {token: 1n}, {token: 'x'}, true]) yield out(bad, MUST_REJECT, 'not a handle');
      // null means "the world" for a joint's body and is refused elsewhere; undefined may be an omitted optional argument.
      yield out(null, EITHER, 'null handle'); yield out(undefined, EITHER, 'missing handle');
      return;
    }
    if (typeof value === 'number') {
      // `wide` paths take any finite double (a seed, a wall-clock time): only NaN and the infinities are refused there.
      for (const bad of NON_FINITE) yield out(bad, Number.isFinite(bad) && wide?.test(name) ? EITHER : verdict, 'not finite or outside float32');
      for (const bad of WRONG_TYPES) yield out(bad, bad === null && optional?.test(name) ? EITHER : verdict, 'not a number');
      // A count of a thousand or a million is legal and only expensive, so it is not tried on counts; absurd counts (1e12 and up) are, and must be refused quickly rather than allocated.
      for (const bad of EXTREME) if (!integer?.test(name) || Math.abs(bad) >= 1e9 || Math.abs(bad) < 1) yield out(bad, EITHER, 'extreme but representable');
      // A tiny positive number is a legal float64: only float32 fields must refuse it.
      for (const bad of NON_POSITIVE) yield out(bad, positive?.test(name) && !(bad > 0 && wide?.test(name)) ? verdict : EITHER, 'zero, negative or below float32');
      if (integer?.test(name)) for (const bad of [0.5, 1.0000001, -2.5, 2 ** 40]) yield out(bad, bad === 2 ** 40 ? EITHER : verdict, 'not a whole number in range');
      yield out(undefined, EITHER, 'missing');
      return;
    }
    if (typeof value === 'bigint') {
      for (const bad of [-1n, 2n ** 64n, 1, 1.5, '1', null, {}, NaN]) yield out(bad, bad === null ? EITHER : verdict, 'not an unsigned 64-bit bigint');
      yield out(undefined, EITHER, 'missing');
      return;
    }
    if (typeof value === 'string') {
      for (const bad of ['nope', '', '__proto__', 'constructor', value.toUpperCase() === value ? value.toLowerCase() : value.toUpperCase(), 7, {}, [], true, Symbol.for('fuzz')]) yield out(bad, verdict, 'not one of the allowed names');
      yield out(null, EITHER, 'null name'); yield out(undefined, EITHER, 'missing');
      return;
    }
    if (typeof value === 'boolean') {
      for (const bad of ['yes', 2, {}, NaN]) yield out(bad, EITHER, 'not a boolean');
      return;
    }
    if (typeof value === 'function') {
      for (const bad of [7, 'x', {}, null]) yield out(bad, EITHER, 'not a function');
      return;
    }
    if (numericArray(value)) {
      const bads = value.length === 3 ? BAD_VECTORS : value.length === 4 ? BAD_QUATS : [[], 'x', 7, null, {}, [NaN], Array.from(value, () => 'a')];
      // Where any finite double is legal (`wide`), a vector of the right length whose numbers are finite is not hostile.
      const legalWide = bad => wide?.test(name) && Array.isArray(bad) && bad.length === value.length && bad.every(n => typeof n === 'number' && Number.isFinite(n));
      for (const bad of bads) yield out(bad, (bad === null && optional?.test(name)) || legalWide(bad) ? EITHER : verdict, 'wrong shape or content');
      if (value.length === 4) yield out([0, 0, 0, 0], EITHER, 'zero quaternion'); // the bridge may normalise or refuse
      for (let i = 0; i < Math.min(value.length, 8); i++) {
        const leaf = [...path, i], label = `${name}.${i}`, softLeaf = soft || (lenient?.test(label) ?? false), leafVerdict = softLeaf ? EITHER : MUST_REJECT;
        for (const bad of [NaN, Infinity, -Infinity, 1e39, 'a', {}]) yield {path: leaf, name: label, bad, expect: bad === 1e39 && wide?.test(label) ? EITHER : leafVerdict, why: 'element is not a finite float32', args: setAt(args, leaf, bad)};
        for (const bad of NON_POSITIVE) yield {path: leaf, name: label, bad, expect: positive?.test(name) && !softLeaf ? MUST_REJECT : EITHER, why: 'element zero, negative or below float32', args: setAt(args, leaf, bad)};
        for (const bad of EXTREME) if (!integer?.test(label) || Math.abs(bad) >= 1e9 || Math.abs(bad) < 1) yield {path: leaf, name: label, bad, expect: EITHER, why: 'element extreme but representable', args: setAt(args, leaf, bad)};
      }
      if (value.length > 8) { // long lists: truncated, and a hostile element at the far end
        yield out(Array.from(value).slice(0, value.length - 1), EITHER, 'one element short');
        for (const bad of [NaN, Infinity, 1e39, 'a']) yield {path: [...path, value.length - 1], name: `${name}.${value.length - 1}`, bad, expect: bad === 1e39 && wide?.test(name) ? EITHER : verdict, why: 'last element is not a finite float32', args: setAt(args, [...path, value.length - 1], bad)};
      }
      yield out(undefined, EITHER, 'missing');
      return;
    }
    if (Array.isArray(value)) {
      for (const bad of ['x', 7, {}, true]) yield out(bad, verdict, 'not a list');
      yield out(null, EITHER, 'null list'); yield out([], EITHER, 'empty list'); yield out(undefined, EITHER, 'missing');
      for (let i = 0; i < Math.min(value.length, 3); i++) yield* walk(value[i], [...path, i]);
      if (value.length > 0) for (const bad of [null, 7, 'x', undefined]) yield {path: [...path, 0], name: `${name}.0`, bad, expect: verdict, why: 'list item of the wrong kind', args: setAt(args, [...path, 0], bad)};
      return;
    }
    if (isPlain(value)) {
      if (path.length > 0) {
        for (const bad of ['x', 7, true, [], () => 1]) yield out(bad, verdict, 'not an object');
        yield out(null, EITHER, 'null object'); yield out(undefined, EITHER, 'missing');
      }
      for (const key of Object.keys(value)) yield* walk(value[key], [...path, key]);
      return;
    }
    // Opaque values (class instances, typed-array payloads handled above, symbols): replaced wholesale.
    for (const bad of [null, undefined, 7, 'x', {}, []]) yield out(bad, EITHER, 'opaque value replaced');
  }
  for (let i = 0; i < args.length; i++) yield* walk(args[i], [i]);
}

/**
 * Run every mutation of one recipe against a subject.
 *   subject.digest()  -> string naming the whole state (compared before and after a refused call)
 *   subject.restore() -> put the baseline state back after an accepted call
 *   subject.health()  -> throws when the state holds a non-finite number or the subject cannot continue
 *   isEngineError, codes: the taxonomy
 * Returns {tried, refused, accepted, failures[]}; the caller asserts failures is empty.
 */
export function runRecipe(recipe, subject, taxonomy) {
  const failures = [], counts = {tried: 0, refused: 0, accepted: 0};
  let base = subject.digest();
  for (const mutation of mutations(recipe.args(), recipe.hints)) {
    counts.tried++;
    const label = `${recipe.name}(${mutation.name || 'arg'} = ${describe(mutation.bad)}) [${mutation.why}]`;
    // FUZZ_TRACE=1 names each call before it runs: the last line printed is the call that hung or trapped.
    if (process.env.FUZZ_TRACE) try { writeSync(2, `${label}\n`); } catch { /* a full pipe must not fail the test */ }
    let thrown, returned;
    try { returned = recipe.call(...mutation.args); } catch (error) { thrown = error ?? new Error('threw a nullish value'); }
    if (thrown) {
      counts.refused++;
      const problem = taxonomy.problem(thrown);
      if (problem) failures.push(`${label}: ${problem}`);
      let after; try { after = subject.digest(); } catch (error) { after = `digest threw ${error?.message}`; }
      if (after !== base) { failures.push(`${label}: refused with ${thrown.code ?? thrown.name} but the state changed`); subject.restore(); base = subject.digest(); }
    } else {
      counts.accepted++;
      if (mutation.expect === MUST_REJECT) failures.push(`${label}: accepted, must be refused`);
      else try { recipe.undo?.(returned); subject.health(); } catch (error) { failures.push(`${label}: accepted and left the subject unhealthy: ${error?.message}`); }
      try { subject.restore(); base = subject.digest(); } catch (error) { failures.push(`${label}: could not restore the baseline afterwards: ${error?.message}`); }
    }
    if (failures.length > 200) break;
  }
  return {...counts, failures};
}
