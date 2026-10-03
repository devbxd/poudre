// Compares a rendered HTML fragment with the original one and prints the first differences.
export function compare(label, original, rendered) {
  if (original === rendered) {
    console.log(`✓ ${label} identical (${original.length} chars)`);
    return true;
  }
  let i = 0;
  while (i < original.length && original[i] === rendered[i]) i++;
  console.log(`✗ ${label} differs at char ${i} (original ${original.length}, rendered ${rendered.length})`);
  console.log('   original:', JSON.stringify(original.slice(Math.max(0, i - 120), i + 160)));
  console.log('   rendered:', JSON.stringify(rendered.slice(Math.max(0, i - 120), i + 160)));
  return false;
}
