const test = require("node:test");
const assert = require("node:assert/strict");
const { creerEtatVide } = require("./lecture");
const {
  preparerAjout,
  preparerModification,
  appliquerCommande,
} = require("./commandes");

const etatBase = () => ({
  ...creerEtatVide(),
  clients: [{ id: "client_001", raisonSociale: "Alpha" }],
});

test("prépare un ajout avec un identifiant stable injecté", () => {
  const r = preparerAjout({
    etat: etatBase(),
    collection: "clients",
    donnees: { raisonSociale: "Beta" },
    creerId: () => "client_002",
  });
  assert.equal(r.valide, true);
  assert.equal(r.commande.enregistrement.id, "client_002");
});

test("refuse de générer un identifiant sans générateur explicite", () => {
  const r = preparerAjout({ etat: etatBase(), collection: "clients", donnees: {} });
  assert.equal(r.valide, false);
});

test("refuse un identifiant généré invalide ou déjà utilisé", () => {
  const data = etatBase();
  assert.equal(preparerAjout({
    etat: data, collection: "clients", donnees: {}, creerId: () => "x",
  }).valide, false);
  assert.equal(preparerAjout({
    etat: data, collection: "clients", donnees: {}, creerId: () => "client_001",
  }).valide, false);
});

test("prépare une modification sans autoriser le changement d'identifiant", () => {
  const r = preparerModification({
    etat: etatBase(),
    collection: "clients",
    id: "client_001",
    modifications: { raisonSociale: "Alpha modifié" },
  });
  assert.equal(r.valide, true);
  assert.equal(r.commande.id, "client_001");
});

test("refuse les modifications d'identifiant stable", () => {
  const r = preparerModification({
    etat: etatBase(),
    collection: "clients",
    id: "client_001",
    modifications: { id: "client_002" },
  });
  assert.equal(r.valide, false);
});

test("applique un ajout de façon immuable", () => {
  const initial = etatBase();
  const commande = preparerAjout({
    etat: initial,
    collection: "clients",
    donnees: { raisonSociale: "Beta" },
    creerId: () => "client_002",
  }).commande;
  const r = appliquerCommande(initial, commande);
  assert.equal(r.valide, true);
  assert.equal(r.etat.clients.length, 2);
  assert.equal(initial.clients.length, 1);
});

test("refuse une modification qui crée une référence cassée", () => {
  const initial = {
    ...etatBase(),
    etudes: [{
      id: "etude_0001",
      clientId: "client_001",
      num: "HAC-001",
      date: "2026-11-01",
      client: "Alpha",
      statut: "Convention signée",
      montant: 1200,
      jeh: 4,
    }],
  };
  const commande = preparerModification({
    etat: initial,
    collection: "etudes",
    id: "etude_0001",
    modifications: { clientId: "client_absent" },
  }).commande;
  const r = appliquerCommande(initial, commande);
  assert.equal(r.valide, false);
  assert.equal(r.etat, initial);
});

test("refuse les types de commandes non supportés sans toucher à l'état", () => {
  const initial = etatBase();
  const r = appliquerCommande(initial, { type: "supprimer", collection: "clients", id: "client_001" });
  assert.equal(r.valide, false);
  assert.equal(r.etat, initial);
});

test("refuse une modification qui invalide une règle métier", () => {
  const initial = {
    ...etatBase(),
    membres: [{ id: "membre_001", nomComplet: "Alice" }],
    etudes: [{
      id: "etude_0001",
      clientId: "client_001",
      num: "HAC-001",
      date: "2026-11-01",
      client: "Alpha",
      statut: "Convention signée",
      montant: 1200,
      jeh: 4,
    }],
    interventions: [{
      id: "interv_001",
      etudeId: "etude_0001",
      membreId: "membre_001",
      date: "2026-11-02",
      statut: "Pas payé",
      minutesIndividuelles: 480,
      prixJehHt: 250,
    }],
  };
  const commande = preparerModification({
    etat: initial,
    collection: "interventions",
    id: "interv_001",
    modifications: { statut: "Statut inconnu" },
  }).commande;
  const r = appliquerCommande(initial, commande);
  assert.equal(r.valide, false);
  assert.equal(r.etat, initial);
});
