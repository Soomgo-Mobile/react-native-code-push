import path from "path";
import fs from "fs";
import { EOL } from "os";

const IMPORT_CODE_PUSH = 'import com.microsoft.codepush.react.CodePush';
const RN_LEGACY_MARKER = 'object : DefaultReactNativeHost(this)';
const RN_082_MARKER = '  getDefaultReactHost(';

export function modifyMainApplicationKt(mainApplicationContent: string) {
    const hasCodePushImport = mainApplicationContent.includes(IMPORT_CODE_PUSH);
    const hasGetJSBundleFileFn = mainApplicationContent.includes('CodePush.getJSBundleFile()');

    if (hasCodePushImport && hasGetJSBundleFileFn) {
        console.log('log: MainApplication.kt already has CodePush initialized.');
        return mainApplicationContent;
    }

    let updatedContent = mainApplicationContent;

    if (!hasCodePushImport) {
        updatedContent = mainApplicationContent.replace('import com.facebook.react.ReactApplication', `import com.facebook.react.ReactApplication${EOL}${IMPORT_CODE_PUSH}`);
    }

    const isExtendingDefaultReactNativeHost = mainApplicationContent.includes(RN_LEGACY_MARKER);

    // RN <0.82
    if (isExtendingDefaultReactNativeHost) {
        if (!hasGetJSBundleFileFn) {
            updatedContent = updatedContent.replace('override fun getJSMainModuleName(): String = "index"', `override fun getJSMainModuleName(): String = "index"${EOL}        override fun getJSBundleFile(): String = CodePush.getJSBundleFile()`);
        }
        return updatedContent;
    }

    // RN 0.82+
    const isUsingGetDefaultReactHost = mainApplicationContent.includes(RN_082_MARKER);
    if (isUsingGetDefaultReactHost) {
        if (!hasGetJSBundleFileFn) {
            return addJsBundleFilePathArgument(updatedContent);
        }
        return updatedContent;
    }

    throw new Error('Unsupported MainApplication.kt structure.');
}

function addJsBundleFilePathArgument(mainApplicationContent: string) {
    const packageListArgumentPattern = /(packageList\s*=\s*\n\s*PackageList\(this\)[\s\S]+?\},?\s*\n)/;

    if (!packageListArgumentPattern.test(mainApplicationContent)) {
        console.log('log: Could not find packageList argument while updating MainApplication.kt.');
        return mainApplicationContent;
    }

    return mainApplicationContent.replace(packageListArgumentPattern, (match) => {
        if (match.includes('jsBundleFilePath')) {
            return match;
        }

        return `${match}      jsBundleFilePath = CodePush.getJSBundleFile(),${EOL}`;
    });
}

export async function initAndroid() {
    console.log('log: Running Android setup...');
    await applyMainApplication();
}

async function applyMainApplication() {
    const mainApplicationPath = await findMainApplication();
    if (!mainApplicationPath) {
        console.log('log: Could not find MainApplication.kt');
        return;
    }

    if (mainApplicationPath.endsWith('.java')) {
        console.log('log: MainApplication.java is not supported. Please migrate to MainApplication.kt.');
        return;
    }

    const mainApplicationContent = fs.readFileSync(mainApplicationPath, 'utf-8');
    const newContent = modifyMainApplicationKt(mainApplicationContent);
    fs.writeFileSync(mainApplicationPath, newContent);
    console.log('log: Successfully updated MainApplication.kt.');
}

async function findMainApplication() {
    const searchPath = path.join(process.cwd(), 'android', 'app', 'src', 'main', 'java');
    const files = fs.readdirSync(searchPath, { encoding: 'utf-8', recursive: true });
    const mainApplicationFile = files.find(file => file.endsWith('MainApplication.java') || file.endsWith('MainApplication.kt'));
    return mainApplicationFile ? path.join(searchPath, mainApplicationFile) : null;
}
