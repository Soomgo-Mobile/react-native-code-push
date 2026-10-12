import { initAndroid } from "./initAndroid.js";
import { initIos } from "./initIos.js";
import { program } from "commander";

program
    .command('init')
    .description('Automatically performs iOS/Android native configurations to initialize the CodePush project.')
    .option('--diff-updates', 'export embedded JS bundles during native builds for diff update releases', false)
    .action(async (options: { diffUpdates: boolean }) => {
        console.log('log: Start initializing CodePush...');
        await initAndroid(options.diffUpdates);
        await initIos(options.diffUpdates);
        console.log('log: CodePush has been successfully initialized.');
    });
