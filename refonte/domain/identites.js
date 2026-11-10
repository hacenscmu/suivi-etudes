/**
 * HAC refonte — identités et liens entre objets métier.
 *
 * Les identifiants sont attribués à la création/import contrôlé, puis conservés.
 * Ce module ne fabrique pas d'identifiant à partir d'un prénom, d'un numéro
 * d'étude ou d'un nom de client : ces valeurs ne sont pas nécessairement uniques.
 *
 * Pendant la migration, une référence historique textuelle n'est résolue que
 * si elle correspond à un seul objet. Une correspondance ambiguë est bloquée.
 */

const COLLECTIONS = new Set([
  "clients",
  "membres",
  "etudes",
  "factures",
  "bvs",
  "lignesBV",
]);

const RELATIONS = Object.freeze({
  etude: { collection: "etudes", parent: "clientId" },
  facture: { collection: "factures", parent: "etudeId" },
  bv: { collection: "bvs", parent: null },
  ligneBV: { collection: "lignesBV", parent: "bvId" },
});

function estIdValide(id) {
  return typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(id);
}

function validerIdentite(objet, collection) {
  if (!COLLECTIONS.has(collection)) {
    return { valide: false, anomalie: "Collection inconnue" };
  }
  if (!objet || typeof objet !== "object" || Array.isArray(objet)) {
    return { valide: false, anomalie: "Objet invalide" };
  }
  if (!estIdValide(objet.id)) {
    return { valide: false, anomalie: "Identifiant stable absent ou invalide" };
  }
  return { valide: true, anomalie: null };
}

function verifierUniciteIdentifiants(objets = [], collection) {
  if (!COLLECTIONS.has(collection)) {
    return { valide: false, doublons: [], anomalie: "Collection inconnue" };
  }
  if (!Array.isArray(objets)) {
    return { valide: false, doublons: [], anomalie: "La collection doit être un tableau" };
  }

  const vus = new Set();
  const doublons = [];
  objets.forEach((objet, index) => {
    const id = objet?.id;
    if (!estIdValide(id)) return;
    if (vus.has(id)) doublons.push({ index, id });
    vus.add(id);
  });

  return { valide: doublons.length === 0, doublons, anomalie: null };
}

function resoudreReferenceHistorique(valeur, objets, champ) {
  if (typeof valeur !== "string" || valeur.trim() === "") {
    return { statut: "absente", objet: null, candidats: [] };
  }
  if (!Array.isArray(objets) || typeof champ !== "string" || champ.trim() === "") {
    return { statut: "donnees_invalides", objet: null, candidats: [] };
  }

  const candidats = objets.filter(objet => objet && objet[champ] === valeur);
  if (candidats.length === 0) return { statut: "introuvable", objet: null, candidats: [] };
  if (candidats.length > 1) return { statut: "ambiguë", objet: null, candidats };
  if (!estIdValide(candidats[0].id)) {
    return { statut: "identifiant_manquant", objet: null, candidats };
  }
  return { statut: "resolue", objet: candidats[0], candidats };
}

function validerLiensMetier({ etudes = [], factures = [], bvs = [], lignesBV = [] } = {}) {
  const anomalies = [];
  const idsEtudes = new Set(etudes.filter(e => estIdValide(e?.id)).map(e => e.id));
  const idsBVs = new Set(bvs.filter(b => estIdValide(b?.id)).map(b => b.id));

  factures.forEach((facture, index) => {
    if (!estIdValide(facture?.etudeId)) {
      anomalies.push({ collection: "factures", index, raison: "etudeId absent ou invalide" });
    } else if (!idsEtudes.has(facture.etudeId)) {
      anomalies.push({ collection: "factures", index, raison: "Étude liée introuvable" });
    }
  });

  lignesBV.forEach((ligne, index) => {
    if (!estIdValide(ligne?.bvId)) {
      anomalies.push({ collection: "lignesBV", index, raison: "bvId absent ou invalide" });
    } else if (!idsBVs.has(ligne.bvId)) {
      anomalies.push({ collection: "lignesBV", index, raison: "BV lié introuvable" });
    }
    if (!estIdValide(ligne?.membreId)) {
      anomalies.push({ collection: "lignesBV", index, raison: "membreId absent ou invalide" });
    }
  });

  return { valide: anomalies.length === 0, anomalies };
}

module.exports = {
  COLLECTIONS,
  RELATIONS,
  estIdValide,
  validerIdentite,
  verifierUniciteIdentifiants,
  resoudreReferenceHistorique,
  validerLiensMetier,
};
