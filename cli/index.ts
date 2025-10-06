#!/usr/bin/env node

import { program } from "commander";
import shell from "shelljs";
import { showLogo } from "./utils/showLogo.js";

/**
 * npx code-push bundle
 */
import "./commands/bundleCommand/index.js";

/**
 * npx code-push create-history
 */
import "./commands/createHistoryCommand/index.js";

/**
 * npx code-push update-history
 */
import "./commands/updateHistoryCommand/index.js";

/**
 * npx code-push release
 */
import "./commands/releaseCommand/index.js";

/**
 * npx code-push show-history
 */
import "./commands/showHistoryCommand/index.js";

/**
 * npx code-push init
 */
import "./commands/initCommand/index.js";

shell.set("-e");
shell.set("+v");

program
    .name("npx code-push")
    .description("Command line interface for @bravemobile/react-native-code-push")
    .version("1.0.0")
    .action(() => {
        showLogo();
    });

program.parse();
