import shell from "shelljs";

/**
 * @param deleteDirs {string[]} Directories to delete
 * @param makeDir {string} Directory path to create
 */
export function prepareToBundleJS({ deleteDirs, makeDir }: { deleteDirs: string[], makeDir: string }) {
    shell.rm('-rf', deleteDirs);
    shell.mkdir('-p', makeDir);
}
