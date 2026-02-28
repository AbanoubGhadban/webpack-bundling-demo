export function formatResult(label, value) {
  return `[${label}]: ${value}`;
}

export function logResult(label, value) {
  console.log(formatResult(label, value));
}
