// Household lists from files, for the agency CLI and tests; the parsing lives in lib/households.mjs (shared with the browser).
const fs = require("fs")
const { parseLine, parseCommitment, parseHouseholds } = require("./households.mjs")

const readHouseholds = (file, program) => parseHouseholds(fs.readFileSync(file, "utf8"), program, file)

module.exports = { parseLine, readHouseholds, parseCommitment }
