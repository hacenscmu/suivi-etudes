/**
 * HAC refonte — calculs financiers indépendants de l'interface.
 *
 * Ne déduit jamais qu'une facture est payée à partir de l'absence d'état.
 * La compatibilité historique doit être explicite (legacy=true) et traitée
 * lors d'une migration contrôlée, pas dans les calculs métier courants.
 */

const ETATS_FACTURE = new Set(["Émise", "Payée"]);

function analyserFacture(facture, { legacy = false } = {}) {
  if (!facture || typeof facture !== "object") {
    return { etat: "invalide", payee: false, anomalie: "Facture invalide" };
  }

  let etat = facture.etat;
  if ((etat === undefined || etat === null || etat === "") && legacy) {
    // Les anciennes lignes sans état représentaient des encaissements.
    etat = "Payée";
  }

  if (!ETATS_FACTURE.has(etat)) {
    return {
      etat: "inconnu",
      payee: false,
      anomalie: "État de facture absent ou inconnu",
    };
  }

  return { etat, payee: etat === "Payée", anomalie: null };
}

function calculerSituationEtude(factures = [], options = {}) {
  if (!Array.isArray(factures)) {
    return {
      situation: "anomalie",
      nombreFactures: 0,
      nombrePayees: 0,
      montantTotal: 0,
      montantEncaisse: 0,
      resteAEncaisser: null,
      anomalies: ["La liste des factures est invalide"],
    };
  }

  if (factures.length === 0) {
    return {
      situation: "sans_facture",
      nombreFactures: 0,
      nombrePayees: 0,
      montantTotal: 0,
      montantEncaisse: 0,
      resteAEncaisser: 0,
      anomalies: [],
    };
  }

  let montantTotal = 0;
  let montantEncaisse = 0;
  let nombrePayees = 0;
  const anomalies = [];

  factures.forEach((facture, index) => {
    const analyse = analyserFacture(facture, options);
    if (analyse.anomalie) anomalies.push({ index, raison: analyse.anomalie });

    const montant = Number(facture?.montant);
    if (facture?.montant === "" || facture?.montant == null || !Number.isFinite(montant) || montant < 0) {
      anomalies.push({ index, raison: "Montant absent ou invalide" });
    } else {
      montantTotal += montant;
      if (analyse.payee) montantEncaisse += montant;
    }

    if (analyse.payee) nombrePayees += 1;
  });

  const etatsConnus = anomalies.length === 0;
  let situation;
  if (!etatsConnus) situation = "anomalie";
  else if (nombrePayees === factures.length) situation = "integralement_encaissee";
  else if (nombrePayees === 0) situation = "aucun_encaissement";
  else situation = "partiellement_encaissee";

  return {
    situation,
    nombreFactures: factures.length,
    nombrePayees,
    montantTotal,
    montantEncaisse,
    resteAEncaisser: anomalies.some(a => a.raison === "Montant absent ou invalide")
      ? null
      : montantTotal - montantEncaisse,
    anomalies,
  };
}

module.exports = { analyserFacture, calculerSituationEtude, ETATS_FACTURE };
