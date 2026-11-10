/**
 * HAC — migration v11 → v3 en MODE APERÇU.
 *
 * Entrée : l'export JSON de l'app v11 (menu « Exporter ») : { etudes, factures, temps, formation, config }.
 * Sortie : les collections v3 proposées + un rapport lisible. AUCUNE écriture : ni Sheet, ni serveur, ni fichier source.
 *
 * Règles confirmées et points non résolus :
 *  - clients : un client par nom normalisé, fusion à confirmer ;
 *  - membres : v11 ne connaît que le prénom ; homonymes à séparer manuellement ;
 *  - interventions : minutesIndividuelles = min ÷ nb (confirmé : 120 min collectives à 2 = 60 min chacune) ;
 *  - temps.jeh : prix HT de la JEH intervenant, confirmé par le calcul v11 (t.J = t.I × t.jeh) ; valeur brute conservée dans jehV11 ;
 *  - un mapping explicite peut qualifier temps.jeh comme prix intervenant HT ou nombre de JEH ;
 *  - études : « jeh » = prix HT de la JEH client ; « frais » (v12) conservé ;
 *  - factures : liées à l'étude par numéro → identifiant ; un état absent est signalé (v11 le supposait « Payée ») ;
 *  - BV : aucun BV inventé ; les anciennes lignes « Payé » sont signalées « historique non ventilé ».
 * Un fichier de correspondances facultatif permet de corriger les propositions (fusion de clients, séparation d'homonymes).
 */
const crypto = require("node:crypto");
const { auditerDonneesHistoriques } = require("../domain/audit-migration");

const ID_VALIDE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const STATUTS_TEMPS = new Set(["Pas payé", "Payé", "A venir", "Non effectué"]);

const simple = v => !!v && typeof v === "object" && !Array.isArray(v);
const cle = s => String(s ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
// Identifiant déterministe : relancer l'aperçu sur le même export donne les mêmes identifiants.
const idStable = (prefixe, graine) => prefixe + "_" + crypto.createHash("sha256").update(String(graine)).digest("hex").slice(0, 16);
const garderId = (prefixe, sourceId) => (ID_VALIDE.test(sourceId) ? sourceId : idStable(prefixe, sourceId));
const num = v => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

function lireExport(brut) {
  const d = simple(brut) && simple(brut.data) ? brut.data : brut;
  if (!simple(d) || !("etudes" in d || "temps" in d)) throw new Error("Ce fichier n'est pas un export de l'app HAC v11.");
  const col = n => (simple(d[n]) ? d[n] : {});
  return { etudes: col("etudes"), factures: col("factures"), temps: col("temps"), formation: col("formation"), config: simple(d.config) ? d.config : null };
}

function migrerV11(exportV11, { correspondances = {} } = {}) {
  const src = lireExport(exportV11);
  const mapping = (nom) => {
    const valeur = correspondances[nom] ?? {};
    if (!simple(valeur)) throw new Error("Correspondance invalide : " + nom + " doit être un objet.");
    return valeur;
  };
  const C = {
    clients: mapping("clients"),
    membres: mapping("membres"),
    tempsVersMembre: mapping("tempsVersMembre"),
    formationVersMembre: mapping("formationVersMembre"),
    nomsMembres: mapping("nomsMembres"),
    jehTemps: correspondances.jehTemps ?? "prix_intervenant_ht",
  };
  if (!["non_qualifie", "prix_intervenant_ht", "nombre_jeh"].includes(C.jehTemps)) {
    throw new Error("jehTemps doit valoir non_qualifie, prix_intervenant_ht ou nombre_jeh.");
  }
  for (const nom of ["clients", "membres", "tempsVersMembre", "formationVersMembre"]) {
    for (const [cleSource, id] of Object.entries(C[nom])) {
      if (!cleSource || typeof id !== "string" || !ID_VALIDE.test(id)) {
        throw new Error("Identifiant de correspondance invalide dans " + nom + " : " + cleSource);
      }
    }
  }
  for (const [id, nomComplet] of Object.entries(C.nomsMembres)) {
    if (!ID_VALIDE.test(id) || typeof nomComplet !== "string" || !nomComplet.trim()) {
      throw new Error("Correspondance nomsMembres invalide pour " + id);
    }
  }
  const questions = [], anomalies = [];
  const E = Object.entries(src.etudes), F = Object.entries(src.factures), T = Object.entries(src.temps);

  const audit = auditerDonneesHistoriques({ etudes: E.map(x => x[1]), factures: F.map(x => x[1]), temps: T.map(x => x[1]) });
  audit.anomalies.forEach(a => anomalies.push({ source: "audit", ...a }));

  // ---- Clients : regroupement par nom normalisé (ou correspondance fournie) ----
  const clients = new Map();
  const clientDe = nom => {
    const k = C.clients[nom] ? "corr:" + C.clients[nom] : cle(nom);
    if (!k) return null;
    if (!clients.has(k)) clients.set(k, { id: C.clients[nom] || idStable("cli", k), raisonSociale: String(nom).trim(), relationType: "ponctuelle", variantes: new Set() });
    clients.get(k).variantes.add(String(nom));
    return clients.get(k).id;
  };

  // ---- Études ----
  const idEtudeParNum = new Map(), numsVus = new Map();
  E.forEach(([sid, e]) => { if (e?.num) numsVus.set(e.num, (numsVus.get(e.num) || 0) + 1); });
  const etudes = E.map(([sid, e]) => {
    const id = garderId("etu", sid);
    if (e?.num && numsVus.get(e.num) === 1) idEtudeParNum.set(e.num, id);
    const o = { id, sourceLegacyId: sid, num: e?.num ?? "", date: e?.date ?? "", statut: e?.statut ?? "", client: e?.client ?? "",
      clientId: e?.client ? clientDe(e.client) : null, resume: e?.resume ?? "", montant: num(e?.montant), jeh: num(e?.jeh), frais: num(e?.frais) };
    if (!cle(e?.client) && !o.clientId) anomalies.push({ type: "etude_sans_client", sourceLegacyId: sid, num: o.num, gravite: "bloquante" });
    if (o.jeh !== null && (o.jeh < 80 || o.jeh > 450)) anomalies.push({ type: "prix_jeh_client_hors_cnje", sourceLegacyId: sid, num: o.num, valeur: o.jeh, gravite: "a_verifier" });
    return o;
  });

  // ---- Factures ----
  const factures = F.map(([sid, f]) => {
    const etudeId = idEtudeParNum.get(f?.etude) ?? null;
    const o = { id: garderId("fac", sid), sourceLegacyId: sid, etudeId, type: f?.type || null, etat: f?.etat || null,
      montant: num(f?.montant), date: f?.date ?? "", echeance: f?.echeance ?? "", datePaiement: f?.datePaiement ?? "", note: f?.note ?? "" };
    if (!f?.etat) { o.etat = "Payée"; o.etatSuppose = true; anomalies.push({ type: "facture_etat_suppose_payee", sourceLegacyId: sid, etude: f?.etude ?? null, gravite: "a_verifier" }); }
    if (!f?.type) { o.type = /solde/i.test(f?.note || "") ? "Solde" : /interm/i.test(f?.note || "") ? "Intermédiaire" : "Acompte"; o.typeSuppose = true; anomalies.push({ type: "facture_type_suppose", sourceLegacyId: sid, typeRetenu: o.type, gravite: "a_verifier" }); }
    return o;
  });

  // ---- Membres et interventions ----
  const membres = new Map();
  const assurerMembre = (id, prenom) => {
    const k = "corr:" + id;
    if (!membres.has(k)) membres.set(k, {
      id,
      nomComplet: C.nomsMembres[id] || String(prenom).trim(),
      prenomSource: cle(prenom),
      lignes: 0,
      aConfirmer: !C.nomsMembres[id],
    });
    return membres.get(k);
  };
  const membreDe = (prenom, sid) => {
    const id = C.tempsVersMembre[sid] || C.membres[prenom] || idStable("mbr", cle(prenom));
    const membre = assurerMembre(id, prenom);
    membre.lignes++;
    return membre.id;
  };
  const interventions = [];
  T.forEach(([sid, t]) => {
    const etudeId = idEtudeParNum.get(t?.etude) ?? null, membreId = t?.prenom ? membreDe(t.prenom, sid) : null;
    const min = num(t?.min), nb = num(t?.nb);
    const statut = STATUTS_TEMPS.has(t?.statut) ? t.statut : null;
    const o = { id: garderId("int", sid), sourceLegacyId: sid, etudeId, membreId, date: t?.date ?? "", statut,
      minutesIndividuelles: min !== null && nb !== null && nb >= 1 ? Math.round((min / nb) * 1000) / 1000 : null,
      jehV11: num(t?.jeh),
      prixJehHt: C.jehTemps === "prix_intervenant_ht" ? num(t?.jeh) : null,
      jehDeclaree: C.jehTemps === "nombre_jeh" ? num(t?.jeh) : null,
      note: t?.note ?? "" };
    if (!t?.statut) anomalies.push({ type: "intervention_sans_statut", sourceLegacyId: sid, prenom: t?.prenom ?? null, gravite: "a_verifier", detail: "v11 la comptait « Pas payé » ; à classer" });
    else if (!statut) anomalies.push({ type: "intervention_statut_inconnu", sourceLegacyId: sid, valeur: t.statut, gravite: "a_verifier" });
    if (o.minutesIndividuelles === null) anomalies.push({ type: "intervention_minutes_ou_nb_manquants", sourceLegacyId: sid, min: t?.min ?? null, nb: t?.nb ?? null, gravite: "a_verifier" });
    if (C.jehTemps === "non_qualifie" && o.jehV11 !== null) {
      anomalies.push({ type: "jeh_historique_non_qualifie", sourceLegacyId: sid, valeur: o.jehV11, gravite: "a_verifier" });
    }
    if (C.jehTemps === "prix_intervenant_ht" && o.prixJehHt !== null && o.prixJehHt > 300) {
      anomalies.push({ type: "prix_jeh_intervenant_sup_300", sourceLegacyId: sid, valeur: o.prixJehHt, gravite: "a_verifier" });
    }
    if (C.jehTemps === "nombre_jeh" && o.jehDeclaree !== null && o.minutesIndividuelles !== null) {
      const calculee = o.minutesIndividuelles / 480;
      if (Math.abs(o.jehDeclaree - calculee) > 0.001) anomalies.push({
        type: "jeh_historique_ecart_minutes", sourceLegacyId: sid, valeurV11: o.jehDeclaree,
        valeurCalculee: arrondi(calculee), gravite: "a_verifier"
      });
    }
    if (statut === "Payé") o.bvHistorique = "non_ventile";
    interventions.push(o);
  });

  // ---- Formation : rattachée au membre par prénom ----
  const formation = Object.entries(src.formation).map(([sid, f]) => {
    let membreId = null;
    if (f?.nom) {
      const mapped = C.formationVersMembre[sid] || C.membres[f.nom];
      if (mapped) membreId = assurerMembre(mapped, f.nom).id;
      else {
        const candidats = [...membres.values()].filter(m => m.prenomSource === cle(f.nom));
        if (candidats.length === 1) membreId = candidats[0].id;
        else if (candidats.length > 1) anomalies.push({ type: "formation_membre_ambigu", sourceLegacyId: sid, nom: f.nom, gravite: "a_verifier" });
        else membreId = assurerMembre(idStable("mbr", cle(f.nom)), f.nom).id;
      }
    }
    if (!membreId) anomalies.push({ type: "formation_sans_membre", sourceLegacyId: sid, nom: f?.nom ?? null, gravite: "a_verifier" });
    const niveaux = {};
    Object.entries(simple(f?.niveaux) ? f.niveaux : {}).forEach(([numEtude, n]) => { const eid = idEtudeParNum.get(numEtude); if (eid) niveaux[eid] = n; else anomalies.push({ type: "formation_etude_introuvable", sourceLegacyId: sid, etude: numEtude, gravite: "a_verifier" }); });
    return { id: garderId("frm", sid), sourceLegacyId: sid, membreId, nom: f?.nom ?? "", niveaux };
  });

  // ---- Questions pour Pauline ----
  [...clients.values()].filter(c => c.variantes.size > 1 && ![...c.variantes].every(v => C.clients[v] === c.id)).forEach(c => questions.push({ type: "clients_fusionnes", question: "Ces écritures désignent-elles bien le même client ?", valeurs: [...c.variantes] }));
  const proches = new Map();
  [...clients.values()].forEach(c => { const k = cle(c.raisonSociale).replace(/[^a-z0-9]/g, ""); proches.set(k, [...(proches.get(k) || []), c.raisonSociale]); });
  [...proches.values()].filter(v => v.length > 1).forEach(v => questions.push({ type: "clients_proches", question: "Ces clients sont-ils le même ?", valeurs: v }));
  [...membres.values()].filter(m => m.aConfirmer).forEach(m => questions.push({ type: "membre_a_confirmer", question: "Nom complet de ce membre (et y a-t-il plusieurs personnes avec ce prénom ?)", prenom: m.nomComplet, lignes: m.lignes, membreId: m.id }));
  if (C.jehTemps === "non_qualifie" && T.some(([, t]) => num(t?.jeh) !== null)) {
    questions.push({ type: "jeh_historique", question: "Dans les anciennes lignes Temps, le champ jeh représente-t-il le prix HT de la JEH intervenant ou un nombre de JEH ? Il est conservé sans conversion tant que ce point n'est pas tranché." });
  }
  if (interventions.some(i => i.bvHistorique)) questions.push({ type: "bv_historiques", question: "Les anciens BV payés ne sont pas reconstitués (aucune date de BV dans v11). Faut-il les ressaisir depuis les justificatifs du Drive, ou les garder comme historique non ventilé ?" });

  // ---- Comparaison des totaux avant / après ----
  const tva = num(src.config?.tva) ?? 0.2;
  const jehAvant = T.reduce((s, [, t]) => { const st = t?.statut || "Pas payé"; const m = num(t?.min), n = num(t?.nb); return st === "Payé" || st === "Pas payé" ? s + (m !== null && n ? m / 480 / n : 0) : s; }, 0);
  const jehApres = interventions.reduce((s, i) => (i.statut === "Payé" || i.statut === "Pas payé") && i.minutesIndividuelles !== null ? s + i.minutesIndividuelles / 480 : s, 0);
  const somme = (arr, f) => arr.reduce((s, x) => s + (f(x) ?? 0), 0);
  const totaux = {
    jehTravailleesAvant: arrondi(jehAvant), jehTravailleesApres: arrondi(jehApres),
    ecartJeh: arrondi(jehAvant - jehApres), ecartJehExplication: "lignes sans statut : comptées par v11, exclues en v3 tant qu'elles ne sont pas classées",
    montantEtudesTtc: arrondi(somme(etudes, e => e.montant)), montantFacturesTtc: arrondi(somme(factures, f => f.montant)),
    encaisseTtcAvant: arrondi(somme(F.map(x => x[1]), f => (!f?.etat || f.etat === "Payée" ? num(f?.montant) : 0))),
    encaisseTtcApres: arrondi(somme(factures, f => (f.etat === "Payée" ? f.montant : 0))),
    facturesSansEtude: factures.filter(f => !f.etudeId).length, interventionsSansEtude: interventions.filter(i => !i.etudeId).length, tva,
  };

  const collections = {
    clients: [...clients.values()].map(({ variantes, ...c }) => c),
    membres: [...membres.values()].map(({ lignes, aConfirmer, prenomSource, ...m }) => m),
    etudes, factures, interventions, formation, bvs: [], lignesBV: [],
    config: src.config ? { id: "main", ...src.config } : null,
  };
  const bloquantes = anomalies.filter(a => a.gravite === "bloquante").length;
  const aVerifier = anomalies.filter(a => a.gravite === "a_verifier").length;
  return {
    statut: bloquantes ? "bloquee" : (aVerifier || questions.length) ? "apercu_a_verifier" : "apercu_pret",
    resume: { clients: collections.clients.length, membres: collections.membres.length, etudes: etudes.length, factures: factures.length, interventions: interventions.length, formation: formation.length, anomaliesBloquantes: bloquantes, aVerifier: anomalies.length - bloquantes, questions: questions.length },
    totaux, questions, anomalies, collections,
    avertissement: "Aperçu uniquement : rien n'a été écrit. La bascule nécessite la validation de Pauline et un essai sur une copie.",
  };
}
function arrondi(x) { return Math.round(x * 1000) / 1000; }

function rapportTexte(r) {
  const L = [];
  L.push("# Aperçu de migration HAC v11 → v3", "", r.avertissement, "", "## Résumé", "");
  Object.entries(r.resume).forEach(([k, v]) => L.push("- " + k + " : " + v));
  L.push("", "## Totaux avant / après", "");
  Object.entries(r.totaux).forEach(([k, v]) => L.push("- " + k + " : " + v));
  L.push("", "## Questions pour Pauline (" + r.questions.length + ")", "");
  r.questions.forEach((q, i) => L.push((i + 1) + ". " + q.question + (q.valeurs ? " → " + q.valeurs.join(" / ") : "") + (q.prenom ? " → « " + q.prenom + " » (" + q.lignes + " lignes)" : "")));
  const parType = {}; r.anomalies.forEach(a => { parType[a.type] = (parType[a.type] || 0) + 1; });
  L.push("", "## Points à vérifier", "");
  Object.entries(parType).forEach(([k, v]) => L.push("- " + k + " : " + v));
  return L.join("\n") + "\n";
}

module.exports = { migrerV11, rapportTexte, lireExport };

// Ligne de commande : node refonte/migration/migrer-v11.js export.json [correspondances.json] [dossier-sortie]
if (require.main === module) {
  const fs = require("node:fs"), path = require("node:path");
  const [fichier, corr, sortie] = process.argv.slice(2);
  if (!fichier) { console.error("Usage : node migrer-v11.js export.json [correspondances.json] [dossier-sortie]"); process.exit(2); }
  const r = migrerV11(JSON.parse(fs.readFileSync(fichier, "utf8")), { correspondances: corr ? JSON.parse(fs.readFileSync(corr, "utf8")) : {} });
  const dir = sortie || ".";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "apercu-v3.json"), JSON.stringify(r, null, 2));
  fs.writeFileSync(path.join(dir, "rapport-migration.md"), rapportTexte(r));
  console.log(rapportTexte(r));
}
