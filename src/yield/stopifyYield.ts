const noArrows = require('babel-plugin-transform-es2015-arrow-functions');

import { stopifyFunction, stopifyPrint } from '../interfaces/stopifyInterface'
import * as makeBlockStmt from '../common/makeBlockStmt';
import * as transformMarked from '../common/transformMarked';
import { transform, Options } from '../common/helpers';
import * as handleNew from './handleNew';
import * as yieldPass from './yield';
import * as pAssign from './prototypeAssign'
import * as evalHandler from '../common/evalHandler';
import * as mCall from './nameMethodCall'
import * as fs from 'fs';
import * as path from 'path'

const hofImpl = fs.readFileSync(
  path.join(__dirname, '../common/hofImplementations.js')).toString();

const plugins = [
  [noArrows, evalHandler],
  [handleNew, makeBlockStmt], [mCall], [yieldPass],
  [transformMarked, pAssign, ]
];

const fplugins = [
  [noArrows, evalHandler],
  [handleNew, makeBlockStmt], [mCall], [yieldPass],
  [transformMarked, /*pAssign,*/ ]
];

const knowns = ['Object',
  'Boolean',
  'Symbol',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'Number',
  'Math',
  'Date',
  'String',
  'RegExp',
  'Array',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet'];

// The runtime needs to be stored as a string to allow for client-side
// compilation.
const yieldRuntime = `
/*
 * The runtime is wrapped in a funtion:
 * function($isStop, $onStop, $onDone, $interval).
 * The output of the yield transform expects $counter to be defined.
 */
const $yieldCounter = $interval;
let $counter = 0;
function $mark_func(f) {
  f.$isTransformed = true;
  Object.defineProperty(f.prototype, "constructor", {
    value: f.prototype.constructor, writable: true
  });
  return f;
};

function $runYield(gen, res = { done: false, value: undefined }) {
  setTimeout(_ => {
    if ($isStop()) {
      return $onStop();
    }
    res = gen.next();
    if (res.done) {
      return $onDone(res.value);
    }
    else {
      return $runYield(gen, res);
    }
  }, 0)
};

const $generatorPrototype = (function*(){}).prototype;
function $proto_assign(rhs) {
  let proto = Object.create(rhs)
  proto.next = $generatorPrototype.next;
  proto.throw = $generatorPrototype.throw;
  proto.return = $generatorPrototype.return;
  proto[Symbol.iterator] = $generatorPrototype[Symbol.iterator]
  return proto;
}

const $GeneratorConstructor = Object.getPrototypeOf(function*(){}).constructor

const $knownBuiltInts = [${knowns.toString()}]
function *$handleNew(constr, ...args) {
  if($knownBuiltInts.includes(constr) || !constr.$isTransformed) {
    return new constr(...args);
  } else {
    let a = Object.create(constr.prototype);
    yield* constr.apply(a, args)
    return a;
  }
}
$mark_func($handleNew)
`

const includeRuntime =
  `const $__yield__runtime__ = require('${__dirname}/stopifyYield');
   const $compile_string = $__yield__runtime__.yieldEvalString;
   const $compile_func = $__yield__runtime__.yieldEvalFunction;`

// This assumes that program has been wrapped in a function called $runProg.
const runProg = `$runYield($runProg())`

export const yieldStopifyPrint: stopifyPrint = (code, opts) => {
  const hofCode = `${hofImpl};\n${code}`
  const transformedData = transform(hofCode, plugins, opts);
  const transformed: string = transformedData[0]

  if(transformed.length < code.length) {
    throw new Error('Transformed code is smaller than original code')
  }

  return `
  function $stopifiedProg($isStop, $onStop, $onDone, $interval) {
    ${yieldRuntime}
    ${transformedData[1] ? includeRuntime.toString() : ""}
    function *$runProg() {
      ${transformed}
    }
    $runYield($runProg())
  }
  `
}

// This function is used by the regenerator based transform.
export function yieldStopifyRegen(code: string, opts: Options): [string, boolean] {
  const transformedData = transform(code, plugins, opts);
  const transformed: string = transformedData[0]

  if(transformed.length < code.length) {
    throw new Error('Transformed code is smaller than original code')
  }

  return [`
  ${yieldRuntime}
  function *$runProg() {
    ${transformed}
  }
  $runYield($runProg())
  `, transformedData[1]]
}

export function yieldEvalString(
  code: string, opts: Options = {debug: false, optimize: false}): string {
  const wrapped = `(function (){ ${code} })()`
  const intermediate: string = transform(wrapped, plugins, opts)[0];
  // NOTE(rachit): This assumes that the output starts with `yield*`
  const transformed = intermediate.substring(6, intermediate.length)

  if(transformed.length < wrapped.length) {
    throw new Error('Transformed code is smaller than original code')
  }

  return transformed
}

export function yieldEvalFunction(
  name: string, body: string, args: string[],
  opts: Options = {debug: false, optimize: false}): string {
    const wrapped = `function ${name}(${args.join(',')}) { ${body} }`
    const intermediate: string = transform(wrapped, fplugins, opts)[0];
    if(intermediate.length < wrapped.length) {
      throw new Error('Transformed code is smaller than original code')
    }
    const transformed = `(function *() { return ${intermediate}})()`
    console.log(transformed)
    return transformed;
  }

export const yieldStopify: stopifyFunction = (code, opts) => {
  return eval(`
    (function() {
      return (${yieldStopifyPrint(code, opts)});
    })()
  `)
}
