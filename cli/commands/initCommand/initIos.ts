import path from "path";
import fs from "fs";
// @ts-expect-error -- types for "xcode" are not available
import xcode from "xcode";

export async function initIos() {
    console.log('log: Running iOS setup...');
    const projectDir = path.join(process.cwd(), 'ios');
    const files = fs.readdirSync(projectDir);
    const xcodeprojFile = files.find(file => file.endsWith('.xcodeproj'));
    if (!xcodeprojFile) {
        console.log('log: Could not find .xcodeproj file in ios directory');
        return;
    }
    const projectName = xcodeprojFile.replace('.xcodeproj', '');
    const appDelegatePath = findAppDelegate(path.join(projectDir, projectName));

    if (!appDelegatePath) {
        console.log('log: Could not find AppDelegate file');
        return;
    }

    if (appDelegatePath.endsWith('.swift')) {
        await setupSwift(appDelegatePath, projectDir, projectName);
    } else {
        await setupObjectiveC(appDelegatePath);
    }

    console.log('log: Please run `cd ios && pod install` to complete the setup.');
}

function findAppDelegate(searchPath: string) {
    if (!fs.existsSync(searchPath)) return null;
    const files = fs.readdirSync(searchPath);
    const appDelegateFile = files.find(file => file.startsWith('AppDelegate') && (file.endsWith('.m') || file.endsWith('.mm') || file.endsWith('.swift')));
    return appDelegateFile ? path.join(searchPath, appDelegateFile) : null;
}

export function modifyObjectiveCAppDelegate(appDelegateContent: string) {
    const IMPORT_STATEMENT = '#import <CodePush/CodePush.h>';
    if (appDelegateContent.includes(IMPORT_STATEMENT)) {
        console.log('log: AppDelegate already has CodePush imported.');
        return appDelegateContent;
    }

    return appDelegateContent
        .replace('#import "AppDelegate.h"\n', `#import "AppDelegate.h"\n${IMPORT_STATEMENT}\n`)
        .replace('[[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];', '[CodePush bundleURL];');
}

export function modifySwiftAppDelegate(appDelegateContent: string) {
    const CODEPUSH_CALL_STATEMENT = 'CodePush.bundleURL()';
    if (appDelegateContent.includes(CODEPUSH_CALL_STATEMENT)) {
        console.log('log: AppDelegate.swift already configured for CodePush.');
        return appDelegateContent;
    }

    return appDelegateContent
        .replace('Bundle.main.url(forResource: "main", withExtension: "jsbundle")', CODEPUSH_CALL_STATEMENT);
}

async function setupObjectiveC(appDelegatePath: string) {
    const appDelegateContent = fs.readFileSync(appDelegatePath, 'utf-8');
    const newContent = modifyObjectiveCAppDelegate(appDelegateContent);
    fs.writeFileSync(appDelegatePath, newContent);
    console.log('log: Successfully updated AppDelegate.m/mm.');
}

async function setupSwift(appDelegatePath: string, projectDir: string, projectName: string) {
    const bridgingHeaderPath = await ensureBridgingHeader(projectDir, projectName);
    if (!bridgingHeaderPath) {
        console.log('log: Failed to create or find bridging header.');
        return;
    }

    const appDelegateContent = fs.readFileSync(appDelegatePath, 'utf-8');
    const newContent = modifySwiftAppDelegate(appDelegateContent);
    fs.writeFileSync(appDelegatePath, newContent);
    console.log('log: Successfully updated AppDelegate.swift.');
}

async function ensureBridgingHeader(projectDir: string, projectName: string) {
    const projectPath = path.join(projectDir, `${projectName}.xcodeproj`, 'project.pbxproj');
    const myProj = xcode.project(projectPath);

    return new Promise((resolve, reject) => {
        myProj.parse(function (err: unknown) {
            if (err) {
                console.error(`Error parsing Xcode project: ${err}`);
                return reject(err);
            }

            const bridgingHeaderRelativePath = `${projectName}/${projectName}-Bridging-Header.h`;
            const bridgingHeaderAbsolutePath = path.join(projectDir, bridgingHeaderRelativePath);

            const configurations = myProj.pbxXCBuildConfigurationSection();
            for (const name in configurations) {
                const config = configurations[name];
                if (config.buildSettings) {
                    config.buildSettings.SWIFT_OBJC_BRIDGING_HEADER = `"${bridgingHeaderRelativePath}"`;
                }
            }

            if (!fs.existsSync(bridgingHeaderAbsolutePath)) {
                fs.mkdirSync(path.dirname(bridgingHeaderAbsolutePath), { recursive: true });
                fs.writeFileSync(bridgingHeaderAbsolutePath, '#import <CodePush/CodePush.h>\n');
                console.log(`log: Created bridging header at ${bridgingHeaderAbsolutePath}`);
                const groupKey = myProj.findPBXGroupKey({ name: projectName });
                myProj.addHeaderFile(bridgingHeaderRelativePath, { public: true }, groupKey);
            } else {
                const headerContent = fs.readFileSync(bridgingHeaderAbsolutePath, 'utf-8');
                if (!headerContent.includes('#import <CodePush/CodePush.h>')) {
                    fs.appendFileSync(bridgingHeaderAbsolutePath, '\n#import <CodePush/CodePush.h>\n');
                    console.log(`log: Updated bridging header at ${bridgingHeaderAbsolutePath}`);
                }
            }

            fs.writeFileSync(projectPath, myProj.writeSync());
            console.log('log: Updated Xcode project with bridging header path.');
            resolve(bridgingHeaderAbsolutePath);
        });
    });
}
