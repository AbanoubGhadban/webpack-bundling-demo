import { logResult } from './shared-utils.js';

export function runFeatureA() {
  logResult("Feature A", "loaded and running!");
  return "Feature A result";
}
