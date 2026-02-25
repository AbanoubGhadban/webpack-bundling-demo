import { add, PI } from './utils/math.js';
import greet, { farewell } from './utils/greet.js';

// Static imports — these modules are in the main chunk
console.log("PI is:", PI);
console.log("2 + 3 =", add(2, 3));
console.log(greet("World"));
console.log(farewell("World"));

// Dynamic imports — these create lazy chunks loaded on demand
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
