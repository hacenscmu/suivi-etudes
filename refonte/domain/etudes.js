/**
 * HAC refonte — analyse d'une étude.
 *
 * Compatibilité historique : le champ « jeh » de l'étude contient le
 * PRIX UNITAIRE HT de la JEH client, et non un nombre de JEH.
 * Le nombre de JEH facturées est donc montant HT / prix unitaire HT.
 * Les montants d'étude historiques sont TTC.
 */
const STATUTS_ETUDE = Object.freeze([
  "Faisabilité",
  "Devis envoyé",
  "Devis signé",
  "Convention envoyée",
  "Convention signée",
  "Convention étudiant avant réalisation",
  "En réalisation",
  "Archivée",
  "Refusé / sans suite",
]);

const STATUTS_CA_SIGNE = new Set([
  "Devis signé",
  "Convention signée",
  "Convention étudiant avant réalisation",
  "En réalisation",
  "Archivée",
]);

function dateValide(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function nombreValide(value, { zero = true } = {}) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && (zero ? n >= 0 : n > 0) ? n : null;
}

function analyserEtude(etude, {
  factures = [],
  tva = 0.2,
  plafondJehHt = 300,
} = {}) {
  const anomalies = [];
  const alertes = [];
  if (!etude || typeof etude !== "object" || Array.isArray(etude)) {
    return { valide: false, anomalies: ["Étude invalide"], alertes: [] };
  }
  if (!Array.isArray(factures)) {
    return { valide: false, anomalies: ["La liste des factures est invalide"], alertes: [] };
  }
  if (!STATUTS_ETUDE.includes(etude.statut)) {
    anomalies.push("Statut d'étude absent ou inconnu");
  }
  if (typeof etude.id !== "string" || !etude.id.trim()) anomalies.push("Identifiant stable manquant");
  if (typeof etude.client !== "string" || !etude.client.trim()) anomalies.push("Client manquant");
  if (typeof etude.num !== "string" || !etude.num.trim()) anomalies.push("Numéro d'étude manquant");
  if (!dateValide(etude.date)) anomalies.push("Date de création absente ou invalide");

  const montantTtc = nombreValide(etude.montant);
  const prixJehHt = nombreValide(etude.jeh, { zero: false });
  const tauxTva = nombreValide(tva);
  if (montantTtc === null) anomalies.push("Montant TTC absent ou invalide");
  if (tauxTva === null || tauxTva > 1) anomalies.push("Taux de TVA invalide");
  if (STATUTS_CA_SIGNE.has(etude.statut) && prixJehHt === null) {
    anomalies.push("Prix unitaire HT de la JEH client absent ou invalide");
  }

  const liees = factures.filter(f => f && f.etudeId === etude.id);
  const situation = require("./factures").calculerSituationEtude(liees);
  if (situation.anomalies.length) anomalies.push(...situation.anomalies.map(a => "Facture : " + (a.raison || a)));
  if (montantTtc !== null && situation.montantTotal > montantTtc + 0.005) {
    alertes.push("Le total facturé dépasse le montant TTC de l'étude");
  }
  if (etude.statut === "Archivée" && situation.situation !== "integralement_encaissee" && situation.situation !== "sans_facture") {
    alertes.push("Étude archivée alors que toutes les factures ne sont pas encaissées");
  }
  if (etude.statut === "Refusé / sans suite" && liees.length) {
    alertes.push("Étude refusée mais déjà facturée");
  }

  const montantHt = montantTtc !== null && tauxTva !== null ? montantTtc / (1 + tauxTva) : null;
  const nombreJehFacturees = montantHt !== null && prixJehHt !== null ? montantHt / prixJehHt : null;
  if (prixJehHt !== null && plafondJehHt !== null && prixJehHt > plafondJehHt) {
    alertes.push("Prix de JEH supérieur au plafond HAC de " + plafondJehHt + " € HT");
  }

  return {
    valide: anomalies.length === 0,
    anomalies,
    alertes,
    caSigneHt: STATUTS_CA_SIGNE.has(etude.statut) ? montantHt : 0,
    montantHt,
    prixJehHt,
    nombreJehFacturees,
    situationFactures: situation,
  };
}

module.exports = { STATUTS_ETUDE, STATUTS_CA_SIGNE, analyserEtude, dateValide };
