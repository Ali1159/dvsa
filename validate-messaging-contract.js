const fs = require('fs');
const path = require('path');

function extractMessageTypes(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const match = src.match(/const MESSAGE_TYPES = \{([\s\S]*?)\};/);
  if (!match) {
    throw new Error(`MESSAGE_TYPES constant not found in ${filePath}`);
  }

  const result = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/\s*([A-Z_]+):\s*'([^']+)'/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = __dirname;
const background = extractMessageTypes(path.join(root, 'background.js'));
const content = extractMessageTypes(path.join(root, 'content.js'));

const requiredSharedKeys = [
  'REGISTER_TAB',
  'SNIPE_STATUS_UPDATE',
  'GET_PAGE_INFO',
  'EXECUTE_HTTP_SNIPE',
  'EXECUTE_SNIPE',
  'SNIPE_STATUS',
  'SNIPE_FAILED'
];

for (const key of requiredSharedKeys) {
  assert(background[key], `Missing ${key} in background.js MESSAGE_TYPES`);
  assert(content[key], `Missing ${key} in content.js MESSAGE_TYPES`);
  assert(
    background[key] === content[key],
    `Mismatch for ${key}: background=${background[key]} content=${content[key]}`
  );
}

console.log('✅ Messaging contract validated between background.js and content.js');
