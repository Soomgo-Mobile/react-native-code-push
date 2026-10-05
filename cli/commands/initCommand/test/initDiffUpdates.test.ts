import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { program } from "commander";
// @ts-expect-error -- types for "xcode" are not available
import xcode from "xcode";
import { initAndroid } from "../initAndroid.js";
import { initIos } from "../initIos.js";
import "../index.js";

const fixturePath = path.resolve(__dirname, "../../../../Examples/RN0773/ios/RN0773.xcodeproj/project.pbxproj");
const exportScript = '"$SRCROOT/../node_modules/@bravemobile/react-native-code-push/scripts/export-embedded-bundle.sh"';
let projectDir: string;
let gradlePath: string;
let projectPath: string;

function readProject() {
    const project = xcode.project(projectPath);
    project.parseSync();
    return project;
}

describe("diff update init", () => {
    beforeEach(() => {
        projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-push-init-"));
        const javaDir = path.join(projectDir, "android/app/src/main/java/com/example");
        fs.mkdirSync(javaDir, { recursive: true });
        fs.writeFileSync(path.join(javaDir, "MainApplication.kt"), 'import com.microsoft.codepush.react.CodePush\n// CodePush.getJSBundleFile()\n');
        gradlePath = path.join(projectDir, "android/app/build.gradle");
        fs.writeFileSync(gradlePath, 'apply plugin: "com.android.application"\napply plugin: "com.facebook.react"\n');
        const iosDir = path.join(projectDir, "ios/RN0773");
        fs.mkdirSync(iosDir, { recursive: true });
        fs.writeFileSync(path.join(iosDir, "AppDelegate.m"), '#import <CodePush/CodePush.h>\n');
        projectPath = path.join(projectDir, "ios/RN0773.xcodeproj/project.pbxproj");
        fs.mkdirSync(path.dirname(projectPath), { recursive: true });
        fs.copyFileSync(fixturePath, projectPath);
        jest.spyOn(process, "cwd").mockReturnValue(projectDir);
        jest.spyOn(console, "log").mockImplementation(() => {});
        program.commands.find(command => command.name() === "init")!.exitOverride();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(projectDir, { recursive: true, force: true });
    });

    it("leaves build files unchanged without the option", async () => {
        const gradle = fs.readFileSync(gradlePath, "utf8");
        const project = fs.readFileSync(projectPath, "utf8");
        await initAndroid();
        await initIos();
        expect(fs.readFileSync(gradlePath, "utf8")).toBe(gradle);
        expect(fs.readFileSync(projectPath, "utf8")).toBe(project);
    });

    it("adds export hooks once when the command is repeated", async () => {
        const before = readProject();
        const originalScript = JSON.parse(before.buildPhaseObject("PBXShellScriptBuildPhase", "Bundle React Native code and images").shellScript);
        await program.parseAsync(["node", "code-push", "init", "--diff-updates"]);
        const firstProject = fs.readFileSync(projectPath, "utf8");
        const firstGradle = fs.readFileSync(gradlePath, "utf8");
        await program.parseAsync(["node", "code-push", "init", "--diff-updates"]);
        expect(fs.readFileSync(projectPath, "utf8")).toBe(firstProject);
        expect(fs.readFileSync(gradlePath, "utf8")).toBe(firstGradle);
        expect(firstGradle).toContain('apply from: "../../node_modules/@bravemobile/react-native-code-push/android/codepush-export.gradle"');
        const after = readProject();
        const script = JSON.parse(after.buildPhaseObject("PBXShellScriptBuildPhase", "Bundle React Native code and images").shellScript);
        expect(script).toBe(`${originalScript}\n${exportScript}\n`);
        expect(after.buildPhaseObject("PBXShellScriptBuildPhase", "[CP] Embed Pods Frameworks")).toEqual(before.buildPhaseObject("PBXShellScriptBuildPhase", "[CP] Embed Pods Frameworks"));
    });

    it("adds the export hook for a Swift app", async () => {
        const appDir = path.join(projectDir, "ios/RN0773");
        fs.unlinkSync(path.join(appDir, "AppDelegate.m"));
        fs.writeFileSync(path.join(appDir, "AppDelegate.swift"), "CodePush.bundleURL()\n");
        await initIos(true);
        const project = readProject();
        const script = JSON.parse(project.buildPhaseObject("PBXShellScriptBuildPhase", "Bundle React Native code and images").shellScript);
        expect(script).toContain(exportScript);
    });

    it("preserves an existing export hook with a custom path", async () => {
        const gradle = 'apply from: "/custom/codepush-export.gradle"\n';
        fs.writeFileSync(gradlePath, gradle);
        const project = readProject();
        const phase = project.buildPhaseObject("PBXShellScriptBuildPhase", "Bundle React Native code and images");
        phase.shellScript = JSON.stringify('"/custom/export-embedded-bundle.sh"\n');
        fs.writeFileSync(projectPath, project.writeSync());
        const original = fs.readFileSync(projectPath, "utf8");
        await initAndroid(true);
        await initIos(true);
        expect(fs.readFileSync(gradlePath, "utf8")).toBe(gradle);
        expect(fs.readFileSync(projectPath, "utf8")).toBe(original);
    });

    it("fails when the app target has no bundle phase", async () => {
        const project = readProject();
        const target = project.getTarget("com.apple.product-type.application").target;
        target.buildPhases = target.buildPhases.filter((phase: { comment: string }) => phase.comment !== "Bundle React Native code and images");
        fs.writeFileSync(projectPath, project.writeSync());
        await expect(initIos(true)).rejects.toThrow("Bundle React Native code and images");
    });

    it("keeps bundle failures from being hidden by export", async () => {
        const project = readProject();
        const phase = project.buildPhaseObject("PBXShellScriptBuildPhase", "Bundle React Native code and images");
        phase.shellScript = JSON.stringify('/bin/false\n');
        fs.writeFileSync(projectPath, project.writeSync());
        await initIos(true);
        const updatedPhase = readProject().buildPhaseObject("PBXShellScriptBuildPhase", "Bundle React Native code and images");
        const script = JSON.parse(updatedPhase.shellScript).replace(exportScript, "exit 0");
        expect(spawnSync("/bin/bash", ["-c", script]).status).toBe(1);
    });
});
