/**
 * HAC refonte — agrégats du tableau de bord.
 *
 * Ce module ne lit aucune source externe et ne modifie aucune donnée.
 * Les JEH sont calculées uniquement via les statuts métier autorisés.
 * Le CA signé vient des études ; facturation et encaissement viennent
 * exclusivement des factures liées par etudeId.
 */

const { analyserIntervention, agregerInterventions } = require("./interventions");
const { analyserFacture } = require("./factures");
const { STATUTS_ETUDE, STATUTS_CA_SIGNE } = require("./etudes");

function dateValide(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function montantValide(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function calculerTableauDeBord({
  etudes = [],
  factures = [],
  interventions = [],
  dateFin = new Date().toISOString().slice(0, 10),
  nombreMois = 6,
  tva = 0.2,
  plafondJehHt = 300,
} = {}) {
  const anomalies = [];
  if (![etudes, factures, interventions].every(Array.isArray)) {
    return { valide: false, anomalies: ["Les collections du tableau de bord doivent être des tableaux"] };
  }
  if (!dateValide(dateFin) || !Number.isInteger(nombreMois) || nombreMois < 1 || nombreMois > 24 || !Number.isFinite(tva) || tva < 0 || tva > 1) {
    return { valide: false, anomalies: ["Paramètres de période ou taux de TVA invalides"] };
  }

  let caSigne = 0;
  let caSigneComplet = true;
  const etudeIds = new Set();

  etudes.forEach((etude, index) => {
    if (!etude || typeof etude !== "object" || typeof etude.id !== "string" || !etude.id) {
      anomalies.push({ collection: "etudes", index, raison: "Étude ou identifiant invalide" });
      caSigneComplet = false;
      return;
    }
    if (etudeIds.has(etude.id)) {
      anomalies.push({ collection: "etudes", index, raison: "Identifiant d'étude dupliqué" });
      caSigneComplet = false;
      return;
    }
    etudeIds.add(etude.id);
    if (!STATUTS_ETUDE.includes(etude.statut)) {
      anomalies.push({ collection: "etudes", index, raison: "Statut d'étude absent ou inconnu" });
      caSigneComplet = false;
      return;
    }
    const montant = montantValide(etude.montant);
    if (STATUTS_CA_SIGNE.has(etude.statut)) {
      if (montant === null) {
        anomalies.push({ collection: "etudes", index, raison: "Montant signé absent ou invalide" });
        caSigneComplet = false;
      } else {
        caSigne += montant / (1 + tva);
      }
    } else if (etude.montant !== undefined && etude.montant !== null && etude.montant !== "" && montant === null) {
      anomalies.push({ collection: "etudes", index, raison: "Montant d'étude invalide" });
      caSigneComplet = false;
    }
  });

  let montantFacture = 0;
  let encaisse = 0;
  let facturesCompletes = true;

  factures.forEach((facture, index) => {
    if (!facture || typeof facture !== "object" || typeof facture.etudeId !== "string" || !etudeIds.has(facture.etudeId)) {
      anomalies.push({ collection: "factures", index, raison: "Facture sans lien d'étude valide" });
      facturesCompletes = false;
      return;
    }
    const montant = montantValide(facture.montant);
    const analyse = analyserFacture(facture);
    if (montant === null || analyse.anomalie) {
      anomalies.push({ collection: "factures", index, raison: montant === null ? "Montant absent ou invalide" : analyse.anomalie });
      facturesCompletes = false;
      return;
    }
    montantFacture += montant / (1 + tva);
    if (analyse.payee) encaisse += montant / (1 + tva);
  });

  const calculInterventions = agregerInterventions(interventions, { plafondJehHt });
  calculInterventions.anomalies.forEach(a => anomalies.push({ collection: "interventions", ...a }));

  const fin = new Date(dateFin + "T00:00:00.000Z");
  const debut = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() - (nombreMois - 1), 1));
  const mois = [];
  for (let i = 0; i < nombreMois; i++) {
    const d = new Date(Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth() + i, 1));
    const key = d.toISOString().slice(0, 7);
    mois.push({ mois: key, jeh: 0 });
  }
  const moisIndex = new Map(mois.map((m, i) => [m.mois, i]));
  interventions.forEach(ligne => {
    const analyse = analyserIntervention(ligne);
    if (!analyse.valide || !analyse.statutTravaille) return;
    const idx = moisIndex.get(ligne.date.slice(0, 7));
    if (idx !== undefined) mois[idx].jeh += analyse.jeh;
  });

  return {
    valide: anomalies.length === 0,
    nombreEtudes: etudes.length,
    caSigne: caSigneComplet ? caSigne : null,
    montantFacture: facturesCompletes ? montantFacture : null,
    encaisse: facturesCompletes ? encaisse : null,
    resteAEncaisser: facturesCompletes ? montantFacture - encaisse : null,
    totalJehTravaillees: calculInterventions.totalJehTravaillees,
    jehParMois: calculInterventions.valide ? mois : null,
    jehParMembre: calculInterventions.valide ? calculInterventions.parMembre : null,
    alertesInterventions: calculInterventions.alertes,
    anomalies,
  };
}

module.exports = { calculerTableauDeBord };
