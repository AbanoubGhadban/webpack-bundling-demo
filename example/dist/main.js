// ================================================================
// MAIN BUNDLE (Entry Chunk)
// ================================================================
// This is the entry chunk. It contains:
//   1. The Module Registry — factory functions for all statically-imported modules
//   2. The Module Cache — so each module executes only once
//   3. The loadModule() function — the core module loader
//   4. Runtime helpers — for ES module interop and lazy loading
//   5. The entry point execution
//
// In webpack, this entire IIFE is the entry chunk output.
// We use readable names instead of webpack's minified ones.
// See the name mapping in README.md for the full correspondence.
(() => {
"use strict";

// ========================================================
// MODULE REGISTRY (webpack: __webpack_modules__)
// ========================================================
// A Module is a single source file wrapped in a factory function.
// This object maps Module IDs (file paths) to their factory functions.
// All modules in the "main" Chunk are registered here at build time.
// Modules from lazy Chunks are added at runtime when those chunks load.
//
// Each factory receives three arguments:
//   module  — the module object (module.exports is the exports object)
//   exports — shorthand for module.exports
//   loadModule — the module loader function (to require dependencies)
var moduleRegistry = {

  // ---- Module: ./example/src/index.js ----
  "./example/src/index.js": (module, exports, loadModule) => {
    loadModule.markAsESModule(exports);

    var _utils_math_ = loadModule("./example/src/utils/math.js");
    var _utils_greet_ = loadModule("./example/src/utils/greet.js");

    // Static imports — these modules are in the main chunk
    console.log("PI is:", _utils_math_.PI);
    console.log("2 + 3 =", (0, _utils_math_.add)(2, 3));
    console.log((0, _utils_greet_["default"])("World"));
    console.log((0, _utils_greet_.farewell)("World"));

    // Dynamic imports — these create lazy chunks loaded on demand
    document.getElementById("btn-a").addEventListener("click", () => {
      loadChunk("example_src_feature-a_js").then(loadModule.bind(loadModule, "./example/src/feature-a.js")).then(mod => {
        mod.runFeatureA();
      });
    });

    document.getElementById("btn-b").addEventListener("click", () => {
      loadChunk("example_src_feature-b_js").then(loadModule.bind(loadModule, "./example/src/feature-b.js")).then(mod => {
        mod.runFeatureB();
      });
    });
  },

  // ---- Module: ./example/src/utils/math.js ----
  "./example/src/utils/math.js": (module, exports, loadModule) => {
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

  // ---- Module: ./example/src/utils/greet.js ----
  "./example/src/utils/greet.js": (module, exports, loadModule) => {
    loadModule.markAsESModule(exports);

    loadModule.defineExports(exports, {
        "farewell": () => farewell,
        "default": () => greet
    });

    function greet(name) {
      return `Hello, ${name}!`;
    }

    function farewell(name) {
      return `Goodbye, ${name}!`;
    }
  },
};

// ========================================================
// MODULE CACHE (webpack: __webpack_module_cache__)
// ========================================================
// Each module is executed at most once. After the first execution,
// its exports are cached here. Subsequent loadModule() calls
// return the cached exports without re-executing the factory.
var moduleCache = {};

// ========================================================
// CORE MODULE LOADER (webpack: __webpack_require__)
// ========================================================
// This is the heart of the bundler runtime. When a module calls
// loadModule("./src/utils/math.js"), this function:
//   1. Checks the cache — if already loaded, returns cached exports
//   2. Creates a new module object with an empty exports object
//   3. Calls the factory function from moduleRegistry
//   4. Returns the populated exports object
function loadModule(moduleId) {
  // Check if module is already cached
  var cachedModule = moduleCache[moduleId];
  if (cachedModule !== undefined) {
    return cachedModule.exports;
  }

  // Create a new module and put it in the cache
  var module = moduleCache[moduleId] = {
    exports: {}
  };

  // Execute the module factory
  moduleRegistry[moduleId](module, module.exports, loadModule);

  // Return the module's exports
  return module.exports;
}

// ========================================================
// RUNTIME HELPERS
// ========================================================
// These helper functions are attached to loadModule so that
// module factories (including those in lazy chunks) can access
// them via the loadModule parameter. This mirrors webpack's
// pattern of attaching helpers to __webpack_require__.

// Mark exports as an ES module (webpack: __webpack_require__.r)
// Sets Symbol.toStringTag = "Module" and __esModule = true.
// This is how other code (and bundlers) detect ES module exports.
loadModule.markAsESModule = function(exports) {
  if (typeof Symbol !== "undefined" && Symbol.toStringTag) {
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  }
  Object.defineProperty(exports, "__esModule", { value: true });
};

// Define getter-based exports (webpack: __webpack_require__.d)
// Instead of setting exports.add = add directly, we define a getter.
// This creates "live bindings" — if the original variable changes,
// the exported value updates too. This is required by the ES module spec.
loadModule.defineExports = function(exports, definition) {
  for (var key in definition) {
    if (loadModule.hasOwnProp(definition, key) && !loadModule.hasOwnProp(exports, key)) {
      Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
    }
  }
};

// hasOwnProperty shorthand (webpack: __webpack_require__.o)
loadModule.hasOwnProp = function(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
};

// ========================================================
// LAZY LOADING RUNTIME
// ========================================================
// Everything below handles on-demand chunk loading via import().
// Webpack uses a JSONP-like pattern: lazy chunks push their data
// into a global array, and the main chunk's runtime picks it up.

// Chunk loading state machine (webpack: installedChunks)
// For each chunk ID, the value is:
//   0            = already loaded and available
//   undefined    = not yet requested
//   [resolve, reject, promise] = currently loading
var chunkStatus = {};

// Map chunk ID to filename (webpack: __webpack_require__.u)
// In a real bundler this might have content hashes. We keep it simple.
function getChunkFileName(chunkId) {
  return chunkId + ".js";
}

// Base URL for loading chunks (webpack: __webpack_require__.p)
// In production, this might be "https://cdn.example.com/assets/".
var publicPath = "";

// ---- ChunkGroup Map ----
// A ChunkGroup is a set of Chunks that must ALL be loaded before a
// certain dynamic import can execute. When shared modules are extracted
// into separate chunks, a single import() may need multiple chunks.
//
// This map says: "to fulfill import('./feature-a.js'), load these chunks
// in order." The last chunk in each array is the one with the actual
// module; the preceding ones are shared dependency chunks.
var chunkGroupMap = {
  "example_src_feature-a_js": ["shared_example_src_shared-utils_js","example_src_feature-a_js"],
  "example_src_feature-b_js": ["shared_example_src_shared-utils_js","example_src_feature-b_js"]
};

// Async chunk loading orchestrator (webpack: __webpack_require__.e)
// Called when code hits a dynamic import(). Looks up the ChunkGroup
// to find ALL chunks that need to load, then waits for all of them.
// Returns a Promise that resolves when all chunks are ready.
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
      // Currently loading — reuse the existing promise
      promises.push(status[2]);
    } else {
      // Not yet requested — create a new promise and start loading
      var promise = new Promise(function(resolve, reject) {
        chunkStatus[id] = [resolve, reject];
      });
      chunkStatus[id][2] = promise;
      promises.push(promise);

      // Inject a <script> tag to load the chunk file
      var url = publicPath + getChunkFileName(id);
      loadScript(url);
    }
  }

  // Wait for ALL chunks in the ChunkGroup to load
  return Promise.all(promises);
}

// DOM <script> injection (webpack: __webpack_require__.l)
// Creates a script element and appends it to the document head.
// The loaded script will call the JSONP callback (below), which
// registers the chunk's modules and resolves the loading promise.
function loadScript(url) {
  var script = document.createElement("script");
  script.src = url;
  script.onerror = function() {
    console.error("Failed to load chunk: " + url);
  };
  document.head.appendChild(script);
}

// ---- JSONP Callback System ----
// Webpack's lazy loading uses a JSONP-like pattern:
//   1. The main bundle creates a global array: self["bundlerChunkCallbacks"]
//   2. It overrides .push() on that array with a custom installer function
//   3. Lazy chunk files call: self["bundlerChunkCallbacks"].push([chunkIds, modules])
//   4. The overridden .push() picks up the data, registers modules,
//      and resolves the loading promise
//
// This is why it's called "JSONP" — the chunk file is a script that
// calls a global function (push) with its data as the argument.
// (webpack: webpackChunkApp)

// Install chunk data: register modules and resolve promises
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
      chunkStatus[id][0](); // resolve the promise
    }
    chunkStatus[id] = 0; // mark as loaded
  }
}

// Set up the global JSONP callback array
var callbacks = self["bundlerChunkCallbacks"] = self["bundlerChunkCallbacks"] || [];

// Process any chunks that loaded before this script ran
// (edge case: if a lazy chunk's <script> loads before the main bundle finishes)
for (var i = 0; i < callbacks.length; i++) {
  installChunk(callbacks[i]);
}

// Override .push() so future chunk loads are handled immediately
callbacks.push = function(data) {
  installChunk(data);
};

// ========================================================
// ENTRY POINT
// ========================================================
// This kicks off the application by loading the entry module.
// The entry module's factory runs, which triggers loadModule()
// calls for its dependencies, recursively initializing the
// entire module graph.
var entryExports = loadModule("./example/src/index.js");
})();