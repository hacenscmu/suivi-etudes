import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/gi)];

assert.equal(scripts.length, 1, "Le prototype doit contenir un unique script inline.");
new Function(scripts[0][1]);

for (const label of ["Accueil", "Études", "Finances", "Équipe", "Réglages"]) {
  assert.ok(html.includes(label), `Onglet manquant : ${label}`);
}

assert.ok(html.includes("données entièrement fictives"), "Le bandeau de données fictives doit rester visible.");
assert.ok(html.includes("Aucune connexion à la base HAC"), "La séparation de la production doit être explicite.");
assert.ok(!/\\b(fetch|XMLHttpRequest)\\s*\\(/.test(scripts[0][1]), "Le prototype ne doit pas effectuer de requête réseau.");
assert.ok(!/localStorage|sessionStorage/.test(scripts[0][1]), "Le prototype ne doit pas accéder au stockage local.");

process.stdout.write("Prototype vérifié : syntaxe JavaScript valide, 5 onglets présents, données fictives et aucune connexion réseau/stockage.\\n");
