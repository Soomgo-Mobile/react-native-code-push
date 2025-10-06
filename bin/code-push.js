#!/usr/bin/env node

import('../cli/dist/index.js').catch((error) => {
  console.error(error);
  process.exit(1);
});
