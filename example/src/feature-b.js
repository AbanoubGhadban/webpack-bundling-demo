import { logResult } from './shared-utils.js';

export function runFeatureB() {
  logResult("Feature B", "loaded and running!");
  return "Feature B result";
}
