/**
 * Rejoue contre le VRAI Code.gs (via le simulateur) les suites écrites pour le faux serveur v3 :
 * mock-serveur-v3.test.js, integration-v3.test.js et file-hors-ligne.test.js.
 * Le module « mock-serveur-v3 » est remplacé, pour ces suites seulement, par le simulateur Apps Script.
 */
const path = require("node:path");
const Module = require("node:module");
const { creerServeurAppsScriptSimule } = require("./simulateur");

const cible = require.resolve("../mock-serveur-v3");
const charger = Module._load;
Module._load = function (request, parent, isMain) {
  if (Module._resolveFilename(request, parent, isMain) === cible) return { creerServeurMemoireV3: creerServeurAppsScriptSimule };
  return charger.apply(this, arguments);
};
for (const f of ["mock-serveur-v3.test.js", "integration-v3.test.js", "file-hors-ligne.test.js"]) require(path.join(__dirname, "..", f));
