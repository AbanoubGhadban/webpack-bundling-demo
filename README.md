# Webpack Bundling Demo

An educational JavaScript bundler that works exactly like webpack internally, but produces **human-readable output**. Instead of webpack's cryptic `__webpack_require__`, `__webpack_modules__`, `r`, `d`, `o` variables, this bundler uses descriptive names like `loadModule`, `moduleRegistry`, `markAsESModule`, and `defineExports`.

The goal: read the bundled output and understand exactly how webpack compiles `import {} from ''` and dynamic `import()` statements.

## Quick Start

```bash
npm install
node bundler.js --entry ./example/src/index.js --output ./example/dist
```

Then open `example/dist/index.html` in a browser and check the console.

## Core Concepts: Module, Chunk, and ChunkGroup

These are the three fundamental concepts in webpack's architecture. Understanding them is key to understanding the bundled output.

### Module

A **Module** is a single source file wrapped in a factory function. Every `.js` file you write becomes one Module in the bundle.

```
Source file:    example/src/utils/math.js
Module ID:      "./example/src/utils/math.js"
In the bundle:  A factory function in the moduleRegistry object
```

From the generated output:
```js
// This is ONE MODULE — it corresponds to the file utils/math.js
// The factory receives: module object, exports object, and the loader function.
"./example/src/utils/math.js": (module, exports, loadModule) => {
    loadModule.markAsESModule(exports);
    loadModule.defineExports(exports, {
        "add": () => add,
        "PI": () => PI
    });
    function add(a, b) { return a + b; }
    const PI = 3.14159;
},
```

Key properties:
- Has a unique ID (the file path)
- Contains a factory function that populates its `exports` object
- Is executed at most once (cached after first execution)
- Can depend on other Modules (via `loadModule()` calls)

### Chunk

A **Chunk** is a group of Modules bundled into a single output file. Chunks are the unit of network delivery — each `.js` file the browser downloads is one Chunk.

**Entry Chunk (`main.js`)** — Contains all modules reachable via static `import` from the entry point, plus the runtime code:

```
Entry Chunk "main":
├── ./example/src/index.js          (entry module)
├── ./example/src/utils/math.js     (static import)
└── ./example/src/utils/greet.js    (static import)
    + Runtime code (loadModule, helpers, JSONP system)
```

**Lazy Chunk** — Contains modules reachable from a dynamic `import()` call. Loaded on-demand:

```
Lazy Chunk "example_src_feature-a_js":
└── ./example/src/feature-a.js      (dynamically imported)
    (shared-utils.js is NOT here — it's in a shared chunk)
```

### ChunkGroup

A **ChunkGroup** is a set of Chunks that must ALL be loaded before a dynamic import can execute. When shared modules are extracted into separate chunks, a single `import()` may need multiple chunks.

```
ChunkGroup for import('./feature-a.js'):
├── shared_example_src_shared-utils_js  (shared dependencies)
└── example_src_feature-a_js            (the actual module)
Both must load before feature-a's code can run.
```

This is why `loadChunk()` returns `Promise.all(promises)` — it waits for ALL chunks in the group.

### Visual Diagram

```
┌──────────────────────────────────────────────────────────┐
│                     DEPENDENCY GRAPH                      │
│                     (All Modules)                         │
│                                                           │
│  index.js ──static──> math.js                            │
│     │                                                     │
│     ├──static──> greet.js                                │
│     │                                                     │
│     ├──dynamic──> feature-a.js ──static──> shared-utils  │
│     │                                                     │
│     └──dynamic──> feature-b.js ──static──> shared-utils  │
│                                                           │
└──────────────────────────────────────────────────────────┘
                         │
                   Chunk Splitting
                         │
                         ▼
┌─────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ Entry Chunk:        │  │ Shared Chunk:         │  │ Lazy Chunks:         │
│ main.js             │  │ shared_example_src_   │  │                      │
│                     │  │ shared-utils_js.js    │  │ example_src_feature- │
│ Modules:            │  │                       │  │ a_js.js              │
│ ├── index.js        │  │ Modules:              │  │ └── feature-a.js     │
│ ├── math.js         │  │ └── shared-utils.js   │  │                      │
│ └── greet.js        │  │                       │  │ example_src_feature- │
│                     │  │ (shared by both       │  │ b_js.js              │
│ + Runtime code      │  │  feature-a and        │  │ └── feature-b.js     │
│ + JSONP system      │  │  feature-b)           │  │                      │
└─────────────────────┘  └──────────────────────┘  └──────────────────────┘

ChunkGroup for import('./feature-a.js'):
  ├── shared_example_src_shared-utils_js  (shared chunk)
  └── example_src_feature-a_js            (feature-a chunk)
  Both must load before feature-a's module executes.

ChunkGroup for import('./feature-b.js'):
  ├── shared_example_src_shared-utils_js  (same shared chunk — only loaded once!)
  └── example_src_feature-b_js            (feature-b chunk)
```

## Name Mapping: Webpack → Readable

| Webpack | Our Bundler | Purpose |
|---------|-------------|---------|
| `__webpack_modules__` | `moduleRegistry` | Map of module IDs to factory functions |
| `__webpack_module_cache__` | `moduleCache` | Cache of already-executed modules |
| `__webpack_require__` | `loadModule` | Core module loader function |
| `__webpack_require__.r` | `loadModule.markAsESModule` | Set `__esModule = true` on exports |
| `__webpack_require__.d` | `loadModule.defineExports` | Define getter-based live binding exports |
| `__webpack_require__.o` | `loadModule.hasOwnProp` | `hasOwnProperty` shorthand |
| `__webpack_require__.e` | `loadChunk` | Async chunk loading orchestrator |
| `__webpack_require__.u` | `getChunkFileName` | Map chunk ID to filename |
| `__webpack_require__.p` | `publicPath` | Base URL for chunk files |
| `__webpack_require__.l` | `loadScript` | DOM `<script>` injection |
| `installedChunks` | `chunkStatus` | Chunk loading state machine |
| `webpackChunkApp` | `bundlerChunkCallbacks` | Global JSONP callback array |

## How It Works: Walkthrough of the Bundled Output

### 1. Module Registry

Every source file becomes a factory function in `moduleRegistry`. Static imports are registered at build time; lazy chunk modules are added at runtime.

```js
var moduleRegistry = {
  "./example/src/index.js": (module, exports, loadModule) => { ... },
  "./example/src/utils/math.js": (module, exports, loadModule) => { ... },
};
```

### 2. Import Transformation

```js
// Source:
import { add, PI } from './utils/math.js';
add(2, 3);
PI;

// Bundled:
var _utils_math_ = loadModule("./example/src/utils/math.js");
(0, _utils_math_.add)(2, 3);   // (0, fn)() ensures this === undefined
_utils_math_.PI;                // simple property access for non-calls
```

The `(0, fn)()` pattern is a standard trick: it evaluates to the function but drops the `this` context, ensuring the function runs with `this === undefined` (as ES modules require strict mode).

### 3. Export Transformation

```js
// Source:
export function add(a, b) { return a + b; }
export const PI = 3.14159;

// Bundled:
loadModule.defineExports(exports, {
    "add": () => add,
    "PI": () => PI
});
function add(a, b) { return a + b; }
const PI = 3.14159;
```

Exports use **getter functions** (`() => add`) instead of direct assignment. This creates ES module "live bindings" — if `add` were reassigned, consumers would see the new value.

### 4. Dynamic Import Transformation

```js
// Source:
import('./feature-a.js').then(mod => { ... });

// Bundled:
loadChunk("example_src_feature-a_js")
  .then(loadModule.bind(loadModule, "./example/src/feature-a.js"))
  .then(mod => { ... });
```

`loadChunk()` looks up the ChunkGroup map, finds that it needs both the shared chunk and the feature chunk, loads both, then `loadModule()` executes the target module.

## Runtime Flow

### Page Load (synchronous)
1. Browser loads `main.js`
2. IIFE executes, defining `moduleRegistry`, `loadModule`, helpers
3. Entry point: `loadModule("./example/src/index.js")` is called
4. Index factory runs, calls `loadModule("./example/src/utils/math.js")` and `loadModule("./example/src/utils/greet.js")`
5. Each dependency factory runs, populating its exports via `defineExports`
6. Index module accesses `_utils_math_.PI`, `_utils_math_.add`, etc.
7. Console shows: `PI is: 3.14159`, `2 + 3 = 5`, `Hello, World!`, `Goodbye, World!`

### Click "Load Feature A" (asynchronous)
1. `loadChunk("example_src_feature-a_js")` is called
2. Looks up ChunkGroup: needs `["shared_example_src_shared-utils_js", "example_src_feature-a_js"]`
3. Injects two `<script>` tags for both chunk files
4. Each script calls `self["bundlerChunkCallbacks"].push(...)`, triggering `installChunk()`
5. `installChunk()` registers the new modules into `moduleRegistry` and resolves promises
6. `Promise.all()` resolves, `.then(loadModule.bind(...))` executes the feature-a module
7. Feature-a's factory calls `loadModule("./example/src/shared-utils.js")` — already registered
8. Console shows: `[Feature A]: loaded and running!`

### Click "Load Feature B"
1. `loadChunk("example_src_feature-b_js")` is called
2. ChunkGroup needs `["shared_example_src_shared-utils_js", "example_src_feature-b_js"]`
3. Shared chunk status is already `0` (loaded) — **skipped!** Only feature-b chunk loads
4. Console shows: `[Feature B]: loaded and running!`

## Project Structure

```
webpack-bundling-demo/
├── bundler.js                  # CLI entry point
├── src/
│   ├── parser.js               # Parse JS, extract imports/exports via acorn
│   ├── resolver.js             # Resolve module paths (./relative, extensions)
│   ├── dependency-graph.js     # Build dep graph, identify chunks
│   ├── transformer.js          # Transform module source (imports → loadModule, etc.)
│   └── code-generator.js       # Generate final bundle strings
├── example/
│   ├── src/                    # Example source files
│   └── dist/                   # Generated bundle output
├── package.json
└── README.md
```

## Design Decisions

1. **Helpers on `loadModule`**: `loadModule.markAsESModule()`, `loadModule.defineExports()`, etc. are attached to the function object. This mirrors webpack's `__webpack_require__.r/d/o` pattern and ensures lazy chunk factories can access them via the `loadModule` parameter.

2. **Verbose comments**: Every section of the generated bundle has descriptive comments explaining what it does and its webpack equivalent.

3. **No tree shaking / no minification**: Intentionally excluded to keep the output maximally readable.

4. **Readable module IDs**: Uses file paths like `"./example/src/utils/math.js"` instead of webpack's numeric production IDs.

5. **Shared chunk extraction**: Modules appearing in 2+ lazy chunks are automatically extracted into shared chunks, demonstrating how webpack's `SplitChunksPlugin` works.
