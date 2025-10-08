const Semver = require("semver");
const { BaseVersioning } = require("./BaseVersioning");

class SemverVersioning extends BaseVersioning {
  constructor(releaseHistory) {
    super(releaseHistory, (v1, v2) => (Semver.gt(v1, v2) ? -1 : 1));
  }
}

module.exports = { SemverVersioning };
