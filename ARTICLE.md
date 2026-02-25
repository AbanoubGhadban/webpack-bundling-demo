# How Webpack Bundles Your Code: A Deep Dive with Readable Output

You write `import { add } from './math.js'`. Webpack turns it into something unreadable. What actually happens in between?

This article walks through a real bundler that works exactly like webpack internally, but uses human-readable names. Instead of `__webpack_require__`, you'll see `loadModule`. Instead of `__webpack_modules__`, you'll see `moduleRegistry`. Same mechanics, readable output.

By the end, you'll understand every line webpack produces.

---

## The Source Code

Here's our starting point — a small app with static and dynamic imports:

```js
// index.js — the entry point
import { add, PI } from './utils/math.js';
import greet, { farewell } from './utils/greet.js';

console.log("PI is:", PI);
console.log("2 + 3 =", add(2, 3));
console.log(greet("World"));
console.log(farewell("World"));

// These load on demand — code splitting
document.getElementById("btn-a").addEventListener("click", () => {
  import('./feature-a.js').then(mod => {
    mod.runFeatureA();
  });
});

document.getElementById("btn-b").addEventListener("click", () => {
  import('./feature-b.js').then(mod => {
    mod.runFeatureB();
  });
});
```

```js
// utils/math.js
export function add(a, b) {
  return a + b;
}

export function subtract(a, b) {
  return a - b;
}

export const PI = 3.14159;
```

```js
// utils/greet.js
export default function greet(name) {
  return `Hello, ${name}!`;
}

export function farewell(name) {
  return `Goodbye, ${name}!`;
}
```

```js
// shared-utils.js — used by BOTH feature-a and feature-b
export function formatResult(label, value) {
  return `[${label}]: ${value}`;
}

export function logResult(label, value) {
  console.log(formatResult(label, value));
}
```

```js
// feature-a.js — loaded on demand
import { logResult } from './shared-utils.js';

export function runFeatureA() {
  logResult("Feature A", "loaded and running!");
  return "Feature A result";
}
```

```js
// feature-b.js — loaded on demand
import { logResult } from './shared-utils.js';

export function runFeatureB() {
  logResult("Feature B", "loaded and running!");
  return "Feature B result";
}
```

The bundler produces four files:

| File | What's in it |
|------|-------------|
| `main.js` | index.js + math.js + greet.js + the entire runtime |
| `shared_src_shared-utils_js.js` | shared-utils.js (extracted because both features use it) |
| `src_feature-a_js.js` | feature-a.js only |
| `src_feature-b_js.js` | feature-b.js only |

Let's see how it builds each piece.

---

## Part 1: The Module Factory Pattern

The core idea is simple: **wrap every source file in a function**.

Your file `utils/math.js` becomes this factory function:

```js
"./src/utils/math.js": (module, exports, loadModule) => {
    loadModule.markAsESModule(exports);

    loadModule.defineExports(exports, {
        "add": () => add,
        "subtract": () => subtract,
        "PI": () => PI
    });

    function add(a, b) {
      return a + b;
    }

    function subtract(a, b) {
      return a - b;
    }

    const PI = 3.14159;
},
```

Three things happened:

1. **The `export` keyword was removed.** `export function add(...)` became plain `function add(...)`.
2. **A `defineExports` call was added at the top.** This tells the runtime "this module exposes `add`, `subtract`, and `PI`."
3. **The function receives three parameters**: `module`, `exports`, and `loadModule`. These are injected by the runtime when the factory executes.

The module ID is the file path: `"./src/utils/math.js"`. That's how other modules reference it.

### Why Getters Instead of Direct Assignment?

Look at the `defineExports` call closely:

```js
loadModule.defineExports(exports, {
    "add": () => add,
    "PI": () => PI
});
```

Each export is a **getter function** — `() => add`, not just `add`. Here's the implementation:

```js
loadModule.defineExports = function(exports, definition) {
  for (var key in definition) {
    if (loadModule.hasOwnProp(definition, key) && !loadModule.hasOwnProp(exports, key)) {
      Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
    }
  }
};
```

It uses `Object.defineProperty` with a `get` function. So when another module reads `exports.PI`, it actually calls `() => PI` and returns the current value of `PI`.

Why bother? Because the ES module spec requires **live bindings**. Consider:

```js
// counter.js
export let count = 0;
export function increment() { count++; }

// app.js
import { count, increment } from './counter.js';
console.log(count);    // 0
increment();
console.log(count);    // Must be 1, not 0
```

If `exports.count` were set directly to `0` at module execution time, the second `console.log` would still print `0`. With a getter (`() => count`), it reads the live variable each time, so it correctly returns `1`.

This is the fundamental difference between CommonJS (snapshot) and ES modules (live binding), and it's why webpack uses `Object.defineProperty`.

---

## Part 2: How Imports Are Transformed

Your import:

```js
import { add, PI } from './utils/math.js';
import greet, { farewell } from './utils/greet.js';
```

Becomes:

```js
var _utils_math_ = loadModule("./src/utils/math.js");
var _utils_greet_ = loadModule("./src/utils/greet.js");
```

The `import` declaration is removed entirely. In its place, a call to `loadModule()` fetches the module's exports object and stores it in a local variable.

Then every reference to an imported name is replaced with a property access:

| Source | Bundled | Why |
|--------|---------|-----|
| `PI` | `_utils_math_.PI` | Named export → property access |
| `add(2, 3)` | `(0, _utils_math_.add)(2, 3)` | Called function → `(0, fn)()` pattern |
| `greet("World")` | `(0, _utils_greet_["default"])("World")` | Default export → `["default"]` property |
| `farewell("World")` | `(0, _utils_greet_.farewell)("World")` | Named export, called → `(0, fn)()` pattern |

Here's the full transformed entry module:

```js
"./src/index.js": (module, exports, loadModule) => {
    loadModule.markAsESModule(exports);

    var _utils_math_ = loadModule("./src/utils/math.js");
    var _utils_greet_ = loadModule("./src/utils/greet.js");

    console.log("PI is:", _utils_math_.PI);
    console.log("2 + 3 =", (0, _utils_math_.add)(2, 3));
    console.log((0, _utils_greet_["default"])("World"));
    console.log((0, _utils_greet_.farewell)("World"));

    document.getElementById("btn-a").addEventListener("click", () => {
      loadChunk("src_feature-a_js")
        .then(loadModule.bind(loadModule, "./src/feature-a.js"))
        .then(mod => {
          mod.runFeatureA();
        });
    });

    document.getElementById("btn-b").addEventListener("click", () => {
      loadChunk("src_feature-b_js")
        .then(loadModule.bind(loadModule, "./src/feature-b.js"))
        .then(mod => {
          mod.runFeatureB();
        });
    });
},
```

### The `(0, fn)()` Pattern

When you call `add(2, 3)`, the bundler can't just produce `_utils_math_.add(2, 3)`. Here's why:

```js
// This is a method call — `this` points to _utils_math_
_utils_math_.add(2, 3)  // this === _utils_math_  ← WRONG

// But the original code had `add(2, 3)` as a plain function call
add(2, 3)  // this === undefined (strict mode)  ← CORRECT
```

In ES modules (which are always strict mode), calling a function should have `this === undefined`. But accessing a function through an object and calling it makes `this` point to that object.

The fix is the comma operator:

```js
(0, _utils_math_.add)(2, 3)  // this === undefined  ← CORRECT
```

The comma operator `(0, expr)` evaluates `expr` and returns it, but **detaches** it from the object context. The result is a plain function reference, so calling it sets `this` to `undefined`.

This is a real pattern in webpack's output. Look at any webpack bundle and you'll see `(0, _module__WEBPACK_IMPORTED_MODULE_0__.someFunction)(args)`.

### When NOT to Replace an Identifier

The transformer needs to be careful. If you imported a name `add`, not every `add` in the file should be replaced. The transformer skips:

- **Object property keys**: `{ add: 1 }` — don't touch `add`
- **Member expression properties**: `obj.add` — don't touch `add`
- **Variable declarations**: `const add = ...` — don't touch `add`
- **Function parameters**: `function(add) { ... }` — don't touch `add`
- **Function/class declaration names**: `function add() {}` — don't touch `add`

Only free references to the identifier get replaced. This is determined by walking the AST and checking each identifier's parent node.

---

## Part 3: The Runtime — `loadModule()` and the Cache

All the module factories are stored in a registry object:

```js
var moduleRegistry = {
  "./src/index.js": (module, exports, loadModule) => { ... },
  "./src/utils/math.js": (module, exports, loadModule) => { ... },
  "./src/utils/greet.js": (module, exports, loadModule) => { ... },
};
```

When code calls `loadModule("./src/utils/math.js")`, the runtime looks up this registry, executes the factory, and returns the exports:

```js
var moduleCache = {};

function loadModule(moduleId) {
  // 1. Check the cache — if already loaded, return cached exports
  var cachedModule = moduleCache[moduleId];
  if (cachedModule !== undefined) {
    return cachedModule.exports;
  }

  // 2. Create a new module object and cache it BEFORE execution
  var module = moduleCache[moduleId] = {
    exports: {}
  };

  // 3. Execute the factory — this populates module.exports
  moduleRegistry[moduleId](module, module.exports, loadModule);

  // 4. Return the populated exports
  return module.exports;
}
```

Three things to note:

**Caching is immediate.** The module is placed in the cache *before* its factory runs. This handles circular dependencies: if module A imports B and B imports A, when B tries to load A, it gets A's partially-populated exports object from the cache instead of entering an infinite loop.

**Each module runs exactly once.** The second time anyone calls `loadModule("./src/utils/math.js")`, it returns the cached exports instantly.

**The factory receives `loadModule` as a parameter.** This is critical for lazy chunks — they don't have direct closure access to the runtime's `loadModule` function, so they receive it as an argument. This mirrors webpack's pattern where `__webpack_require__` is passed to every factory.

### The Execution Chain

When the browser loads `main.js`, the last line of the IIFE triggers everything:

```js
var entryExports = loadModule("./src/index.js");
```

This cascades:

```
loadModule("./src/index.js")
  → Factory starts running
  → var _utils_math_ = loadModule("./src/utils/math.js")
      → Factory runs, defines add/subtract/PI on exports
      → Returns exports object
  → var _utils_greet_ = loadModule("./src/utils/greet.js")
      → Factory runs, defines greet/farewell on exports
      → Returns exports object
  → console.log("PI is:", _utils_math_.PI)
      → Getter () => PI fires → returns 3.14159
  → console.log("2 + 3 =", (0, _utils_math_.add)(2, 3))
      → Getter () => add fires → returns the function
      → (0, fn)(2, 3) → calls add(2, 3) → returns 5
  → ... rest of the module executes
```

All synchronous. By the time the IIFE finishes, the console shows:

```
PI is: 3.14159
2 + 3 = 5
Hello, World!
Goodbye, World!
```

---

## Part 4: Chunks and Code Splitting

So far we've seen the **main chunk** — a single file containing all statically-imported modules. But what about `import('./feature-a.js')`?

Dynamic `import()` creates a **code splitting boundary**. The bundler puts the target module (and its dependencies) into a separate file — a **lazy chunk** — that loads on demand.

### How the Bundler Decides What Goes Where

The algorithm is a two-pass BFS:

**Pass 1: Main chunk.** Starting from the entry point, follow only `import ... from` (static imports). Every module reachable this way goes into `main.js`.

```
index.js ─static→ math.js     ✓ main chunk
         ─static→ greet.js    ✓ main chunk
         ─dynamic→ feature-a.js   ✗ NOT in main chunk
         ─dynamic→ feature-b.js   ✗ NOT in main chunk
```

**Pass 2: Lazy chunks.** For each dynamic `import()` target, BFS again following static imports, but *excluding modules already in the main chunk*:

```
feature-a.js ─static→ shared-utils.js   → lazy chunk for feature-a
feature-b.js ─static→ shared-utils.js   → lazy chunk for feature-b
```

But wait — `shared-utils.js` appears in **both** lazy chunks. The bundler detects this and extracts it into its own **shared chunk**:

```
┌─────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ main.js             │  │ shared_src_shared-    │  │ src_feature-a_js.js  │
│                     │  │ utils_js.js           │  │                      │
│ ├── index.js        │  │                       │  │ └── feature-a.js     │
│ ├── math.js         │  │ └── shared-utils.js   │  │                      │
│ └── greet.js        │  │                       │  │ src_feature-b_js.js  │
│     + Runtime       │  │                       │  │                      │
│                     │  │                       │  │ └── feature-b.js     │
└─────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

This is what webpack's `SplitChunksPlugin` does — it prevents duplicate modules across chunks.

### ChunkGroups: Loading Multiple Chunks Together

Now there's a problem: when the user clicks "Load Feature A", the browser needs to load **two** files — the shared chunk and the feature-a chunk — before feature-a's code can run (because it depends on shared-utils).

This is where **ChunkGroups** come in. A ChunkGroup maps a dynamic import to all the chunks that must load:

```js
var chunkGroupMap = {
  "src_feature-a_js": ["shared_src_shared-utils_js", "src_feature-a_js"],
  "src_feature-b_js": ["shared_src_shared-utils_js", "src_feature-b_js"]
};
```

When `loadChunk("src_feature-a_js")` is called, it looks up the ChunkGroup, sees it needs two chunks, and loads both. `Promise.all()` waits for both to finish before resolving.

---

## Part 5: Lazy Loading — The JSONP Pattern

This is the most clever part of webpack's architecture. How do you load a JavaScript file on demand and get its module factories registered into the runtime?

### The Dynamic Import Transformation

Your code:

```js
import('./feature-a.js').then(mod => {
  mod.runFeatureA();
});
```

Becomes:

```js
loadChunk("src_feature-a_js")
  .then(loadModule.bind(loadModule, "./src/feature-a.js"))
  .then(mod => {
    mod.runFeatureA();
  });
```

Three steps chain together:
1. `loadChunk(...)` — download the chunk files, returns a Promise
2. `.then(loadModule.bind(...))` — once chunks are loaded, execute the target module
3. `.then(mod => { ... })` — your original callback with the module's exports

The `loadModule.bind(loadModule, "./src/feature-a.js")` creates a function that, when called, invokes `loadModule("./src/feature-a.js")`. The `.bind()` ensures `loadModule` is called with the correct `this` and the module ID pre-filled.

### How `loadChunk()` Works

```js
function loadChunk(chunkId) {
  var chunkIds = chunkGroupMap[chunkId] || [chunkId];
  var promises = [];

  for (var i = 0; i < chunkIds.length; i++) {
    var id = chunkIds[i];
    var status = chunkStatus[id];

    if (status === 0) {
      // Already loaded — skip
      continue;
    }

    if (status) {
      // Currently loading — reuse the existing promise (no duplicate requests)
      promises.push(status[2]);
    } else {
      // Not yet requested — create a new promise and inject <script>
      var promise = new Promise(function(resolve, reject) {
        chunkStatus[id] = [resolve, reject];
      });
      chunkStatus[id][2] = promise;
      promises.push(promise);

      var url = publicPath + getChunkFileName(id);
      loadScript(url);
    }
  }

  return Promise.all(promises);
}
```

The `chunkStatus` object is a state machine for each chunk:

| Value | Meaning |
|-------|---------|
| `undefined` | Never requested |
| `[resolve, reject, promise]` | Currently loading |
| `0` | Loaded and available |

When a chunk hasn't been requested yet, `loadChunk` creates a Promise (storing its `resolve` and `reject` callbacks) and injects a `<script>` tag:

```js
function loadScript(url) {
  var script = document.createElement("script");
  script.src = url;
  document.head.appendChild(script);
}
```

But here's the question: **who resolves the promise?** The script file itself does, through the JSONP callback.

### What's Inside a Lazy Chunk File

When the browser downloads `src_feature-a_js.js`, it gets this:

```js
(self["bundlerChunkCallbacks"] = self["bundlerChunkCallbacks"] || []).push([
  ["src_feature-a_js"],
  {
    "./src/feature-a.js": (module, exports, loadModule) => {
      loadModule.markAsESModule(exports);

      loadModule.defineExports(exports, {
          "runFeatureA": () => runFeatureA
      });

      var _shared_utils_ = loadModule("./src/shared-utils.js");

      function runFeatureA() {
        (0, _shared_utils_.logResult)("Feature A", "loaded and running!");
        return "Feature A result";
      }
    },
  }
]);
```

This is a self-executing script. It pushes an array into a global callback array:
- **First element**: `["src_feature-a_js"]` — the chunk IDs this file fulfills
- **Second element**: an object of module factories — same format as `moduleRegistry`

### The JSONP Callback System

Back in `main.js`, the runtime sets up the global callback array:

```js
// Create or access the global array
var callbacks = self["bundlerChunkCallbacks"] = self["bundlerChunkCallbacks"] || [];

// Process any chunks that arrived before the main bundle finished
// (edge case: if a <script> for a lazy chunk loads faster than main.js)
for (var i = 0; i < callbacks.length; i++) {
  installChunk(callbacks[i]);
}

// Override .push() — from now on, every push triggers installChunk
callbacks.push = function(data) {
  installChunk(data);
};
```

The key trick: **overriding `.push()`**. The lazy chunk file calls `.push()` on the global array. The main runtime replaces `.push()` with a function that immediately processes the chunk data.

### `installChunk()` — Completing the Circle

```js
function installChunk(data) {
  var chunkIds = data[0];
  var moreModules = data[1];

  // Register all modules from this chunk into the module registry
  for (var moduleId in moreModules) {
    if (loadModule.hasOwnProp(moreModules, moduleId)) {
      moduleRegistry[moduleId] = moreModules[moduleId];
    }
  }

  // Mark all chunk IDs as loaded and resolve their promises
  for (var i = 0; i < chunkIds.length; i++) {
    var id = chunkIds[i];
    if (chunkStatus[id]) {
      chunkStatus[id][0](); // Call the resolve function
    }
    chunkStatus[id] = 0; // Mark as loaded
  }
}
```

This does two things:
1. **Copies module factories** from the chunk into the global `moduleRegistry`. Now `loadModule()` can find them.
2. **Resolves the loading promise** by calling `chunkStatus[id][0]()` (which is the `resolve` callback stored earlier). This unblocks the `Promise.all()` in `loadChunk()`.

### The Full Lazy Loading Sequence

Let's trace exactly what happens when the user clicks "Load Feature A":

```
1. Click event fires
2. loadChunk("src_feature-a_js") called
3. chunkGroupMap lookup → need ["shared_src_shared-utils_js", "src_feature-a_js"]
4. For shared chunk:
   - chunkStatus["shared_..."] is undefined
   - Create Promise P1, store [resolve1, reject1, P1] in chunkStatus
   - Inject <script src="shared_src_shared-utils_js.js">
5. For feature-a chunk:
   - chunkStatus["src_feature-a_js"] is undefined
   - Create Promise P2, store [resolve2, reject2, P2] in chunkStatus
   - Inject <script src="src_feature-a_js.js">
6. Return Promise.all([P1, P2])

   ... browser downloads both scripts ...

7. shared_src_shared-utils_js.js executes:
   - self["bundlerChunkCallbacks"].push([["shared_..."], { modules }])
   - Overridden .push() calls installChunk()
   - moduleRegistry["./src/shared-utils.js"] = factory
   - chunkStatus["shared_..."][0]() → resolve1() fires → P1 resolved
   - chunkStatus["shared_..."] = 0

8. src_feature-a_js.js executes:
   - self["bundlerChunkCallbacks"].push([["src_feature-a_js"], { modules }])
   - installChunk() runs
   - moduleRegistry["./src/feature-a.js"] = factory
   - resolve2() fires → P2 resolved
   - chunkStatus["src_feature-a_js"] = 0

9. Promise.all([P1, P2]) resolves

10. .then(loadModule.bind(loadModule, "./src/feature-a.js"))
    - loadModule("./src/feature-a.js") called
    - Factory runs:
      - var _shared_utils_ = loadModule("./src/shared-utils.js")
        → Factory runs, defines formatResult/logResult exports
      - function runFeatureA() { ... } defined
      - defineExports registers runFeatureA
    - Returns module.exports

11. .then(mod => { mod.runFeatureA(); })
    - mod.runFeatureA() calls the function
    - Inside: (0, _shared_utils_.logResult)("Feature A", "loaded and running!")
    - logResult calls formatResult locally (same module, no transformation needed)
    - Console: [Feature A]: loaded and running!
```

### Shared Chunk Deduplication

Now the user clicks "Load Feature B":

```
1. loadChunk("src_feature-b_js") called
2. chunkGroupMap → need ["shared_src_shared-utils_js", "src_feature-b_js"]
3. For shared chunk:
   - chunkStatus["shared_..."] === 0  ← ALREADY LOADED
   - Skip! No network request.
4. For feature-b chunk:
   - Not loaded yet → create promise, inject <script>
5. Promise.all([]) — only one promise since shared is already done
6. Feature-b loads, resolves, executes
7. loadModule("./src/shared-utils.js") → cache hit! Returns cached exports instantly
```

The shared chunk downloads **once**. The second dynamic import reuses it.

---

## Part 6: The Complete Bundle Structure

Here's the full `main.js`, annotated with what each section maps to in webpack:

```js
(() => {                                    // IIFE wrapper — scope isolation
"use strict";

// ── MODULE REGISTRY ──                    // webpack: __webpack_modules__
var moduleRegistry = {
  "./src/index.js": (module, exports, loadModule) => { ... },
  "./src/utils/math.js": (module, exports, loadModule) => { ... },
  "./src/utils/greet.js": (module, exports, loadModule) => { ... },
};

// ── MODULE CACHE ──                       // webpack: __webpack_module_cache__
var moduleCache = {};

// ── MODULE LOADER ──                      // webpack: __webpack_require__
function loadModule(moduleId) {
  var cachedModule = moduleCache[moduleId];
  if (cachedModule !== undefined) return cachedModule.exports;
  var module = moduleCache[moduleId] = { exports: {} };
  moduleRegistry[moduleId](module, module.exports, loadModule);
  return module.exports;
}

// ── HELPERS ──
loadModule.markAsESModule = function(exports) { ... };    // webpack: __webpack_require__.r
loadModule.defineExports = function(exports, def) { ... };// webpack: __webpack_require__.d
loadModule.hasOwnProp = function(obj, prop) { ... };      // webpack: __webpack_require__.o

// ── LAZY LOADING ──
var chunkStatus = {};                        // webpack: installedChunks
function getChunkFileName(chunkId) { ... }   // webpack: __webpack_require__.u
var publicPath = "";                         // webpack: __webpack_require__.p
var chunkGroupMap = { ... };                 // Embedded ChunkGroup data
function loadChunk(chunkId) { ... }          // webpack: __webpack_require__.e
function loadScript(url) { ... }             // webpack: __webpack_require__.l

// ── JSONP SYSTEM ──
function installChunk(data) { ... }          // Module registration + promise resolution
var callbacks = self["bundlerChunkCallbacks"] = ...;  // webpack: webpackChunkApp
callbacks.push = function(data) {            // Override for chunk interception
  installChunk(data);
};

// ── ENTRY POINT ──
var entryExports = loadModule("./src/index.js");   // Kick off the app
})();
```

Every part has a direct webpack equivalent. The only difference is the names.

---

## Summary: The Five Transformations

When webpack (or our bundler) processes your code, it performs five key transformations:

| # | What | Before | After |
|---|------|--------|-------|
| 1 | **Wrap in factory** | `// top-level code` | `(module, exports, loadModule) => { ... }` |
| 2 | **Remove imports** | `import { add } from './math.js'` | `var _math_ = loadModule("./src/math.js")` |
| 3 | **Replace references** | `add(2, 3)` | `(0, _math_.add)(2, 3)` |
| 4 | **Transform exports** | `export function add() {}` | `function add() {}` + `defineExports(...)` |
| 5 | **Transform dynamic imports** | `import('./feature.js')` | `loadChunk("...").then(loadModule.bind(...))` |

And the runtime provides three things:

1. **`loadModule()`** — synchronous module execution with caching
2. **`loadChunk()`** — async chunk loading via `<script>` injection + JSONP callbacks
3. **Live binding helpers** — getter-based exports that satisfy the ES module spec

That's it. That's all webpack does at its core. Everything else — loaders, plugins, tree shaking, HMR — is built on top of these foundations.

---

## Try It Yourself

```bash
git clone https://github.com/AbanoubGhadban/webpack-bundling-demo
cd webpack-bundling-demo
npm install
node bundler.js --entry ./example/src/index.js --output ./example/dist
```

Then open `example/dist/main.js` — every section is commented explaining what it does and its webpack equivalent. Open `example/dist/index.html` in a browser, check the console, click the buttons, and watch the Network tab to see chunks loading on demand.
