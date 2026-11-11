/**
 * Exécute le vrai Code.gs dans Node avec de faux services Google en mémoire.
 * Même interface que creerServeurMemoireV3 : { transport, lireDonnees, lireRevision }.
 * Sert à rejouer contre Code.gs les tests écrits pour le faux serveur v3.
 * Aucun réseau, aucun service Google réel, aucune donnée de production.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = fs.readFileSync(process.env.HAC_CODE_GS || path.join(__dirname, "Code.gs"), "utf8");

function feuille(entetes, crochets) {
  const rows = [entetes.slice()];
  const ecrire = (nom, f) => { if (crochets.panne && crochets.panne(nom)) throw new Error("PANNE SIMULÉE"); f(); };
  return (nom) => ({
    rows,
    getLastRow: () => rows.length,
    getLastColumn: () => entetes.length,
    getRange: (r, c, n = 1, w = 1) => ({
      getValues: () => rows.slice(r - 1, r - 1 + n).map(x => x.slice(c - 1, c - 1 + w)),
      setValue: v => ecrire(nom, () => { rows[r - 1][c - 1] = v; }),
    }),
    appendRow: a => ecrire(nom, () => rows.push(a.slice())),
    deleteRow: r => ecrire(nom, () => rows.splice(r - 1, 1)),
  });
}

function creerServeurAppsScriptSimule({ token, donnees = {}, maxBytes, membre = "membre_test", role = "Membre", crochets = {} } = {}) {
  if (typeof token !== "string" || token.trim() === "") throw new TypeError("Le serveur simulé exige un token non vide");
  const noms = { "Données": ["collection", "id", "json"], "Journal": ["opId", "empreinte", "reponse", "date", "etat", "collection", "id", "membre", "reserve1", "reserve2"], "Quarantaine": ["date", "ligne", "collection", "id", "brut"] };
  const feuilles = Object.fromEntries(Object.entries(noms).map(([n, e]) => [n, feuille(e, crochets)(n)]));
  const props = { SSID: "copie-de-test", TOKENS: JSON.stringify({ [membre]: { h: crypto.createHash("sha256").update(token, "utf8").digest("hex"), hash: crypto.createHash("sha256").update(token, "utf8").digest("hex"), active: true, role } }) };
  for (const [col, fiches] of Object.entries(donnees)) for (const [id, o] of Object.entries(fiches || {})) feuilles["Données"].rows.push([col, id, JSON.stringify(o)]);
  const journaux = [];
  const G = {
    ContentService: { MimeType: { JSON: 1 }, createTextOutput: s => ({ setMimeType: () => s }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 },
      computeDigest: (a, s) => [...crypto.createHash("sha256").update(s, "utf8").digest()].map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      newBlob: s => ({ getBytes: () => ({ length: Buffer.byteLength(s, "utf8") }) }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => feuilles[n] || null }) },
    console: { log: (...a) => journaux.push(a.join(" ")) },
  };
  const src = maxBytes ? SOURCE.replace(/MAX_FICHE = \d+/, "MAX_FICHE = " + Number(maxBytes)) : SOURCE;
  const api = new Function(...Object.keys(G), src + "\n;return { doPost, enregistrerJeton: typeof enregistrerJeton!=='undefined'?enregistrerJeton:null, revoquerJeton, mettreEnQuarantaine: typeof mettreEnQuarantaine!=='undefined'?mettreEnQuarantaine:null };")(...Object.values(G));

  async function transport(requete) {
    const body = JSON.parse(api.doPost({ postData: { contents: JSON.stringify(requete) } }));
    return { status: 200, body }; // Apps Script renvoie toujours HTTP 200 : le client se fonde sur ok / error.code
  }
  function lireDonnees() {
    const out = {};
    for (const c of ["etudes", "clients", "membres", "factures", "interventions", "bvs", "lignesBV", "formation", "config", "appareils", "temps"]) out[c] = {};
    feuilles["Données"].rows.slice(1).forEach(r => { try { const o = JSON.parse(r[2]); (out[r[0]] = out[r[0]] || {})[r[1]] = o; } catch { /* ligne corrompue */ } });
    return out;
  }
  return Object.freeze({ transport, lireDonnees, lireRevision: () => Number(props.REVISION || 0), feuilles, props, journaux, api });
}

module.exports = { creerServeurAppsScriptSimule };
