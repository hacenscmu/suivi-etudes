# HAC — refonte progressive

Cette arborescence contient le nouveau socle métier et la nouvelle application HAC v3, isolés de la production. L'interface complète de test se trouve dans `app/` ; le bac à sable métier minimal reste dans `demo/`. L'application et le backend de production à la racine ne sont pas modifiés.

## Principes

- Les calculs métier sont des fonctions JavaScript indépendantes de l'interface.
- Les données absentes ou incohérentes sont signalées : elles ne sont pas corrigées silencieusement.
- Les règles historiques doivent être traitées par un adaptateur ou une migration explicite.
- Les relations entre objets devront utiliser des identifiants stables, jamais un prénom ou un numéro d'étude supposé unique.
- Aucune migration de données ni aucun déploiement sans sauvegarde restaurable et accord explicite.

## Modules actuels

| Fichier | Responsabilité |
| --- | --- |
| `domain/jeh.js` | Distinguer les JEH travaillées des interventions à venir ou non effectuées |
| `domain/tableau-de-bord.js` | Calculer les agrégats du tableau de bord sans mélanger CA signé, facturation, encaissement et JEH réellement travaillées |
| `domain/etudes.js` | Valider le cycle de vie d'une étude, calculer son CA HT signé et son prix HT/JEH, contrôler les factures liées et signaler les alertes métier |
| `domain/interventions.js` | Modéliser les durées individuelles, convertir en JEH, distinguer travail réalisé et à venir, agréger par membre et étude, alerter si le prix intervenant dépasse 300 € HT/JEH |
| `domain/bv.js` | Valider les BV et les lignes normalisées séparées, les identifiants stables, les liens membre/BV, l'unicité par personne et l'assiette minimale de 1 JEH par personne (calcul des cotisations, jamais un refus) |
| `domain/factures.js` | Vérifier les états de factures et calculer l'encaissement complet d'une étude |
| `domain/clients.js` | Distinguer une relation ponctuelle d'une relation longue durée (type CDI) et séparer cette qualification de la cadence de facturation |
| `domain/identites.js` | Valider les identifiants stables et les liens entre objets, dont interventions → étude/membre |
| `domain/audit-migration.js` | Auditer les anciennes collections sans les modifier |
| `domain/adaptateur-historique.js` | Produire un aperçu de migration sans écriture, avec correspondances client/membre explicites |
| `migration/migrer-v11.js` | Transformer un export JSON v11 en aperçu v3, comparer les totaux et signaler les champs historiques à qualifier sans rien importer |
| `application/lecture.js` | Assembler les collections validées, vérifier les références et fournir un modèle de lecture unifié à l'interface |
| `application/commandes.js` | Préparer et appliquer des ajouts/modifications immuables en mémoire, après validation structurelle et métier |
| `app/index.html` + `app/app.js` | Interface v3 mobile-first : Accueil, Études, Finances, Équipe, Réglages ; formulaires de gestion des principales fiches |
| `app/synchro.js` | Synchronisation avec l'API v3, cache local, file hors ligne et arbitrage explicite des conflits |
| `migration/vers-sheet.js` | Transformer un aperçu relu en CSV importable dans une copie du tableur, jamais en production |
| `backend/apps-script/Code.gs` | Serveur Apps Script v3 candidat, testé dans un simulateur Node et non déployé |
| `backend/client-api-v3.js` | Parler au contrat v3 via un transport injecté, avec versions, opId et erreurs explicites |
| `backend/file-hors-ligne.js` | Conserver les opérations tant que le serveur n'a pas confirmé le succès ; arbitrage explicite des conflits |
| `backend/mock-serveur-v3.js` | Simuler le serveur v3 en mémoire pour tester versions, idempotence et tombstones |
| `build/build-browser.mjs` | Construire un bundle navigateur sans dépendance externe à partir des modules CommonJS testés |

## Backend

Le contrat cible est documenté dans [`backend/contrat-api-v3.md`](backend/contrat-api-v3.md). Il distingue `interventions` (modèle actif, une personne par ligne) de `temps` (lecture historique seule). Le serveur candidat [`backend/apps-script/Code.gs`](backend/apps-script/Code.gs) est exécuté par un simulateur avec de faux services Google ; il n'est pas déployé et doit encore être éprouvé sur une copie réelle avant toute décision de bascule.

## Tests

Depuis la racine du dépôt, avec Node.js :

```sh
node --test refonte/domain/*.test.js refonte/application/*.test.js refonte/backend/*.test.js refonte/backend/apps-script/*.test.js refonte/migration/*.test.js
```

Les tests utilisent le module natif `node:test` et ne nécessitent pas de dépendance supplémentaire. Un workflow GitHub Actions exécute automatiquement toute la suite avec Node.js 22 sur les changements de la branche `Refonte`. Au 10 novembre 2026, la suite Node.js compte 276 tests unitaires : domaine, application, client API v3, serveur simulé, intégration client/serveur, file hors ligne et préparation de migration. Le workflow exécute aussi 33 contrôles navigateur Playwright dans Chromium (19 parcours de l'application connectée au Code.gs simulé et 14 en mode essai). Dernier run complet vérifié : 276/276 tests unitaires et 33/33 contrôles navigateur réussis, 0 échec (run 42921341173, commit `b441daa`) ; les bundles sont vérifiés comme reproductibles.

## État d'intégration

L'audit historique est en lecture seule : il relève les numéros d'étude dupliqués, les références facture/temps introuvables ou ambiguës, ainsi que les noms de clients et prénoms réutilisés qui nécessitent une revue humaine.

L’adaptateur historique produit uniquement un aperçu : il bloque les références d’étude ambiguës, exige un générateur d’identifiants explicite, signale les correspondances client/membre absentes ou invalides et ne regroupe jamais automatiquement les lignes de temps en BV. Il ne réalise aucune écriture.

La couche `application/lecture.js` relie désormais les collections métier pour l'interface : elle vérifie les identifiants et références, assemble les factures avec les études, les interventions avec les membres et les BV avec leurs lignes. Elle renvoie une vue unifiée en lecture seule ; si une anomalie structurelle existe, elle bloque la vue complète plutôt que d'afficher des données partielles. Elle n'effectue aucune écriture. `application/commandes.js` prépare les ajouts et modifications en mémoire, conserve les identifiants stables et refuse toute commande qui casserait les références ou les règles métier. La persistance et la gestion des conflits restent du ressort du backend v3 ; ces commandes ne prétendent pas remplacer un contrôle de version serveur.

Les modules de domaine restent indépendants de l'interface. Le modèle client distingue `ponctuelle` et `longue_duree` (relation durable comparable à un CDI) sans imposer de cadence. La cadence de facturation est un paramètre séparé, facultatif, qui doit être explicitement renseigné pour activer une alerte périodique ; une étude peut la surcharger ou la désactiver explicitement. Le prix JEH client est contrôlé séparément dans la fourchette CNJE 80–450 € HT ; le plafond HAC de 300 € HT concerne le prix JEH de l’intervenant et génère une alerte sans invalider la saisie. Le module BV prend désormais en charge la structure normalisée `bvs` + `lignesBV` : les identifiants sont stables, chaque ligne référence un BV et un membre existants, une personne ne peut figurer qu'une fois par BV et le minimum d'une JEH est une assiette de calcul des cotisations par personne (max(JEH, 1)), jamais un refus de BV. Le module interventions utilise une durée explicitement individuelle (`minutesIndividuelles`) pour éviter de deviner la répartition d'une ancienne durée collective ; une JEH correspond à 480 minutes individuelles. Il exclut les statuts `A venir` et `Non effectué` des JEH travaillées, tout en comptant `Payé` et `Pas payé`. L'agrégateur bloque les totaux complets si une ligne est invalide. Le module études distingue les statuts qui contribuent au CA signé HT, calcule le prix HT/JEH à partir des montants historiques TTC et signale un prix de JEH client hors de la fourchette CNJE 80–450 € HT (le plafond de 300 € HT concerne la JEH intervenant, pas le prix client). Il contrôle aussi les factures liées par identifiant stable et les situations d'archivage/refus. Le tableau de bord calcule le CA signé uniquement à partir des statuts signés, convertit les montants d'études TTC en HT, et convertit également les factures TTC en HT avec le taux de TVA configurable (défaut 20 %). Il ne confond donc pas le montant des études en faisabilité/devis non signé avec du CA signé. Le tableau de bord consomme désormais les interventions individuelles canoniques : il dérive les JEH depuis `minutesIndividuelles`, les statuts et les identifiants stables, au lieu d'attendre une quantité de JEH pré-calculée et potentiellement incohérente. Si une intervention est invalide, les agrégats JEH complets sont masqués (`null`) et les anomalies remontées. Le calcul du tableau de bord sépare le CA signé (études), le facturé et l'encaissé (factures liées par identifiant stable), et les JEH réellement travaillées (interventions aux statuts Payé/Pas payé). En cas de données financières incohérentes, les totaux concernés sont renvoyés à `null` plutôt que présentés comme fiables. Les formats d'entrée constituent le modèle cible de travail, pas encore un contrat de données migré. Les tests sont exécutés automatiquement dans GitHub Actions. L'application `app/` utilise le client API v3, le serveur Apps Script candidat et la file hors ligne. Elle propose un mode essai avec serveur simulé et données fictives conservées sur l'appareil ; ce mode n'appelle aucun serveur réel. Les tests de navigateur Playwright s'exécutent dans Chromium en CI et couvrent la connexion, les opérations courantes, la synchronisation hors ligne, le mode essai et l'affichage mobile. Le serveur Apps Script n'est pas déployé ; son fonctionnement réel, les quotas et la concurrence doivent encore être testés sur une copie du tableur. Les calculs et données actuels de production restent inchangés.


## Aperçu d'interface

L'application v3 mobile-first est disponible dans [`app/index.html`](app/index.html). Elle comporte les cinq espaces retenus, les formulaires de création/modification des études, clients, factures, membres, interventions et BV, les 22 alertes métier portées depuis la v12 et les filtres d'études, ainsi qu'une synchronisation hors ligne. Les fiches clients distinguent les missions ponctuelles des relations longues durées (type CDI) ; une cadence facultative et une date de référence activent les alertes périodiques sans les déduire automatiquement. Le bouton « Mode essai » permet de parcourir l'interface avec des données fictives locales, sans connexion au serveur HAC.

**Limites avant mise en service :** le mode essai n'est pas connecté aux vraies données ; le candidat Apps Script n'a pas été déployé ni testé sur une copie réelle ; l'import des données historiques et la recette métier restent à faire. Les tests navigateur Playwright sont disponibles dans `app/e2e-navigateur.js` et `app/e2e-essai.js` (exécution locale ou en CI). L'application v3 n'est pas publiée sur l'URL de production.
