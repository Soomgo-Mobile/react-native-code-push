import path from "path";
import { spawnSync } from "child_process";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
// @ts-expect-error -- types for "xcode" are not available
import xcode from "xcode";

jest.mock("expo/config-plugins", () => ({
    createRunOncePlugin: (plugin: unknown) => plugin,
    withMainApplication: (config: unknown) => config,
    withAppDelegate: (config: unknown) => config,
    withAppBuildGradle: (config: { gradle: unknown }, apply: (action: unknown) => void) => {
        apply({ modResults: config.gradle });
        return config;
    },
    withXcodeProject: (config: { project: unknown }, apply: (action: unknown) => void) => {
        apply({ modResults: config.project, modRequest: { projectRoot: "" } });
        return config;
    },
}), { virtual: true });

jest.mock("@expo/config-plugins/build/ios/Paths", () => ({
    getAppDelegate: () => ({ language: "objc" }),
}), { virtual: true });

const withCodePush = require("../withCodePush.js");
const fixturePath = path.resolve(__dirname, "../../../Examples/RN0773/ios/RN0773.xcodeproj/project.pbxproj");
const exportScript = '"$SRCROOT/../node_modules/@bravemobile/react-native-code-push/scripts/export-embedded-bundle.sh"';

describe("Expo diff update setup", () => {
    let config: { gradle: { language: string; contents: string }; project: ReturnType<typeof xcode.project> };

    beforeEach(() => {
        const project = xcode.project(fixturePath);
        project.parseSync();
        const phase = project.buildPhaseObject("PBXShellScriptBuildPhase", "Bundle React Native code and images");
        phase.shellScript = JSON.stringify('export BUNDLE_COMMAND="export:embed"\n"$REACT_NATIVE_XCODE"\n');
        config = {
            gradle: { language: "groovy", contents: 'apply plugin: "com.facebook.react"\n' },
            project,
        };
    });

    it.each([undefined, { diffUpdates: false }])("leaves build files unchanged when disabled (%p)", (options) => {
        const gradle = config.gradle.contents;
        const project = config.project.writeSync();
        withCodePush(config, options);
        expect(config.gradle.contents).toBe(gradle);
        expect(config.project.writeSync()).toBe(project);
    });

    it("adds export hooks once while preserving the Expo bundle script", () => {
        const phase = config.project.buildPhaseObject("PBXShellScriptBuildPhase", "Bundle React Native code and images");
        const originalScript = JSON.parse(phase.shellScript);
        withCodePush(config, { diffUpdates: true });
        const firstGradle = config.gradle.contents;
        const firstProject = config.project.writeSync();
        withCodePush(config, { diffUpdates: true });
        expect(config.gradle.contents).toBe(firstGradle);
        expect(config.project.writeSync()).toBe(firstProject);
        expect(firstGradle).toContain('apply from: "../../node_modules/@bravemobile/react-native-code-push/android/codepush-export.gradle"');
        expect(JSON.parse(phase.shellScript)).toBe(`set -e\n${originalScript}\n${exportScript}\n`);
    });

    it("does not duplicate an existing set -e command", () => {
        const phase = config.project.buildPhaseObject("PBXShellScriptBuildPhase", "Bundle React Native code and images");
        phase.shellScript = JSON.stringify("set -e\n\noriginal bundle command\n");
        withCodePush(config, { diffUpdates: true });
        const script = JSON.parse(phase.shellScript);
        expect(script.match(/^set -e$/gm)).toHaveLength(1);
        expect(script).toBe(`set -e\n\noriginal bundle command\n\n${exportScript}\n`);
    });

    it("preserves manually configured export hooks", () => {
        config.gradle.contents += 'apply from: "/custom/codepush-export.gradle"\n';
        const phase = config.project.buildPhaseObject("PBXShellScriptBuildPhase", "Bundle React Native code and images");
        phase.shellScript = JSON.stringify('"/custom/export-embedded-bundle.sh"\n');
        const gradle = config.gradle.contents;
        const project = config.project.writeSync();
        withCodePush(config, { diffUpdates: true });
        expect(config.gradle.contents).toBe(gradle);
        expect(config.project.writeSync()).toBe(project);
    });

    it("keeps bundle failures from being hidden by export", () => {
        const phase = config.project.buildPhaseObject("PBXShellScriptBuildPhase", "Bundle React Native code and images");
        phase.shellScript = JSON.stringify('/bin/false\n');
        withCodePush(config, { diffUpdates: true });
        const script = JSON.parse(phase.shellScript).replace(exportScript, "exit 0");
        expect(spawnSync("/bin/bash", ["-c", script]).status).toBe(1);
    });

    it("fails when the app target has no bundle phase", () => {
        const target = config.project.getTarget("com.apple.product-type.application").target;
        target.buildPhases = target.buildPhases.filter((phase: { comment: string }) => phase.comment !== "Bundle React Native code and images");
        expect(() => withCodePush(config, { diffUpdates: true })).toThrow("Bundle React Native code and images");
    });

    it("rejects Kotlin Gradle scripts", () => {
        config.gradle.language = "kotlin";
        expect(() => withCodePush(config, { diffUpdates: true })).toThrow("build.gradle");
    });
});
