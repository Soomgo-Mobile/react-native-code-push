import fs from "fs";
import path from "path";
import yauzl from "yauzl";

export function unzip(zipPath: string, outputDir: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (err, zipFile) => {
            if (err) return reject(err);

            zipFile.readEntry();

            zipFile.on("entry", (entry) => {
                const fullPath = path.join(outputDir, entry.fileName);

                // Handle directory entry
                if (/\/$/.test(entry.fileName)) {
                    fs.mkdir(fullPath, { recursive: true }, (err) => {
                        if (err) return reject(err);
                        zipFile.readEntry();
                    });
                    return;
                }

                // Handle file entry
                zipFile.openReadStream(entry, (err, readStream) => {
                    if (err) return reject(err);

                    fs.mkdir(path.dirname(fullPath), { recursive: true }, (err) => {
                        if (err) return reject(err);

                        const writeStream = fs.createWriteStream(fullPath);
                        readStream.pipe(writeStream);

                        // Continue to the next entry after writing
                        writeStream.on("close", () => {
                            zipFile.readEntry();
                        });
                    });
                });
            });

          zipFile.on("end", resolve);
          zipFile.on("error", reject);
        });
    });
}
