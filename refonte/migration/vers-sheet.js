/**
 * Transforme un aperçu de migration (migrer-v11) en lignes pour la feuille « Données » d'une COPIE du tableur.
 * Format attendu par Code.gs v3 : [collection | id | json], une fiche par ligne, version 1.
 * Les anciennes lignes « temps » sont recopiées telles quelles (lecture seule en v3) pour garder l'historique.
 * Refuse de produire quoi que ce soit si l'aperçu est bloqué ou contient des fiches sans identifiant.
 */
const CHAMPS_APERCU = ["sourceLegacyId", "etatSuppose", "typeSuppose", "bvHistorique"];

function versLignesSheet(apercu, { exportV11 = null, maintenant = new Date().toISOString(), inclureTemps = true, verifie = false } = {}) {
  if (!apercu || apercu.statut === "bloquee" || !apercu.collections) throw new Error("Aperçu non prêt : traitez d'abord les anomalies bloquantes.");
  // Un aperçu « à vérifier » n'est chargé que si Pauline a relu le rapport (option verifie).
  if (apercu.statut !== "apercu_pret" && !verifie) throw new Error("Aperçu à vérifier : relisez le rapport puis relancez avec la confirmation.");
  const lignes = [["collection", "id", "json"]];
  const vus = new Set();
  const ajouter = (col, o, garderAnnotations) => {
    if (!o || typeof o.id !== "string" || !o.id) throw new Error("Fiche sans identifiant dans " + col);
    const cle = col + "\u0001" + o.id;
    if (vus.has(cle)) throw new Error("Identifiant en double : " + col + "/" + o.id);
    vus.add(cle);
    const fiche = { ...o };
    if (!garderAnnotations) CHAMPS_APERCU.forEach(f => delete fiche[f]);
    fiche._v = 1; fiche._par = "migration"; fiche._le = maintenant;
    lignes.push([col, o.id, JSON.stringify(fiche)]);
  };
  const C = apercu.collections;
  for (const col of ["clients", "membres", "etudes", "factures", "interventions", "formation", "bvs", "lignesBV"]) {
    // Les annotations (état supposé, BV non ventilé, id source) sont gardées sur les fiches : elles restent visibles pour vérification.
    (C[col] || []).forEach(o => ajouter(col, o, true));
  }
  if (C.config) ajouter("config", { ...C.config, id: "main" }, false);
  if (inclureTemps && exportV11) {
    const d = exportV11.data || exportV11;
    Object.entries(d.temps || {}).forEach(([id, t]) => { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(id)) return; lignes.push(["temps", id, JSON.stringify(t)]); });
  }
  return lignes;
}

/** CSV (séparateur virgule, guillemets doublés) à importer dans Google Sheets : Fichier → Importer → Remplacer la feuille. */
function versCsv(lignes) {
  return lignes.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n") + "\n";
}

module.exports = { versLignesSheet, versCsv };

if (require.main === module) {
  const fs = require("node:fs");
  const { migrerV11 } = require("./migrer-v11");
  const args = process.argv.slice(2), verifie = args.includes("--verifie");
  const [exportFichier, corr, sortie = "donnees-v3.csv"] = args.filter(a => a !== "--verifie");
  if (!exportFichier) { console.error("Usage : node vers-sheet.js export.json [correspondances.json] [sortie.csv] [--verifie]"); process.exit(2); }
  const exp = JSON.parse(fs.readFileSync(exportFichier, "utf8"));
  const apercu = migrerV11(exp, { correspondances: corr ? JSON.parse(fs.readFileSync(corr, "utf8")) : {} });
  fs.writeFileSync(sortie, versCsv(versLignesSheet(apercu, { exportV11: exp, verifie })));
  console.log("Fichier écrit : " + sortie + " (à importer dans la feuille « Données » d'une COPIE du tableur)");
}
