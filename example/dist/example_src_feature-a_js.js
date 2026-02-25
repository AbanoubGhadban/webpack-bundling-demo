// ================================================================
// LAZY CHUNK: example_src_feature-a_js
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
  ["example_src_feature-a_js"],
  {

    // ---- Module: ./example/src/feature-a.js ----
    "./example/src/feature-a.js": (module, exports, loadModule) => {
      loadModule.markAsESModule(exports);

      loadModule.defineExports(exports, {
          "runFeatureA": () => runFeatureA
      });

      var _shared_utils_ = loadModule("./example/src/shared-utils.js");

      function runFeatureA() {
        (0, _shared_utils_.logResult)("Feature A", "loaded and running!");
        return "Feature A result";
      }
    },
  }
]);