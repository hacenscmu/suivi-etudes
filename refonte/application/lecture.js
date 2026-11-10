/**
 * HAC refonte — couche de lecture applicative.
 *
 * Assemble les domaines métier en un seul modèle de lecture pour l'interface.
 * Aucun accès réseau, aucune écriture et aucune correction silencieuse.
 */
const { estIdValide } = require("../domain/identites");
const { analyserCollectionBVs } = require("../domain/bv");
const { calculerTableauDeBord } = require("../domain/tableau-de-bord");

const COLLECTIONS = Object.freeze([
  "clients",
  "membres",
  "etudes",
  "factures",
  "interventions",
  "bvs",
  "lignesBV",
  "formation",
]);

function creerEtatVide() {
  return Object.fromEntries(COLLECTIONS.map(nom => [nom, []]));
}

function libellePersonne(personne) {
  if (!personne) return "Référence inconnue";
  return personne.raisonSociale || personne.nomComplet || personne.nom ||
    personne.name || personne.client || personne.id;
}

function indexer(collection) {
  return new Map(collection.map(item => [item.id, item]));
}

function validerEtat(etat) {
  const anomalies = [];
  if (!etat || typeof etat !== "object" || Array.isArray(etat)) {
    return { valide: false, anomalies: ["L'état applicatif doit être un objet"] };
  }

  for (const nom of COLLECTIONS) {
    if (!Array.isArray(etat[nom])) {
      anomalies.push({ collection: nom, raison: "Collection absente ou non tabulaire" });
    }
  }
  if (anomalies.length) return { valide: false, anomalies };

  const index = {};
  for (const nom of COLLECTIONS) {
    const ids = new Set();
    index[nom] = new Map();
    etat[nom].forEach((objet, position) => {
      if (!objet || typeof objet !== "object" || Array.isArray(objet) || !estIdValide(objet.id)) {
        anomalies.push({ collection: nom, index: position, raison: "Objet ou identifiant stable invalide" });
        return;
      }
      if (ids.has(objet.id)) {
        anomalies.push({ collection: nom, index: position, id: objet.id, raison: "Identifiant dupliqué" });
        return;
      }
      ids.add(objet.id);
      index[nom].set(objet.id, objet);
    });
  }

  const verifierLien = (collection, indexObjet, champ, cible) => {
    const objet = etat[collection][indexObjet];
    if (objet[champ] == null || objet[champ] === "") return;
    if (!estIdValide(objet[champ]) || !index[cible].has(objet[champ])) {
      anomalies.push({ collection, index: indexObjet, champ, raison: "Référence " + cible + " introuvable ou invalide" });
    }
  };

  etat.etudes.forEach((_, i) => verifierLien("etudes", i, "clientId", "clients"));
  etat.factures.forEach((_, i) => verifierLien("factures", i, "etudeId", "etudes"));
  etat.interventions.forEach((_, i) => {
    verifierLien("interventions", i, "etudeId", "etudes");
    verifierLien("interventions", i, "membreId", "membres");
  });
  etat.lignesBV.forEach((_, i) => {
    verifierLien("lignesBV", i, "bvId", "bvs");
    verifierLien("lignesBV", i, "membreId", "membres");
  });

  const membresAvecFormation = new Set();
  etat.formation.forEach((fiche, i) => {
    if (!estIdValide(fiche.membreId) || !index.membres.has(fiche.membreId)) {
      anomalies.push({ collection: "formation", index: i, raison: "Membre de formation introuvable ou invalide" });
    }
    if (fiche.membreId && membresAvecFormation.has(fiche.membreId)) {
      anomalies.push({ collection: "formation", index: i, raison: "Plusieurs grilles de formation pour le même membre" });
    }
    if (fiche.membreId) membresAvecFormation.add(fiche.membreId);
    if (typeof fiche.nom !== "string" || !fiche.nom.trim()) {
      anomalies.push({ collection: "formation", index: i, raison: "Nom de formation absent ou invalide" });
    }
    if (!fiche.niveaux || typeof fiche.niveaux !== "object" || Array.isArray(fiche.niveaux)) {
      anomalies.push({ collection: "formation", index: i, raison: "Grille de niveaux invalide" });
    } else {
      for (const [etudeId, niveau] of Object.entries(fiche.niveaux)) {
        if (!estIdValide(etudeId) || !index.etudes.has(etudeId)) {
          anomalies.push({ collection: "formation", index: i, raison: "Étude de formation introuvable ou invalide" });
        }
        if (!Number.isInteger(niveau) || niveau < 0 || niveau > 4) {
          anomalies.push({ collection: "formation", index: i, raison: "Niveau de formation hors de 0 à 4" });
        }
      }
    }
  });

  const analyseBVs = analyserCollectionBVs({
    bvs: etat.bvs,
    lignesBV: etat.lignesBV,
    membres: etat.membres,
  });
  analyseBVs.anomalies.forEach(anomalie => anomalies.push({
    collection: anomalie.collection || "bvs",
    index: anomalie.index,
    raison: anomalie.raison || anomalie,
  }));

  return { valide: anomalies.length === 0, anomalies };
}

function construireVueApplication(etat, options = {}) {
  const validation = validerEtat(etat);
  if (!validation.valide) {
    return {
      valide: false,
      anomalies: validation.anomalies,
      tableauDeBord: null,
      listes: null,
    };
  }

  const clients = indexer(etat.clients);
  const membres = indexer(etat.membres);
  const etudes = indexer(etat.etudes);

  const tableauDeBord = calculerTableauDeBord({
    etudes: etat.etudes,
    factures: etat.factures,
    interventions: etat.interventions,
    dateFin: options.dateFin,
    nombreMois: options.nombreMois ?? 6,
    tva: options.tva ?? 0.2,
  });

  if (!tableauDeBord.valide) {
    return {
      valide: false,
      anomalies: tableauDeBord.anomalies,
      tableauDeBord: null,
      listes: null,
    };
  }

  const etudesVue = etat.etudes.map(etude => ({
    ...etude,
    clientLibelle: etude.clientId
      ? libellePersonne(clients.get(etude.clientId))
      : etude.client || "Client non renseigné",
    factures: etat.factures.filter(f => f.etudeId === etude.id),
  })).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  const facturesVue = etat.factures.map(facture => ({
    ...facture,
    etudeLibelle: etudes.get(facture.etudeId)?.num || facture.etudeId,
  }));

  const interventionsVue = etat.interventions.map(intervention => ({
    ...intervention,
    etudeLibelle: etudes.get(intervention.etudeId)?.num || intervention.etudeId,
    membreLibelle: libellePersonne(membres.get(intervention.membreId)),
  }));

  const lignesParBV = new Map();
  etat.lignesBV.forEach(ligne => {
    if (!lignesParBV.has(ligne.bvId)) lignesParBV.set(ligne.bvId, []);
    lignesParBV.get(ligne.bvId).push({
      ...ligne,
      membreLibelle: libellePersonne(membres.get(ligne.membreId)),
    });
  });

  const bvsVue = etat.bvs.map(bv => ({
    ...bv,
    lignes: lignesParBV.get(bv.id) || [],
  }));

  return {
    valide: true,
    anomalies: [],
    tableauDeBord,
    listes: {
      clients: etat.clients.map(client => ({ ...client, libelle: libellePersonne(client) })),
      membres: etat.membres.map(membre => ({ ...membre, libelle: libellePersonne(membre) })),
      etudes: etudesVue,
      factures: facturesVue,
      interventions: interventionsVue,
      bvs: bvsVue,
    },
  };
}

module.exports = { COLLECTIONS, creerEtatVide, validerEtat, construireVueApplication };
