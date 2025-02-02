#!/usr/bin/env node

const { program } = require("commander");
const shell = require("shelljs");
const { showLogo } = require("./utils/showLogo");

shell.set("-e");
shell.set("+v");

program
  .name("npx code-push")
  .description("Command line interface for @bravemobile/react-native-code-push")
  .version("1.0.0")
  .action(() => {
    showLogo();
  });

/**
 * npx code-push bundle
 */
require("./commands/bundleCommand");

/**
 * npx code-push create-history
 */
require('./commands/createHistoryCommand');

/**
 * npx code-push update-history
 */
require('./commands/updateHistoryCommand');

/**
 * npx code-push release
 */
require('./commands/releaseCommand');

require('./commands/uploadCommand');

require('./commands/showHistoryCommand')

program.parse();
