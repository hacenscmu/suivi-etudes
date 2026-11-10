# Audit d'intégration du serveur candidat v2.2

**Décision : ne pas déployer ni raccorder le candidat v2.2 en l'état.** Il est plus sûr que le serveur historique sur plusieurs aspects, mais son contrat reste celui des collections et identités v11. Il ne peut pas porter directement le nouveau modèle métier.

Sources examinées :
- [Candidat v2.2 et ses tests simulés dans Notion](https://app.notion.com/p/414b883ec27f816d8ceedc1442eed27f)
- [Code.gs historique et changements depuis v11](https://app.notion.com/p/414b883ec27f818086abf72fa54c99cf)
- [Contrat cible API v3](./contrat-api-v3.md)

## 1. Écarts bloquants avec le modèle métier cible

| Sujet | Candidat v2.2 | Modèle HAC refondu | Conséquence |
| --- | --- | --- | --- |
| Clients | Écritures explicitement refusées ; aucune collection dans SCHEMAS | Collection `clients`, relation ponctuelle / longue durée | Impossible de gérer les fiches clients |
| Membres | Pas de collection membres ; identité portée par le prénom dans `temps` | `membres` avec identifiant stable | Homonymes et liens BV impossibles à fiabiliser |
| Bulletins de versement | Pas de collections `bvs` / `lignesBV` | Un BV avec une ligne par membre | Le flux de BV refondu ne peut pas être enregistré |
| Factures → études | Champ texte `etude` (numéro historique) | `etudeId` stable | Un numéro d'étude dupliqué rend le lien ambigu |
| Interventions → études/membres | `etude` texte + `prenom` | `etudeId` + `membreId` | Nécessite une migration avec correspondances vérifiées |
| Identité dans les fiches | L'identifiant est la clé de ligne, pas un champ `id` du modèle v3 | Identifiant stable porté par l'objet | Adaptateur de sérialisation nécessaire |

## 2. Écarts de protocole

- Le candidat exige `token`, alors que le serveur historique et le client v11 reposent sur `pass` ou un accès sans mot de passe selon la version.
- `loadAll` renvoie `{ data, supprimes, anomalies }`, alors que le client historique consomme des collections à la racine.
- `save` / `delete` exigent `col`, `id`, `expected` et `op`. Le client actuel utilise une abstraction de documents `db.doc(path).set/delete` et ne porte pas encore ce protocole de version/idempotence.
- Le candidat impose des schémas v11 stricts et refuse les champs inconnus ; les nouveaux champs et collections v3 doivent être ajoutés explicitement avant toute connexion.
- Les anciennes données `temps` utilisent `min` et `nb`. Le nouveau modèle `minutesIndividuelles` ne doit pas être rempli sans savoir si les anciennes minutes étaient collectives ou individuelles.

## 3. Points positifs à conserver

- Authentification par jeton avec empreinte SHA-256 stockée côté serveur ; jeton généré hors Apps Script.
- Verrou global autour des mutations et contrôle de version optimiste.
- Opérations identifiées par `op`, avec empreinte du contenu pour détecter la réutilisation.
- Écriture récupérable en trois étapes (`pending`, mutation, `committed`) et résolution des opérations interrompues.
- Suppression logique, quarantaine des lignes corrompues/doublonnées, validation stricte des champs.
- Limites de taille mesurées en octets UTF-8.
- La purge du journal ne supprime que les entrées `committed`, jamais les `pending`. Le journal d'idempotence est toutefois purgé après 30 jours : ce comportement doit être documenté et couvert par des tests de reprise/ancien rejeu.

Les 53 tests annoncés dans la page candidate sont simulés avec de faux services Google ; ils ne constituent pas un test d'intégration Apps Script réel.

## 4. Plan de raccordement retenu

1. Stabiliser le modèle v3 des collections `clients`, `membres`, `etudes`, `factures`, `interventions`, `bvs`, `lignesBV`, `formation`, `config` et `appareils`.
2. Définir un adaptateur frontend v3 unique : sérialisation, enveloppe de réponse, jeton, versions et identifiants d'opération.
3. Porter les bons mécanismes du candidat v2.2 vers le contrat v3, sans recopier ses schémas v11 tels quels.
4. Tester le serveur dans un projet Apps Script et un tableur de test séparés, avec données synthétiques/anonymisées.
5. Tester les conflits, reprises, suppressions, coupures réseau, homonymes, références ambiguës et BV multi-personnes.
6. Réaliser sauvegarde/restauration et rapprochement des totaux avant toute bascule.

## 5. Interdictions maintenues

- Aucun collage du candidat dans le projet Apps Script de production.
- Aucun changement du déploiement `/exec` actuel.
- Aucune migration automatique des numéros d'étude ou prénoms vers des identifiants stables.
- Aucun import de l'ancien `temps` vers des BV sans regroupement validé.
- Aucune bascule avant tests d'intégration et accord explicite.
