/**
 * HAC — alertes par étude : portage des 22 alertes de l'app v12 (app.js, ALERTS / alertsOf / finStatus)
 * sur le modèle v3 (identifiants stables, interventions individuelles).
 * Règles reprises à l'identique, avec les corrections v12 : statut financier sur TOUTES les factures,
 * frais hors JEH, et minimum 1 JEH = assiette (jamais une alerte).
 */
const DEFAUTS = { tva: 0.2, relance1: 3, relance2: 10, cnje: { date: "", min: 80, max: 450, maxInt: 300 } };
const SIGNEES = ["Convention signée", "Convention étudiant avant réalisation", "En réalisation", "Archivée"]; // L_STAT v11
const EN_COURS = ["Faisabilité", "Devis envoyé", "Devis signé", "Convention envoyée", "Convention signée", "Convention étudiant avant réalisation", "En réalisation"];
const FACTUREES = ["Acompte facturé", "Facture intermédiaire", "Solde facturé"];

const ALERTES = [
  ["retard", "Retard de paiement (+ relances)", "Facture émise et échéance dépassée."],
  ["arch_reste", "Archivée mais reste à encaisser", "Le client doit encore payer."],
  ["arch_solde", "Archivée sans solde encaissé", "Le solde n’est pas marqué encaissé."],
  ["arch_bv", "Archivée mais BV non payés", "Un intervenant est encore « À payer »."],
  ["enc_sup", "Encaissé supérieur au montant", "Erreur de saisie ou trop-perçu."],
  ["acompte", "Facturer l’acompte", "Convention signée ou en réalisation sans facture."],
  ["echeance", "Renseigner l’échéance", "Facture émise sans date d’échéance."],
  ["temps", "Renseigner le temps de travail", "En réalisation sans intervention."],
  ["jeh_manq", "Prix de la JEH manquant", "Interventions mais prix JEH client vide."],
  ["rem_sup", "Rémunérations > montant HT", "Les rémunérations dépassent le montant."],
  ["payer_bv", "Payer les BV", "Solde encaissé, intervenants « À payer »."],
  ["archiver", "Tout est soldé : archiver", "Rien à encaisser, BV payés."],
  ["refusee", "Étude refusée mais facturée", "Refusée avec facture."],
  ["solde_reste", "Solde encaissé mais reste à encaisser", "Montant ou encaissé à corriger."],
  ["solde_af", "Facturer le solde", "Étude archivée, solde pas encore facturé."],
  ["date", "Renseigner la date de création", "Étude sans date."],
  ["double", "N° d’étude en double", "Deux études avec le même numéro."],
  ["cnje_cli", "CNJE : JEH client hors fourchette", "Prix JEH client hors min–max."],
  ["cnje_int", "CNJE : JEH intervenant trop élevée", "Au-dessus du plafond intervenant."],
  ["cnje_fact", "CNJE : JEH facturées non entières", "(Montant HT − frais) ÷ prix JEH non entier."],
  ["cnje_rem", "CNJE : JEH rémunérées non entières", "Par intervenant sur une étude."],
  ["cnje_diff", "CNJE : facturées ≠ rémunérées", "Les deux totaux diffèrent."],
];

const num = v => (v === "" || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));
const estNum = v => v !== "" && v != null && Number.isFinite(Number(v));
const jour = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); if (!m) return null; const t = Date.UTC(+m[1], +m[2] - 1, +m[3]), d = new Date(t); return d.getUTCDate() === +m[3] && d.getUTCMonth() === +m[2] - 1 ? t / 864e5 : null; };
const entier = x => Math.abs(x - Math.round(x)) <= 0.005;

/** Statut financier calculé (finStatus v12). */
function statutFinancier(etude, factures) {
  const inv = [...factures].sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))), st = etude.statut;
  const paye = f => f.etat === "Payée";
  if (st === "Refusé / sans suite") return inv.length ? (inv.some(f => !paye(f)) ? "Facture émise" : "Encaissé") : "";
  if (inv.some(f => f.type === "Solde")) return inv.every(paye) ? "Solde encaissé" : "Solde facturé";
  const impayee = inv.find(f => !paye(f));
  if (impayee) return impayee.type === "Intermédiaire" ? "Facture intermédiaire" : "Acompte facturé";
  const last = inv[inv.length - 1];
  if (!last) return st === "Archivée" ? (num(etude.montant) > 0 ? "Solde à facturer" : "") : SIGNEES.includes(st) ? "Acompte à facturer" : "";
  if (st === "Archivée") return "Solde à facturer";
  return last.type === "Intermédiaire" ? "Intermédiaire encaissé" : "Acompte encaissé";
}

/**
 * Calcule, pour chaque étude, ses indicateurs et alertes.
 * @returns {Map<string, {facture, encaisse, reste, echeance, bv, alertes:[{cle, texte}]}>}
 */
function calculerAlertes({ etudes = [], factures = [], interventions = [], config = {}, aujourdhui }) {
  const c = { ...DEFAUTS, ...config, cnje: { ...DEFAUTS.cnje, ...(config.cnje || {}) } };
  const tva = num(c.tva), AUJ = jour(aujourdhui), cnjeDate = jour(c.cnje.date);
  const off = c.alertesOff || {}, actif = cle => c.alertesOn !== false && !off[cle];
  const nums = {}; etudes.forEach(e => { if (e.num) nums[e.num] = (nums[e.num] || 0) + 1; });
  const res = new Map();
  for (const e of etudes) {
    const inv = factures.filter(f => f.etudeId === e.id), ls = interventions.filter(i => i.etudeId === e.id);
    const st = e.statut, fa = statutFinancier(e, inv), montant = num(e.montant);
    const encaisse = inv.filter(f => f.etat === "Payée").reduce((s, f) => s + num(f.montant), 0);
    const reste = SIGNEES.includes(st) ? montant - encaisse : null;
    const ech = inv.filter(f => f.etat !== "Payée" && jour(f.echeance) !== null).map(f => jour(f.echeance));
    const echeance = ech.length ? Math.min(...ech) : null;
    const realisees = ls.filter(i => i.statut === "Payé" || i.statut === "Pas payé");
    const bv = !ls.length ? "" : ls.some(i => i.statut === "Pas payé") ? "À payer" : ls.some(i => i.statut === "A venir") ? "À venir" : ls.some(i => i.statut === "Payé") ? "Payé" : "Non effectué";
    const jehInter = i => num(i.minutesIndividuelles) / 480;
    const jehFact = estNum(e.jeh) && num(e.jeh) && montant ? Math.max(0, montant / (1 + tva) - num(e.frais)) / num(e.jeh) : null;
    const jehRem = ls.length ? realisees.reduce((s, i) => s + jehInter(i), 0) : null;
    const remun = realisees.reduce((s, i) => s + jehInter(i) * num(i.prixJehHt), 0);
    const A = [], add = (cle, texte) => { if (actif(cle)) A.push({ cle, texte }); };

    if (FACTUREES.includes(fa) && echeance !== null && AUJ !== null && echeance < AUJ) {
      const r = AUJ - echeance;
      add("retard", "Retard de " + r + " j" + (r > c.relance2 ? " : 2e relance" : r >= c.relance1 ? " : 1re relance par mail" : ""));
    }
    if (st === "Archivée" && reste > 0) add("arch_reste", "Archivée mais reste à encaisser");
    if (st === "Archivée" && fa !== "Solde encaissé") add("arch_solde", "Archivée sans solde encaissé");
    if (st === "Archivée" && bv === "À payer") add("arch_bv", "Archivée mais BV non payés");
    if (montant > 0 && encaisse > montant) add("enc_sup", "Encaissé supérieur au montant");
    if (fa === "Acompte à facturer") add("acompte", "Facturer l’acompte");
    if (fa === "Solde à facturer") add("solde_af", "Facturer le solde");
    if (FACTUREES.includes(fa) && echeance === null && st !== "Archivée" && st !== "Refusé / sans suite") add("echeance", "Renseigner l’échéance de paiement");
    if (st === "En réalisation" && !ls.length) add("temps", "Renseigner le temps de travail");
    if (ls.length && !estNum(e.jeh)) add("jeh_manq", "Prix de la JEH client manquant");
    if (montant > 0 && remun > montant / (1 + tva) + 1e-9) add("rem_sup", "Rémunérations supérieures au montant HT");
    if (fa === "Solde encaissé" && st !== "Archivée" && bv === "À payer") add("payer_bv", "Payer les BV");
    if (fa === "Solde encaissé" && st !== "Archivée" && st !== "Refusé / sans suite" && montant > 0 && bv !== "À payer" && reste <= 0) add("archiver", "Tout est soldé : archiver l’étude");
    if (st === "Refusé / sans suite" && inv.length) add("refusee", "Étude refusée mais facturée");
    if (fa === "Solde encaissé" && reste > 0) add("solde_reste", "Solde encaissé mais reste à encaisser");
    if (jour(e.date) === null) add("date", "Renseigner la date de création");
    if (e.num && nums[e.num] > 1) add("double", "N° d’étude en double");
    const cnje = cnjeDate !== null && ((jour(e.date) !== null && jour(e.date) >= cnjeDate) || (st !== "Archivée" && st !== "Refusé / sans suite"));
    if (cnje) {
      if (estNum(e.jeh) && (num(e.jeh) < c.cnje.min || num(e.jeh) > c.cnje.max)) add("cnje_cli", "CNJE : JEH client (" + num(e.jeh) + " €) hors de " + c.cnje.min + "–" + c.cnje.max + " €");
      const maxInt = ls.length ? Math.max(...ls.map(i => num(i.prixJehHt))) : null;
      if (maxInt !== null && maxInt > c.cnje.maxInt) add("cnje_int", "CNJE : JEH intervenant (" + maxInt + " €) supérieure à " + c.cnje.maxInt + " €");
      if (jehFact > 0 && !entier(jehFact)) add("cnje_fact", "CNJE : nb de JEH facturées non entier (" + Math.round(jehFact * 1000) / 1000 + ")");
      const parMembre = {}; realisees.forEach(i => { parMembre[i.membreId] = (parMembre[i.membreId] || 0) + jehInter(i); });
      if (Object.values(parMembre).some(x => !entier(x))) add("cnje_rem", "CNJE : JEH rémunérées non entières");
      if (["Convention étudiant avant réalisation", "En réalisation", "Archivée"].includes(st) && (jehFact > 0 || jehRem !== null) && Math.abs(num(jehFact) - num(jehRem)) > 0.005)
        add("cnje_diff", "CNJE : JEH facturées (" + Math.round(num(jehFact) * 1000) / 1000 + ") ≠ JEH rémunérées (" + Math.round(num(jehRem) * 1000) / 1000 + ")");
    }
    res.set(e.id, { facture: fa, encaisse, reste, echeance: echeance === null ? "" : new Date(echeance * 864e5).toISOString().slice(0, 10), bv, jehFacturees: jehFact, jehRemunerees: jehRem, alertes: A });
  }
  return res;
}

module.exports = { ALERTES, EN_COURS, statutFinancier, calculerAlertes };
