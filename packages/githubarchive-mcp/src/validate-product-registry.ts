import { getConfig } from './config.js';
import { validateProductRegistry } from './services/product-registry-validator.js';

const config = getConfig();
const result = validateProductRegistry(config.repoRoot);

if (result.errors.length) {
  console.error('Product registry validation failed.');
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log('Product registry validation passed.');
console.log(JSON.stringify(result, null, 2));
