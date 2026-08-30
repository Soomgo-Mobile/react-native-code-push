const log = require("./logging");

module.exports = function invokeTelemetryCallback(name, callback, ...args) {
  if (typeof callback !== "function") return;

  const logError = (error) => {
    log(`The ${name} callback failed: ${error?.message ?? error}`);
  };

  try {
    const result = callback(...args);
    if (result && typeof result.then === "function") {
      Promise.resolve(result).catch(logError);
    }
  } catch (error) {
    logError(error);
  }
};
