/**
 * HAC refonte — validation métier des bulletins de versement.
 *
 * Un BV regroupe des lignes, une par personne.
 * Règle « minimum de 1 JEH par BV » (app.js v11 l. 181, 186, 490) : ce n'est PAS
 * une interdiction. Un BV de 0,5 JEH est valide : la personne est payée sur 0,5 JEH,
 * mais cotisations et charges sont calculées sur une assiette de 1 JEH.
 * L'assiette est calculée PAR PERSONNE (les cotisations sont individuelles) :
 * assietteJeh = max(jeh, 1) si jeh > 0, sinon 0.
 */

const { estIdValide } = require("./identites");

function assietteJeh(jeh) {
  return jeh > 0 ? Math.max(jeh, 1) : 0;
}

function validerBV(bv) {
  const anomalies = [];
  if (!bv || typeof bv !== "object") {
    return { valide: false, totalJeh: 0, anomalies: ["Bulletin de versement invalide"] };
  }

  const lignes = Array.isArray(bv.lignes) ? bv.lignes : [];
  if (lignes.length === 0) anomalies.push("Le BV doit contenir au moins une ligne");

  const personnes = new Set();
  const assiettes = [];
  let totalJeh = 0;

  lignes.forEach((ligne, index) => {
    if (!ligne || typeof ligne !== "object") {
      anomalies.push({ index, raison: "Ligne invalide" });
      return;
    }

    const personneId = ligne.personneId;
    if (typeof personneId !== "string" || personneId.trim() === "") {
      anomalies.push({ index, raison: "Identifiant de personne manquant" });
    } else if (personnes.has(personneId)) {
      anomalies.push({ index, raison: "Une personne apparaît plusieurs fois sur le même BV" });
    } else {
      personnes.add(personneId);
    }

    const jeh = Number(ligne.jeh);
    if (ligne.jeh === "" || ligne.jeh == null || !Number.isFinite(jeh) || jeh < 0) {
      anomalies.push({ index, raison: "Nombre de JEH absent ou invalide" });
    } else {
      totalJeh += jeh;
      assiettes.push({ personneId, jeh, assietteJeh: assietteJeh(jeh) });
    }
  });

  return { valide: anomalies.length === 0, totalJeh, assiettes, anomalies };
}


function analyserCollectionBVs({ bvs = [], lignesBV = [], membres = [] } = {}) {
  const anomalies = [];
  if (![bvs, lignesBV, membres].every(Array.isArray)) {
    return { valide: false, resume: [], anomalies: ["Les collections BV, lignesBV et membres doivent être des tableaux"] };
  }

  const membresIds = new Set(membres.map(m => m?.id).filter(id => typeof id === "string" && id.trim()));
  const bvsParId = new Map();
  bvs.forEach((bv, index) => {
    if (!bv || typeof bv !== "object" || !estIdValide(bv.id)) {
      anomalies.push({ collection: "bvs", index, raison: "Identifiant de BV absent ou invalide" });
      return;
    }
    if (bvsParId.has(bv.id)) {
      anomalies.push({ collection: "bvs", index, raison: "Identifiant de BV dupliqué", id: bv.id });
      return;
    }
    bvsParId.set(bv.id, { bv, index, lignes: [] });
  });

  const ligneIds = new Set();
  lignesBV.forEach((ligne, index) => {
    if (!ligne || typeof ligne !== "object") {
      anomalies.push({ collection: "lignesBV", index, raison: "Ligne invalide" });
      return;
    }
    if (!estIdValide(ligne.id)) {
      anomalies.push({ collection: "lignesBV", index, raison: "Identifiant de ligne absent ou invalide" });
    } else if (ligneIds.has(ligne.id)) {
      anomalies.push({ collection: "lignesBV", index, raison: "Identifiant de ligne dupliqué", id: ligne.id });
    } else {
      ligneIds.add(ligne.id);
    }

    const parent = estIdValide(ligne.bvId) ? bvsParId.get(ligne.bvId) : null;
    if (!parent) {
      anomalies.push({ collection: "lignesBV", index, raison: "BV parent introuvable" });
    } else {
      parent.lignes.push({ ligne, index });
    }
    if (!estIdValide(ligne.membreId) || !membresIds.has(ligne.membreId)) {
      anomalies.push({ collection: "lignesBV", index, raison: "Membre lié introuvable" });
    }
    const jeh = Number(ligne.jeh);
    if (ligne.jeh === "" || ligne.jeh == null || !Number.isFinite(jeh) || jeh < 0) {
      anomalies.push({ collection: "lignesBV", index, raison: "Nombre de JEH absent ou invalide" });
    }
  });

  const resume = [];
  for (const [bvId, entry] of bvsParId) {
    const personnes = new Set();
    const assiettes = [];
    let totalJeh = 0;
    entry.lignes.forEach(({ ligne, index }) => {
      if (typeof ligne.membreId === "string" && personnes.has(ligne.membreId)) {
        anomalies.push({ collection: "lignesBV", index, raison: "Une personne apparaît plusieurs fois sur le même BV" });
      }
      if (typeof ligne.membreId === "string") personnes.add(ligne.membreId);
      const jeh = Number(ligne.jeh);
      if (ligne.jeh !== "" && ligne.jeh != null && Number.isFinite(jeh) && jeh >= 0) {
        totalJeh += jeh;
        assiettes.push({ membreId: ligne.membreId, jeh, assietteJeh: assietteJeh(jeh) });
      }
    });
    if (entry.lignes.length === 0) {
      anomalies.push({ collection: "bvs", index: entry.index, raison: "Le BV ne contient aucune ligne" });
    }
    resume.push({ bvId, nombreLignes: entry.lignes.length, nombrePersonnes: personnes.size, totalJeh, assiettes });
  }

  return { valide: anomalies.length === 0, resume, anomalies };
}

module.exports = { validerBV, analyserCollectionBVs, assietteJeh };
