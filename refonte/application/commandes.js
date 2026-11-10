/**
 * HAC refonte — commandes applicatives en mémoire.
 *
 * Prépare et applique des ajouts/modifications immuables sur un état de travail.
 * Ce module ne persiste rien et ne remplace pas les contrôles de version du serveur.
 */
const { COLLECTIONS, validerEtat } = require("./lecture");

function preparerAjout({ etat, collection, donnees, creerId }) {
  if (!COLLECTIONS.includes(collection)) {
    return { valide: false, anomalies: ["Collection inconnue"] };
  }
  if (!etat || !Array.isArray(etat[collection])) {
    return { valide: false, anomalies: ["État ou collection invalide"] };
  }
  if (!donnees || typeof donnees !== "object" || Array.isArray(donnees)) {
    return { valide: false, anomalies: ["Les données à ajouter doivent être un objet"] };
  }
  if (typeof creerId !== "function") {
    return { valide: false, anomalies: ["Un générateur d'identifiant stable doit être fourni"] };
  }
  const id = creerId(collection);
  if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(id)) {
    return { valide: false, anomalies: ["Le générateur a fourni un identifiant invalide"] };
  }
  if (etat[collection].some(item => item?.id === id)) {
    return { valide: false, anomalies: ["Cet identifiant existe déjà"] };
  }
  if (Object.prototype.hasOwnProperty.call(donnees, "id") && donnees.id !== id) {
    return { valide: false, anomalies: ["L'identifiant des données ne peut pas remplacer celui généré"] };
  }
  return {
    valide: true,
    commande: {
      type: "ajouter",
      collection,
      id,
      enregistrement: { ...donnees, id },
    },
  };
}

function preparerModification({ etat, collection, id, modifications }) {
  if (!COLLECTIONS.includes(collection) || !etat || !Array.isArray(etat[collection])) {
    return { valide: false, anomalies: ["État ou collection invalide"] };
  }
  if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(id)) {
    return { valide: false, anomalies: ["Identifiant stable invalide"] };
  }
  if (!modifications || typeof modifications !== "object" || Array.isArray(modifications)) {
    return { valide: false, anomalies: ["Les modifications doivent être un objet"] };
  }
  if (Object.prototype.hasOwnProperty.call(modifications, "id")) {
    return { valide: false, anomalies: ["L'identifiant stable est immuable"] };
  }
  const index = etat[collection].findIndex(item => item?.id === id);
  if (index < 0) return { valide: false, anomalies: ["Enregistrement introuvable"] };

  return {
    valide: true,
    commande: {
      type: "modifier",
      collection,
      id,
      modifications: { ...modifications },
    },
  };
}

function appliquerCommande(etat, commande) {
  if (!etat || typeof etat !== "object" || !commande || typeof commande !== "object") {
    return { valide: false, etat, anomalies: ["État ou commande invalide"] };
  }
  if (!COLLECTIONS.includes(commande.collection) || !Array.isArray(etat[commande.collection])) {
    return { valide: false, etat, anomalies: ["Collection inconnue ou invalide"] };
  }

  const collection = commande.collection;
  const copie = { ...etat };
  if (commande.type === "ajouter") {
    if (!commande.enregistrement || commande.enregistrement.id !== commande.id ||
        etat[collection].some(item => item?.id === commande.id)) {
      return { valide: false, etat, anomalies: ["Ajout invalide ou identifiant déjà utilisé"] };
    }
    copie[collection] = [...etat[collection], { ...commande.enregistrement }];
  } else if (commande.type === "modifier") {
    const index = etat[collection].findIndex(item => item?.id === commande.id);
    if (index < 0 || !commande.modifications ||
        Object.prototype.hasOwnProperty.call(commande.modifications, "id")) {
      return { valide: false, etat, anomalies: ["Modification invalide ou enregistrement introuvable"] };
    }
    copie[collection] = etat[collection].map((item, i) =>
      i === index ? { ...item, ...commande.modifications } : item
    );
  } else {
    return { valide: false, etat, anomalies: ["Type de commande non pris en charge"] };
  }

  const validation = validerEtat(copie);
  if (!validation.valide) {
    return { valide: false, etat, anomalies: validation.anomalies };
  }
  return { valide: true, etat: copie, anomalies: [] };
}

module.exports = { preparerAjout, preparerModification, appliquerCommande };
