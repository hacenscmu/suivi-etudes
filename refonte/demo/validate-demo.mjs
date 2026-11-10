import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const dossier = new URL("./", import.meta.url);
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const sources = [...html.matchAll(/<script\s+src="\.\/([^"]+)"\s*><\/script>/gi)].map(m => m[1]);
assert.deepEqual(sources, ["hac-core.js", "app.js"], "L'interface doit charger le cœur métier puis l'application.");
assert.equal([...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].length, 0, "Aucun script inline : le code doit rester modulaire.");

for (const source of sources) {
  const content = readFileSync(new URL("./" + source, import.meta.url), "utf8");
  new Function(content);
  assert.ok(!/\b(fetch|XMLHttpRequest)\s*\(/.test(content), source + " ne doit pas effectuer de requête réseau.");
  assert.ok(!/localStorage|sessionStorage/.test(content), source + " ne doit pas utiliser de stockage local.");
}

const contexte = {};
vm.runInNewContext(readFileSync(new URL("./hac-core.js", import.meta.url), "utf8"), contexte);
assert.equal(typeof contexte.HAC?.construireVueApplication, "function");
assert.equal(typeof contexte.HAC?.preparerAjout, "function");
const etatVide = contexte.HAC.creerEtatVide();
const vueVide = contexte.HAC.construireVueApplication(etatVide, { dateFin: "2026-11-10" });
assert.equal(vueVide.valide, true, "Le bundle doit assembler un état vide valide.");

for (const label of ["Accueil", "Études", "Finances", "Équipe", "Réglages"]) {
  assert.ok(html.includes(label), "Onglet manquant : " + label);
}
assert.ok(html.includes("données entièrement fictives"), "Le bandeau de données fictives doit rester visible.");
assert.ok(html.includes("Aucune connexion à la base HAC"), "La séparation de la production doit être explicite.");
process.stdout.write("Interface vérifiée : bundle exécutable, modules chargés, 5 onglets, bac à sable sans réseau ni stockage persistant.\n");
