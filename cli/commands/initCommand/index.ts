import { initAndroid } from "./initAndroid.js";
import { initIos } from "./initIos.js";
import { program } from "commander";

program
    .command('init')
    .description('Automatically performs iOS/Android native configurations to initialize the CodePush project.')
    .action(async () => {
        console.log('log: Start initializing CodePush...');
        await initAndroid();
        await initIos();
        console.log('log: CodePush has been successfully initialized.');
    });

