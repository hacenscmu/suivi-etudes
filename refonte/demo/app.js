/* HAC — interface de démonstration branchée sur les modules applicatifs. */
(() => {
  "use strict";
  const { creerEtatVide, construireVueApplication, preparerAjout, preparerModification, appliquerCommande } = window.HAC;
  const data = {
    ...creerEtatVide(),
    clients: [
      { id: "client_0001", raisonSociale: "Soléa Industrie", relationType: "ponctuelle" },
      { id: "client_0002", raisonSociale: "Novalys", relationType: "longue_duree" },
      { id: "client_0003", raisonSociale: "Alsachim", relationType: "ponctuelle" },
    ],
    membres: [
      { id: "membre_0001", nomComplet: "Camille Martin", role: "Cheffe de projet" },
      { id: "membre_0002", nomComplet: "Lucas Bernard", role: "Consultant" },
      { id: "membre_0003", nomComplet: "Sarah Petit", role: "Consultante" },
    ],
    etudes: [
      { id: "etude_0001", clientId: "client_0001", client: "Soléa Industrie", num: "HAC-2026-018", date: "2026-09-04", statut: "En réalisation", montant: 5040, jeh: 14 },
      { id: "etude_0002", clientId: "client_0002", client: "Novalys", num: "HAC-2026-016", date: "2026-08-12", statut: "Convention signée", montant: 3360, jeh: 10 },
      { id: "etude_0003", clientId: "client_0003", client: "Alsachim", num: "HAC-2026-014", date: "2026-06-20", statut: "Archivée", montant: 4320, jeh: 12 },
      { id: "etude_0004", clientId: "client_0002", client: "Novalys", num: "HAC-2026-021", date: "2026-11-03", statut: "Devis envoyé", montant: 1800, jeh: 6 },
    ],
    factures: [
      { id: "facture_0001", etudeId: "etude_0001", montant: 2520, etat: "Payée", type: "Acompte" },
      { id: "facture_0002", etudeId: "etude_0001", montant: 2520, etat: "Émise", type: "Solde" },
      { id: "facture_0003", etudeId: "etude_0002", montant: 3360, etat: "Payée", type: "Solde" },
      { id: "facture_0004", etudeId: "etude_0003", montant: 4320, etat: "Payée", type: "Solde" },
    ],
    interventions: [
      { id: "interv_0001", etudeId: "etude_0001", membreId: "membre_0001", date: "2026-10-02", statut: "Payé", minutesIndividuelles: 960, prixJehHt: 300 },
      { id: "interv_0002", etudeId: "etude_0001", membreId: "membre_0002", date: "2026-10-14", statut: "Pas payé", minutesIndividuelles: 720, prixJehHt: 300 },
      { id: "interv_0003", etudeId: "etude_0002", membreId: "membre_0003", date: "2026-10-20", statut: "Payé", minutesIndividuelles: 1440, prixJehHt: 280 },
      { id: "interv_0004", etudeId: "etude_0003", membreId: "membre_0001", date: "2026-09-22", statut: "Payé", minutesIndividuelles: 480, prixJehHt: 300 },
      { id: "interv_0005", etudeId: "etude_0004", membreId: "membre_0002", date: "2026-11-18", statut: "A venir", minutesIndividuelles: 960, prixJehHt: 300 },
      { id: "interv_0006", etudeId: "etude_0004", membreId: "membre_0003", date: "2026-11-19", statut: "Non effectué", minutesIndividuelles: 480, prixJehHt: 300 },
    ],
    bvs: [
      { id: "bv_000001", date: "2026-10-31", reference: "BV-2026-10" },
    ],
    lignesBV: [
      { id: "ligne_0001", bvId: "bv_000001", membreId: "membre_0001", jeh: 1 },
      { id: "ligne_0002", bvId: "bv_000001", membreId: "membre_0002", jeh: 1 },
    ],
  };

  const pages = ["Accueil", "Études", "Finances", "Équipe", "Réglages"];
  const icons = ["⌂", "▤", "€", "♙", "⚙"];
  let current = "Accueil";
  let recherche = "";
  let compteurEtude = 22;
  const money = n => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const view = () => construireVueApplication(data, { dateFin: "2026-11-10", nombreMois: 6, tva: 0.2 });

  function nav() {
    ["tabs", "mobileTabs"].forEach(id => {
      document.getElementById(id).innerHTML = pages.map((p, i) =>
        '<button data-page="' + p + '" class="' + (p === current ? "active" : "") + '">' +
        (id === "mobileTabs" ? "<b>" + icons[i] + "</b>" : "") + p + "</button>"
      ).join("");
    });
    document.querySelectorAll("[data-page]").forEach(button => {
      button.addEventListener("click", () => { current = button.dataset.page; render(); });
    });
  }

  function heading(title, sub, action = "") {
    return '<div class="section-head"><div><h2>' + title + '</h2><span>' + sub + "</span></div>" + action + "</div>";
  }

  function dashboard(v) {
    const d = v.tableauDeBord;
    const mois = d.jehParMois || [];
    const max = Math.max(1, ...mois.map(m => m.jeh));
    const percent = d.caSigne > 0 ? Math.round(d.encaisse / d.caSigne * 100) : 0;
    const facturesOuvertes = data.factures.filter(f => f.etat !== "Payée");
    const alerts = facturesOuvertes.map(f => {
      const study = data.etudes.find(e => e.id === f.etudeId);
      const client = data.clients.find(c => c.id === study?.clientId);
      return '<div class="alert"><div class="alert-icon">!</div><div><strong>Facture à encaisser · ' +
        escapeHtml(client?.raisonSociale || study?.client || "Client") + '</strong><small>' +
        escapeHtml(study?.num || "") + " · " + money(f.montant / 1.2) + " HT · " + escapeHtml(f.type || "Facture") +
        "</small></div></div>";
    }).join("");
    return '<div class="stats">' +
      '<div class="stat"><div class="label">JEH travaillées · étudiants</div><strong>' + (d.totalJehTravaillees ?? "—").toLocaleString?.("fr-FR") + '</strong><small>Interventions réalisées uniquement</small></div>' +
      '<div class="stat"><div class="label">Chiffre d’affaires signé HT</div><strong>' + money(d.caSigne) + '</strong><small>' + d.nombreEtudes + " études suivies</small></div>" +
      '<div class="stat"><div class="label">Déjà encaissé HT</div><strong>' + money(d.encaisse) + '</strong><small>' + percent + " % du CA signé</small></div>" +
      '<div class="stat"><div class="label">Reste à encaisser HT</div><strong>' + money(d.resteAEncaisser) + '</strong><small>' + facturesOuvertes.length + " facture(s) non payée(s)</small></div>" +
      "</div>" + heading("Activité", "JEH réellement travaillées · 6 derniers mois") +
      '<div class="grid"><section class="panel"><h3>Activité des étudiants</h3><div class="sub">Durées individuelles converties en JEH</div><div class="bars">' +
      mois.map((m, i) => '<div class="barcol"><b>' + m.jeh.toLocaleString("fr-FR") + '</b><div class="bar ' + (i === mois.length - 1 ? "hot" : "") +
        '" style="height:' + (m.jeh / max * 100) + '%"></div><small>' + escapeHtml(m.mois.slice(5)) + "</small></div>").join("") +
      '</div></section><section class="panel"><h3>Encaissement</h3><div class="sub">Part du CA signé déjà encaissée</div><div class="ring-wrap"><div class="ring" style="background:conic-gradient(var(--pink) 0 ' +
      percent + '%,#f4eaf0 ' + percent + '% 100%)"></div><div class="ring-info"><strong>' + money(d.encaisse) + '</strong><small>sur ' + money(d.caSigne) +
      ' HT signés</small></div></div><div class="sub">' + money(d.resteAEncaisser) + " HT restent à encaisser</div></section></div>" +
      heading("À surveiller", "Factures et suivis en cours") +
      '<section class="panel">' + (alerts || '<div class="empty">Aucune facture en attente.</div>') + "</section>";
  }

  function studies(v) {
    const rows = v.listes.etudes.filter(s => [s.num, s.clientLibelle, s.statut].join(" ").toLowerCase().includes(recherche.toLowerCase()));
    return heading("Études", data.etudes.length + " études · état de démonstration",
      '<div class="toolbar"><input class="search" id="search" placeholder="Rechercher une étude…" value="' + escapeHtml(recherche) +
      '"><button class="action" id="addStudy">＋ Ajouter</button></div>') +
      '<section class="listbox rows">' + (rows.map(s => '<div class="item"><div class="item-main"><strong>' + escapeHtml(s.num) + " · " + escapeHtml(s.clientLibelle) +
        '</strong><small>' + escapeHtml(s.date) + " · " + s.factures.length + " facture(s)</small></div><span class="pill " +
        (s.statut === "Archivée" ? "green" : s.statut === "Devis envoyé" ? "pink" : "") + '">' + escapeHtml(s.statut) +
        '</span><div class="amount">' + money(s.montant / 1.2) + " HT</div></div>").join("") || '<div class="empty">Aucune étude trouvée.</div>') + "</section>";
  }

  function finances(v) {
    const d = v.tableauDeBord;
    return '<div class="stats"><div class="stat"><div class="label">Facturé HT</div><strong>' + money(d.montantFacture) +
      '</strong><small>' + data.factures.length + " factures</small></div><div class="stat"><div class="label">Encaissé HT</div><strong>" + money(d.encaisse) +
      '</strong><small>Factures payées</small></div><div class="stat"><div class="label">En attente HT</div><strong>' + money(d.resteAEncaisser) +
      '</strong><small>Factures non payées</small></div><div class="stat"><div class="label">À facturer HT</div><strong>' +
      money(Math.max(0, d.caSigne - d.montantFacture)) + '</strong><small>CA signé moins facturé</small></div></div>' +
      heading("Factures", "Clique sur une facture pour changer son état dans cette session") +
      '<section class="listbox rows">' + v.listes.factures.map(f => '<button class="item invoice-button" data-invoice="' + f.id +
        '" type="button"><div class="item-main"><strong>' + escapeHtml(f.type || "Facture") + " · " + escapeHtml(f.etudeLibelle) +
        '</strong><small>' + escapeHtml(f.etat) + '</small></div><span class="pill ' + (f.etat === "Payée" ? "green" : "pink") + '">' +
        (f.etat === "Payée" ? "Payée" : "À encaisser") + '</span><div class="amount">' + money(f.montant / 1.2) + " HT</div></button>").join("") +
      "</section>";
  }

  function team(v) {
    const totals = new Map(v.tableauDeBord.jehParMembre.map(x => [x.membreId, x.jeh]));
    const bvTotal = data.lignesBV.reduce((sum, l) => sum + Number(l.jeh), 0);
    return heading("Équipe", "JEH réellement travaillées par étudiant") +
      '<section class="listbox rows">' + v.listes.membres.map(m => '<div class="item"><div class="mark" style="width:36px;height:36px;border-radius:50%;font-size:12px">' +
        escapeHtml(m.libelle.split(" ").map(x => x[0]).join("").slice(0, 2)) + '</div><div class="item-main"><strong>' + escapeHtml(m.libelle) +
        '</strong><small>' + escapeHtml(m.role || "Membre") + '</small></div><div class="amount">' +
        ((totals.get(m.id) || 0).toLocaleString("fr-FR")) + " JEH</div></div>").join("") +
      '</section><div class="section-head"><h2>Bulletins de versement</h2><span>' + data.bvs.length + " BV · " +
      bvTotal.toLocaleString("fr-FR") + " JEH enregistrées</span></div>";
  }

  function settings() {
    return heading("Réglages", "Paramètres de démonstration") +
      '<section class="listbox rows"><div class="item"><div class="item-main"><strong>Taux de TVA</strong><small>20 % dans les calculs de cet aperçu</small></div></div>' +
      '<div class="item"><div class="item-main"><strong>Plafond HAC</strong><small>300 € HT/JEH · paramètre de gestion à historiser</small></div></div>' +
      '<div class="item"><div class="item-main"><strong>Stockage</strong><small>Session uniquement : aucune donnée n’est enregistrée sur le serveur ou l’appareil</small></div></div></section>';
  }

  function ouvrirAjoutEtude() {
    const clients = data.clients.map(c => '<option value="' + c.id + '">' + escapeHtml(c.raisonSociale) + "</option>").join("");
    const dialog = document.createElement("dialog");
    dialog.className = "study-dialog";
    dialog.innerHTML = '<form method="dialog" id="studyForm"><div class="section-head"><h2>Nouvelle étude</h2><button class="ghost close-dialog" value="cancel" aria-label="Fermer">×</button></div>' +
      '<label>Client<select name="clientId" required>' + clients + '</select></label>' +
      '<label>Intitulé / numéro<input name="num" required maxlength="80" placeholder="HAC-2026-022"></label>' +
      '<label>Montant TTC (€)<input name="montant" type="number" min="0" step="0.01" required></label>' +
      '<label>Statut<select name="statut"><option>Faisabilité</option><option>Devis envoyé</option><option>Devis signé</option><option>Convention envoyée</option><option>Convention signée</option></select></label>' +
      '<div class="dialog-actions"><button class="ghost" value="cancel">Annuler</button><button class="action" id="saveStudy" value="default">Créer l’étude</button></div></form>';
    document.body.appendChild(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.querySelector("#studyForm").addEventListener("submit", event => {
      if (event.submitter?.id !== "saveStudy") return;
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const clientId = form.get("clientId");
      const client = data.clients.find(c => c.id === clientId);
      const numero = String(form.get("num") || "").trim();
      const montant = Number(form.get("montant"));
      if (!client || !numero || !Number.isFinite(montant) || montant < 0) return;
      const id = "etude_" + String(compteurEtude++).padStart(4, "0");
      const prepared = preparerAjout({
        etat: data,
        collection: "etudes",
        donnees: {
          clientId,
          client: client.raisonSociale,
          num: numero,
          date: "2026-11-10",
          statut: form.get("statut"),
          montant,
          jeh: 0,
        },
        creerId: () => id,
      });
      const result = prepared.valide ? appliquerCommande(data, prepared.commande) : prepared;
      if (!result.valide) {
        alert(result.anomalies.map(a => a.raison || a).join("\n"));
        return;
      }
      Object.assign(data, result.etat);
      dialog.close();
      current = "Études";
      render();
    });
    dialog.showModal();
  }

  function render() {
    const v = view();
    nav();
    const content = document.getElementById("content");
    if (!v.valide) {
      content.innerHTML = '<section class="panel"><h2>Données incohérentes</h2><p>Les indicateurs sont masqués pour éviter un résultat trompeur.</p><ul>' +
        v.anomalies.map(a => "<li>" + escapeHtml(a.raison || a) + "</li>").join("") + "</ul></section>";
      return;
    }
    content.innerHTML = ({
      Accueil: () => dashboard(v),
      Études: () => studies(v),
      Finances: () => finances(v),
      Équipe: () => team(v),
      Réglages: settings,
    })[current]();
    const search = document.getElementById("search");
    if (search) search.addEventListener("input", () => { recherche = search.value; const pos = search.selectionStart; render(); const next = document.getElementById("search"); next?.focus(); next?.setSelectionRange(pos, pos); });
    document.getElementById("addStudy")?.addEventListener("click", ouvrirAjoutEtude);
    document.querySelectorAll("[data-invoice]").forEach(button => button.addEventListener("click", () => {
      const id = button.dataset.invoice;
      const invoice = data.factures.find(f => f.id === id);
      const prepared = preparerModification({
        etat: data,
        collection: "factures",
        id,
        modifications: { etat: invoice.etat === "Payée" ? "Émise" : "Payée" },
      });
      const result = prepared.valide ? appliquerCommande(data, prepared.commande) : prepared;
      if (result.valide) { Object.assign(data, result.etat); render(); }
    }));
  }

  document.getElementById("quickAdd").addEventListener("click", () => { current = "Études"; render(); ouvrirAjoutEtude(); });
  render();
})();
