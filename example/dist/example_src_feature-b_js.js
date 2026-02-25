// ================================================================
// LAZY CHUNK: example_src_feature-b_js
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
  ["example_src_feature-b_js"],
  {

    // ---- Module: ./example/src/feature-b.js ----
    "./example/src/feature-b.js": (module, exports, loadModule) => {
      loadModule.markAsESModule(exports);

      loadModule.defineExports(exports, {
          "runFeatureB": () => runFeatureB
      });

      var _shared_utils_ = loadModule("./example/src/shared-utils.js");

      function runFeatureB() {
        (0, _shared_utils_.logResult)("Feature B", "loaded and running!");
        return "Feature B result";
      }
    },
  }
]);