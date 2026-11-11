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


/**
 * Calcule une facture construite en lignes HT.
 * Les factures antérieures sont déduites en TTC : cela préserve exactement
 * les montants historiques déjà saisis en TTC, sans leur inventer un taux de TVA.
 */
function calculerFactureParLignes({ lignes = [], tauxTva = 0.2, facturesPrecedentes = [] } = {}) {
  const anomalies = [];
  const arrondir = n => Math.round((n + Number.EPSILON) * 100) / 100;
  if (!Array.isArray(lignes) || lignes.length === 0) anomalies.push("Ajoutez au moins une ligne de prestation ou de frais");
  const tva = Number(tauxTva);
  if (!Number.isFinite(tva) || tva < 0 || tva > 1) anomalies.push("Le taux de TVA doit être compris entre 0 et 100 %");
  if (!Array.isArray(facturesPrecedentes)) anomalies.push("La liste des factures précédentes est invalide");
  let prestationsHt = 0, fraisHt = 0;
  (Array.isArray(lignes) ? lignes : []).forEach((ligne, index) => {
    if (!ligne || typeof ligne !== "object") { anomalies.push("Ligne " + (index + 1) + " invalide"); return; }
    if (ligne.type === "prestation") {
      const quantite = Number(ligne.quantite), prix = Number(ligne.prixUnitaireHt);
      if (!Number.isFinite(quantite) || quantite <= 0) anomalies.push("Quantité invalide à la ligne " + (index + 1));
      if (!Number.isFinite(prix) || prix < 0) anomalies.push("Prix unitaire HT invalide à la ligne " + (index + 1));
      if (Number.isFinite(quantite) && quantite > 0 && Number.isFinite(prix) && prix >= 0) prestationsHt += quantite * prix;
    } else if (ligne.type === "frais") {
      const montant = Number(ligne.montantHt);
      if (!Number.isFinite(montant) || montant < 0) anomalies.push("Montant des frais invalide à la ligne " + (index + 1));
      else fraisHt += montant;
    } else anomalies.push("Type de ligne inconnu à la ligne " + (index + 1));
  });
  let deductionTtc = 0;
  (Array.isArray(facturesPrecedentes) ? facturesPrecedentes : []).forEach((facture, index) => {
    const montant = Number(facture?.montant);
    if (!Number.isFinite(montant) || montant < 0) anomalies.push("Montant TTC invalide dans la facture précédente " + (index + 1));
    else deductionTtc += montant;
  });
  const montantHt = arrondir(prestationsHt + fraisHt);
  const montantTva = arrondir(montantHt * (Number.isFinite(tva) ? tva : 0));
  const montantTtcBrut = arrondir(montantHt + montantTva);
  deductionTtc = arrondir(deductionTtc);
  const montantTtc = arrondir(montantTtcBrut - deductionTtc);
  if (montantTtc < -0.005) anomalies.push("Les factures précédentes dépassent le total TTC de la facture");
  return {
    valide: anomalies.length === 0,
    anomalies,
    prestationsHt: arrondir(prestationsHt),
    fraisHt: arrondir(fraisHt),
    montantHt,
    tauxTva: Number.isFinite(tva) ? tva : null,
    montantTva,
    montantTtcBrut,
    deductionTtc,
    montantTtc: Math.max(0, montantTtc),
    montant: Math.max(0, montantTtc),
  };
}

module.exports = { analyserFacture, calculerSituationEtude, calculerFactureParLignes, ETATS_FACTURE };
