const { transformModule } = require('./transformer');

/**
 * Generate all output bundle files.
 *
 * Returns an array of { filename, content } objects.
 */
function generateBundles(chunkInfo, projectRoot) {
  const { mainChunk, lazyChunks, chunkGroupMap, modules, dynamicEntryPoints } = chunkInfo;
  const hasLazyChunks = lazyChunks.size > 0;

  const output = [];

  // --- Generate main bundle ---
  output.push({
    filename: 'main.js',
    content: generateMainBundle(mainChunk, lazyChunks, chunkGroupMap, modules, projectRoot, hasLazyChunks),
  });

  // --- Generate lazy chunk bundles ---
  for (const [chunkId, chunk] of lazyChunks) {
    output.push({
      filename: chunkId + '.js',
      content: generateLazyChunk(chunkId, chunk, modules, projectRoot),
    });
  }

  return output;
}

function generateMainBundle(mainChunk, lazyChunks, chunkGroupMap, modules, projectRoot, hasLazyChunks) {
  const lines = [];

  lines.push(`// ================================================================`);
  lines.push(`// MAIN BUNDLE (Entry Chunk)`);
  lines.push(`// ================================================================`);
  lines.push(`// This is the entry chunk. It contains:`);
  lines.push(`//   1. The Module Registry — factory functions for all statically-imported modules`);
  lines.push(`//   2. The Module Cache — so each module executes only once`);
  lines.push(`//   3. The loadModule() function — the core module loader`);
  lines.push(`//   4. Runtime helpers — for ES module interop and lazy loading`);
  lines.push(`//   5. The entry point execution`);
  lines.push(`//`);
  lines.push(`// In webpack, this entire IIFE is the entry chunk output.`);
  lines.push(`// We use readable names instead of webpack's minified ones.`);
  lines.push(`// See the name mapping in README.md for the full correspondence.`);
  lines.push(`(() => {`);
  lines.push(`"use strict";`);

  // -- Module Registry --
  lines.push(``);
  lines.push(`// ========================================================`);
  lines.push(`// MODULE REGISTRY (webpack: __webpack_modules__)`);
  lines.push(`// ========================================================`);
  lines.push(`// A Module is a single source file wrapped in a factory function.`);
  lines.push(`// This object maps Module IDs (file paths) to their factory functions.`);
  lines.push(`// All modules in the "main" Chunk are registered here at build time.`);
  lines.push(`// Modules from lazy Chunks are added at runtime when those chunks load.`);
  lines.push(`//`);
  lines.push(`// Each factory receives three arguments:`);
  lines.push(`//   module  — the module object (module.exports is the exports object)`);
  lines.push(`//   exports — shorthand for module.exports`);
  lines.push(`//   loadModule — the module loader function (to require dependencies)`);
  lines.push(`var moduleRegistry = {`);

  // Transform and emit each module in the main chunk
  const mainModuleIds = [...mainChunk.moduleIds];
  const entryModuleId = mainModuleIds[0]; // First module is the entry

  for (let i = 0; i < mainModuleIds.length; i++) {
    const moduleId = mainModuleIds[i];
    const info = modules.get(moduleId);
    const transformed = transformModule(info, projectRoot);
    const indented = indentCode(transformed, '    ');

    lines.push(``);
    lines.push(`  // ---- Module: ${moduleId} ----`);
    lines.push(`  "${moduleId}": (module, exports, loadModule) => {`);
    lines.push(indented);
    lines.push(`  },`);
  }

  lines.push(`};`);

  // -- Module Cache --
  lines.push(``);
  lines.push(`// ========================================================`);
  lines.push(`// MODULE CACHE (webpack: __webpack_module_cache__)`);
  lines.push(`// ========================================================`);
  lines.push(`// Each module is executed at most once. After the first execution,`);
  lines.push(`// its exports are cached here. Subsequent loadModule() calls`);
  lines.push(`// return the cached exports without re-executing the factory.`);
  lines.push(`var moduleCache = {};`);

  // -- Core Module Loader --
  lines.push(``);
  lines.push(`// ========================================================`);
  lines.push(`// CORE MODULE LOADER (webpack: __webpack_require__)`);
  lines.push(`// ========================================================`);
  lines.push(`// This is the heart of the bundler runtime. When a module calls`);
  lines.push(`// loadModule("./src/utils/math.js"), this function:`);
  lines.push(`//   1. Checks the cache — if already loaded, returns cached exports`);
  lines.push(`//   2. Creates a new module object with an empty exports object`);
  lines.push(`//   3. Calls the factory function from moduleRegistry`);
  lines.push(`//   4. Returns the populated exports object`);
  lines.push(`function loadModule(moduleId) {`);
  lines.push(`  // Check if module is already cached`);
  lines.push(`  var cachedModule = moduleCache[moduleId];`);
  lines.push(`  if (cachedModule !== undefined) {`);
  lines.push(`    return cachedModule.exports;`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  // Create a new module and put it in the cache`);
  lines.push(`  var module = moduleCache[moduleId] = {`);
  lines.push(`    exports: {}`);
  lines.push(`  };`);
  lines.push(``);
  lines.push(`  // Execute the module factory`);
  lines.push(`  moduleRegistry[moduleId](module, module.exports, loadModule);`);
  lines.push(``);
  lines.push(`  // Return the module's exports`);
  lines.push(`  return module.exports;`);
  lines.push(`}`);

  // -- Runtime Helpers --
  lines.push(``);
  lines.push(`// ========================================================`);
  lines.push(`// RUNTIME HELPERS`);
  lines.push(`// ========================================================`);
  lines.push(`// These helper functions are attached to loadModule so that`);
  lines.push(`// module factories (including those in lazy chunks) can access`);
  lines.push(`// them via the loadModule parameter. This mirrors webpack's`);
  lines.push(`// pattern of attaching helpers to __webpack_require__.`);
  lines.push(``);

  // markAsESModule
  lines.push(`// Mark exports as an ES module (webpack: __webpack_require__.r)`);
  lines.push(`// Sets Symbol.toStringTag = "Module" and __esModule = true.`);
  lines.push(`// This is how other code (and bundlers) detect ES module exports.`);
  lines.push(`loadModule.markAsESModule = function(exports) {`);
  lines.push(`  if (typeof Symbol !== "undefined" && Symbol.toStringTag) {`);
  lines.push(`    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });`);
  lines.push(`  }`);
  lines.push(`  Object.defineProperty(exports, "__esModule", { value: true });`);
  lines.push(`};`);
  lines.push(``);

  // defineExports
  lines.push(`// Define getter-based exports (webpack: __webpack_require__.d)`);
  lines.push(`// Instead of setting exports.add = add directly, we define a getter.`);
  lines.push(`// This creates "live bindings" — if the original variable changes,`);
  lines.push(`// the exported value updates too. This is required by the ES module spec.`);
  lines.push(`loadModule.defineExports = function(exports, definition) {`);
  lines.push(`  for (var key in definition) {`);
  lines.push(`    if (loadModule.hasOwnProp(definition, key) && !loadModule.hasOwnProp(exports, key)) {`);
  lines.push(`      Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push(`};`);
  lines.push(``);

  // hasOwnProp
  lines.push(`// hasOwnProperty shorthand (webpack: __webpack_require__.o)`);
  lines.push(`loadModule.hasOwnProp = function(obj, prop) {`);
  lines.push(`  return Object.prototype.hasOwnProperty.call(obj, prop);`);
  lines.push(`};`);

  // -- Lazy Loading Runtime (if needed) --
  if (hasLazyChunks) {
    lines.push(``);
    lines.push(`// ========================================================`);
    lines.push(`// LAZY LOADING RUNTIME`);
    lines.push(`// ========================================================`);
    lines.push(`// Everything below handles on-demand chunk loading via import().`);
    lines.push(`// Webpack uses a JSONP-like pattern: lazy chunks push their data`);
    lines.push(`// into a global array, and the main chunk's runtime picks it up.`);
    lines.push(``);

    // chunkStatus
    lines.push(`// Chunk loading state machine (webpack: installedChunks)`);
    lines.push(`// For each chunk ID, the value is:`);
    lines.push(`//   0            = already loaded and available`);
    lines.push(`//   undefined    = not yet requested`);
    lines.push(`//   [resolve, reject, promise] = currently loading`);
    lines.push(`var chunkStatus = {};`);
    lines.push(``);

    // getChunkFileName
    lines.push(`// Map chunk ID to filename (webpack: __webpack_require__.u)`);
    lines.push(`// In a real bundler this might have content hashes. We keep it simple.`);
    lines.push(`function getChunkFileName(chunkId) {`);
    lines.push(`  return chunkId + ".js";`);
    lines.push(`}`);
    lines.push(``);

    // publicPath
    lines.push(`// Base URL for loading chunks (webpack: __webpack_require__.p)`);
    lines.push(`// In production, this might be "https://cdn.example.com/assets/".`);
    lines.push(`var publicPath = "";`);
    lines.push(``);

    // chunkGroupMap
    lines.push(`// ---- ChunkGroup Map ----`);
    lines.push(`// A ChunkGroup is a set of Chunks that must ALL be loaded before a`);
    lines.push(`// certain dynamic import can execute. When shared modules are extracted`);
    lines.push(`// into separate chunks, a single import() may need multiple chunks.`);
    lines.push(`//`);
    lines.push(`// This map says: "to fulfill import('./feature-a.js'), load these chunks`);
    lines.push(`// in order." The last chunk in each array is the one with the actual`);
    lines.push(`// module; the preceding ones are shared dependency chunks.`);
    const chunkGroupEntries = Object.entries(chunkGroupMap)
      .map(([k, v]) => `  "${k}": ${JSON.stringify(v)}`)
      .join(',\n');
    lines.push(`var chunkGroupMap = {`);
    lines.push(chunkGroupEntries);
    lines.push(`};`);
    lines.push(``);

    // loadChunk
    lines.push(`// Async chunk loading orchestrator (webpack: __webpack_require__.e)`);
    lines.push(`// Called when code hits a dynamic import(). Looks up the ChunkGroup`);
    lines.push(`// to find ALL chunks that need to load, then waits for all of them.`);
    lines.push(`// Returns a Promise that resolves when all chunks are ready.`);
    lines.push(`function loadChunk(chunkId) {`);
    lines.push(`  var chunkIds = chunkGroupMap[chunkId] || [chunkId];`);
    lines.push(`  var promises = [];`);
    lines.push(``);
    lines.push(`  for (var i = 0; i < chunkIds.length; i++) {`);
    lines.push(`    var id = chunkIds[i];`);
    lines.push(`    var status = chunkStatus[id];`);
    lines.push(``);
    lines.push(`    if (status === 0) {`);
    lines.push(`      // Already loaded — skip`);
    lines.push(`      continue;`);
    lines.push(`    }`);
    lines.push(``);
    lines.push(`    if (status) {`);
    lines.push(`      // Currently loading — reuse the existing promise`);
    lines.push(`      promises.push(status[2]);`);
    lines.push(`    } else {`);
    lines.push(`      // Not yet requested — create a new promise and start loading`);
    lines.push(`      var promise = new Promise(function(resolve, reject) {`);
    lines.push(`        chunkStatus[id] = [resolve, reject];`);
    lines.push(`      });`);
    lines.push(`      chunkStatus[id][2] = promise;`);
    lines.push(`      promises.push(promise);`);
    lines.push(``);
    lines.push(`      // Inject a <script> tag to load the chunk file`);
    lines.push(`      var url = publicPath + getChunkFileName(id);`);
    lines.push(`      loadScript(url);`);
    lines.push(`    }`);
    lines.push(`  }`);
    lines.push(``);
    lines.push(`  // Wait for ALL chunks in the ChunkGroup to load`);
    lines.push(`  return Promise.all(promises);`);
    lines.push(`}`);
    lines.push(``);

    // loadScript
    lines.push(`// DOM <script> injection (webpack: __webpack_require__.l)`);
    lines.push(`// Creates a script element and appends it to the document head.`);
    lines.push(`// The loaded script will call the JSONP callback (below), which`);
    lines.push(`// registers the chunk's modules and resolves the loading promise.`);
    lines.push(`function loadScript(url) {`);
    lines.push(`  var script = document.createElement("script");`);
    lines.push(`  script.src = url;`);
    lines.push(`  script.onerror = function() {`);
    lines.push(`    console.error("Failed to load chunk: " + url);`);
    lines.push(`  };`);
    lines.push(`  document.head.appendChild(script);`);
    lines.push(`}`);
    lines.push(``);

    // JSONP callback system
    lines.push(`// ---- JSONP Callback System ----`);
    lines.push(`// Webpack's lazy loading uses a JSONP-like pattern:`);
    lines.push(`//   1. The main bundle creates a global array: self["bundlerChunkCallbacks"]`);
    lines.push(`//   2. It overrides .push() on that array with a custom installer function`);
    lines.push(`//   3. Lazy chunk files call: self["bundlerChunkCallbacks"].push([chunkIds, modules])`);
    lines.push(`//   4. The overridden .push() picks up the data, registers modules,`);
    lines.push(`//      and resolves the loading promise`);
    lines.push(`//`);
    lines.push(`// This is why it's called "JSONP" — the chunk file is a script that`);
    lines.push(`// calls a global function (push) with its data as the argument.`);
    lines.push(`// (webpack: webpackChunkApp)`);
    lines.push(``);

    lines.push(`// Install chunk data: register modules and resolve promises`);
    lines.push(`function installChunk(data) {`);
    lines.push(`  var chunkIds = data[0];`);
    lines.push(`  var moreModules = data[1];`);
    lines.push(``);
    lines.push(`  // Register all modules from this chunk into the module registry`);
    lines.push(`  for (var moduleId in moreModules) {`);
    lines.push(`    if (loadModule.hasOwnProp(moreModules, moduleId)) {`);
    lines.push(`      moduleRegistry[moduleId] = moreModules[moduleId];`);
    lines.push(`    }`);
    lines.push(`  }`);
    lines.push(``);
    lines.push(`  // Mark all chunk IDs as loaded and resolve their promises`);
    lines.push(`  for (var i = 0; i < chunkIds.length; i++) {`);
    lines.push(`    var id = chunkIds[i];`);
    lines.push(`    if (chunkStatus[id]) {`);
    lines.push(`      chunkStatus[id][0](); // resolve the promise`);
    lines.push(`    }`);
    lines.push(`    chunkStatus[id] = 0; // mark as loaded`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push(``);

    lines.push(`// Set up the global JSONP callback array`);
    lines.push(`var callbacks = self["bundlerChunkCallbacks"] = self["bundlerChunkCallbacks"] || [];`);
    lines.push(``);
    lines.push(`// Process any chunks that loaded before this script ran`);
    lines.push(`// (edge case: if a lazy chunk's <script> loads before the main bundle finishes)`);
    lines.push(`for (var i = 0; i < callbacks.length; i++) {`);
    lines.push(`  installChunk(callbacks[i]);`);
    lines.push(`}`);
    lines.push(``);
    lines.push(`// Override .push() so future chunk loads are handled immediately`);
    lines.push(`callbacks.push = function(data) {`);
    lines.push(`  installChunk(data);`);
    lines.push(`};`);
  }

  // -- Entry Point --
  lines.push(``);
  lines.push(`// ========================================================`);
  lines.push(`// ENTRY POINT`);
  lines.push(`// ========================================================`);
  lines.push(`// This kicks off the application by loading the entry module.`);
  lines.push(`// The entry module's factory runs, which triggers loadModule()`);
  lines.push(`// calls for its dependencies, recursively initializing the`);
  lines.push(`// entire module graph.`);

  // Find the entry module — it's the first module (BFS order guarantees this)
  lines.push(`var entryExports = loadModule("${entryModuleId}");`);

  lines.push(`})();`);

  return lines.join('\n');
}

function generateLazyChunk(chunkId, chunk, modules, projectRoot) {
  const lines = [];

  lines.push(`// ================================================================`);
  lines.push(`// LAZY CHUNK: ${chunkId}`);
  lines.push(`// ================================================================`);
  lines.push(`// A Chunk is a group of Modules bundled into one file for network delivery.`);
  lines.push(`// This is a "lazy" chunk — it loads on-demand when import() is called.`);
  lines.push(`// It pushes its chunk IDs and module factories into the global callback`);
  lines.push(`// array, which the main chunk's runtime picks up and registers.`);
  lines.push(`//`);
  lines.push(`// Structure: [chunkIds, moduleFactories]`);
  lines.push(`//   chunkIds — array of chunk IDs this file fulfills`);
  lines.push(`//   moduleFactories — object mapping module IDs to factory functions`);
  lines.push(`(self["bundlerChunkCallbacks"] = self["bundlerChunkCallbacks"] || []).push([`);
  lines.push(`  ["${chunkId}"],`);
  lines.push(`  {`);

  const moduleIds = [...chunk.moduleIds];
  for (let i = 0; i < moduleIds.length; i++) {
    const moduleId = moduleIds[i];
    const info = modules.get(moduleId);
    const transformed = transformModule(info, projectRoot);
    const indented = indentCode(transformed, '      ');

    lines.push(``);
    lines.push(`    // ---- Module: ${moduleId} ----`);
    lines.push(`    "${moduleId}": (module, exports, loadModule) => {`);
    lines.push(indented);
    lines.push(`    },`);
  }

  lines.push(`  }`);
  lines.push(`]);`);

  return lines.join('\n');
}

/**
 * Indent a block of code by a given prefix.
 */
function indentCode(code, prefix) {
  return code
    .split('\n')
    .map(line => (line.trim() ? prefix + line : ''))
    .join('\n');
}

module.exports = { generateBundles };
