// ================================================================
// LAZY CHUNK: shared_example_src_shared-utils_js
// ================================================================
// A Chunk is a group of Modules bundled into one file for network delivery.
// This is a "lazy" chunk — it loads on-demand when import() is called.
// It pushes its chunk IDs and module factories into the global callback
// array, which the main chunk's runtime picks up and registers.
//
// Structure: [chunkIds, moduleFactories]
//   chunkIds — array of chunk IDs this file fulfills
//   moduleFactories — object mapping module IDs to factory functions
(self["bundlerChunkCallbacks"] = self["bundlerChunkCallbacks"] || []).push([
  ["shared_example_src_shared-utils_js"],
  {

    // ---- Module: ./example/src/shared-utils.js ----
    "./example/src/shared-utils.js": (module, exports, loadModule) => {
      loadModule.markAsESModule(exports);

      loadModule.defineExports(exports, {
          "formatResult": () => formatResult,
          "logResult": () => logResult
      });

      function formatResult(label, value) {
        return `[${label}]: ${value}`;
      }

      function logResult(label, value) {
        console.log(formatResult(label, value));
      }
    },
  }
]);