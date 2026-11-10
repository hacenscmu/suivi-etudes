/**
 * Construit le petit bundle navigateur HAC sans dépendance externe.
 * Usage : node refonte/build/build-browser.mjs
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modules = [
  "domain/identites.js",
  "domain/factures.js",
  "domain/etudes.js",
  "domain/interventions.js",
  "domain/bv.js",
  "domain/tableau-de-bord.js",
  "application/lecture.js",
  "application/commandes.js",
];

const definitions = [];
for (const id of modules) {
  const source = await readFile(path.join(racine, id), "utf8");
  definitions.push(
    JSON.stringify(id) + ": function(require, module, exports) {\n" + source + "\n}"
  );
}

const bundle = `/* Généré par refonte/build/build-browser.mjs — ne pas modifier à la main. */
(function (global) {
  "use strict";
  const definitions = {
${definitions.map((d, i) => "    " + d.replaceAll("\n", "\n    ") + (i < definitions.length - 1 ? "," : "")).join("\n")}
  };
  const cache = Object.create(null);

  function resoudre(parent, demande) {
    const segments = demande.startsWith(".")
      ? parent.split("/").slice(0, -1).concat(demande.split("/"))
      : demande.split("/");
    const normalises = [];
    for (const segment of segments) {
      if (!segment || segment === ".") continue;
      if (segment === "..") normalises.pop();
      else normalises.push(segment);
    }
    let id = normalises.join("/");
    if (!id.endsWith(".js")) id += ".js";
    if (!Object.prototype.hasOwnProperty.call(definitions, id)) {
      throw new Error("Module HAC introuvable : " + id);
    }
    return id;
  }

  function charger(id) {
    if (cache[id]) return cache[id].exports;
    const module = { exports: {} };
    cache[id] = module;
    definitions[id](
      demande => charger(resoudre(id, demande)),
      module,
      module.exports
    );
    return module.exports;
  }

  global.HAC = Object.freeze({
    ...charger("application/lecture.js"),
    ...charger("application/commandes.js")
  });
})(globalThis);
`;

const sortie = path.join(racine, "demo", "hac-core.js");
await mkdir(path.dirname(sortie), { recursive: true });
await writeFile(sortie, bundle, "utf8");
process.stdout.write("Bundle HAC généré : " + path.relative(process.cwd(), sortie) + "\n");
