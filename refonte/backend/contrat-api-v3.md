# Contrat cible du backend HAC — proposition v3

> Document de conception uniquement. Il ne modifie ni le serveur Apps Script actuel, ni le candidat Claude, ni les données de production.

## 1. Décisions structurantes

- Le serveur v11 reste la référence de compatibilité tant que la bascule n'est pas validée.
- Le nouveau client et le nouveau serveur partagent une version de contrat explicite (`apiVersion: 3`).
- Le format cible de réponse est toujours enveloppé : `{ ok, apiVersion, data, meta, error }`.
- Les collections métier canoniques sont : `etudes`, `clients`, `membres`, `factures`, `interventions`, `bvs`, `lignesBV`, `formation`, `config`, `appareils`.
- `temps` est une collection historique v11 conservée uniquement pour l'export/la transition. Elle est lisible pendant la migration mais **non modifiable via le contrat v3**. Les nouvelles écritures de travail utilisent `interventions`.
- Une collection inconnue est refusée explicitement, pas ignorée.
- Les droits d'accès sont gérés côté serveur : `Membre` dispose de tous les droits ; `Salarie` est en lecture seule et ne reçoit que ses propres données personnelles utiles.
- Une authentification absente ou vide doit faire échouer toute opération protégée. Aucun secret ne doit être renvoyé dans `loadAll`, les erreurs ou les journaux.

## 2. Enveloppe commune

Chaque réponse doit exposer :

| Champ | Règle |
| --- | --- |
| `ok` | booléen obligatoire |
| `apiVersion` | entier, vaut `3` |
| `data` | résultat métier, présent en cas de succès |
| `meta` | métadonnées non sensibles : révision, pagination éventuelle |
| `error.code` | code stable exploitable par le client en cas d'échec |
| `error.message` | message lisible, sans secret ni trace interne |

Le client se fonde sur `ok` et `error.code`, pas uniquement sur le statut HTTP, car Apps Script peut renvoyer un statut HTTP générique pour une erreur métier.

Codes minimaux : `AUTH_REQUIRED`, `AUTH_INVALID`, `AUTH_ROLE_REQUIRED`, `FORBIDDEN`, `LAST_ADMIN`, `SELF_DEACTIVATE`, `INVALID_REQUEST`, `UNKNOWN_COLLECTION`, `NOT_FOUND`, `VERSION_CONFLICT`, `DUPLICATE_OPERATION`, `PAYLOAD_TOO_LARGE`, `READ_ONLY_COLLECTION`, `OP_INTERRUPTED`, `INTERNAL_ERROR`.

## 3. Authentification

- Le contrat v3 utilise un champ unique `token` dans les requêtes protégées.
- Un adaptateur temporaire peut convertir l'ancien champ v11 `pass` en `token` uniquement pendant une transition contrôlée ; aucun token vide n'est accepté.
- Le serveur refuse un token absent, vide ou invalide. Aucun mode « mot de passe vide = accès autorisé ».
- Le token n'est jamais stocké dans les fiches métier ni renvoyé au client.
- Une rotation de token doit pouvoir être faite sans modifier les données.

## 4. Collections et modèle d'intervention

### Collections

- Écritures autorisées : `etudes`, `clients`, `membres`, `factures`, `interventions`, `bvs`, `lignesBV`, `formation`, `config`, `appareils`.
- Lecture de compatibilité uniquement : `temps`. Toute tentative de `save` ou `delete` sur `temps` renvoie `INVALID_REQUEST` ou un code dédié `READ_ONLY_COLLECTION`.
- Les identifiants métier sont portés par les objets et doivent être stables. Les clés de lignes du tableur ne remplacent pas le champ `id`.

### Intervention normalisée

Une intervention représente le temps attribué à **une personne** sur une étude :

```json
{
  "id": "intervention-id",
  "etudeId": "etude-id",
  "membreId": "membre-id",
  "date": "2026-11-10",
  "statut": "Pas payé",
  "minutesIndividuelles": 240,
  "prixJehHt": 250
}
```

- Une JEH correspond à 480 minutes individuelles.
- Les statuts `Payé` et `Pas payé` correspondent à du travail réalisé ; `A venir` et `Non effectué` n'entrent pas dans les JEH travaillées.
- `prixJehHt` est le prix HT par JEH versé à l’intervenant ; il est distinct de la durée et du nombre de JEH. Au-dessus de 300 € HT/JEH, le système émet une alerte HAC sans bloquer l’enregistrement. Cette limite ne s’applique pas au prix JEH client de l’étude, contrôlé séparément dans la fourchette CNJE 80–450 € HT.
- Les anciennes lignes `temps` utilisent notamment `min`, `nb`, `prenom` et `etude`. Ne jamais supposer que `min` est individuelle ou convertir un prénom/numéro en identifiant sans correspondance explicite. Aucun regroupement automatique en BV.

## 5. Opérations

### `ping`

Vérifie la disponibilité et renvoie la version de l'API, l'état d'authentification, l'identifiant membre et le rôle d'accès (`Membre` ou `Salarie`), sans donnée métier ni jeton.

### `loadAll`

Renvoie les collections autorisées sous une forme stable :

```json
{
  "ok": true,
  "apiVersion": 3,
  "data": {
    "etudes": {},
    "clients": {},
    "membres": {},
    "factures": {},
    "interventions": {},
    "bvs": {},
    "lignesBV": {},
    "temps": {},
    "formation": {},
    "config": {},
    "appareils": {}
  },
  "meta": { "schemaVersion": 3, "revision": "revision-serveur" }
}
```

Les clés sont illustratives. Pour un accès `Membre`, `loadAll` renvoie les collections complètes. Pour un accès `Salarie`, le serveur ne renvoie que sa fiche membre, ses interventions, ses lignes de BV, ses BV associés, sa formation et les études auxquelles il a participé sous forme réduite (numéro, résumé, date, statut). Les clients, factures, autres membres et autres études ne sont pas transmis. Seuls les paramètres nécessaires à la paie (SMIC, taux salariaux/patronaux et chômage) sont projetés depuis la configuration. Pour un BV partagé entre plusieurs personnes, ses montants globaux ne sont pas transmis au salarié. Le serveur conserve les données existantes et ne remplace pas une collection absente par une collection vide lors d'une écriture partielle. Le client v3 peut charger `temps` pour audit/migration, mais ne l'utilise pas comme collection active d'interventions.

### Gestion des accès\n\n- `adminAcces` est réservé aux accès `Membre`. Il liste les personnes de la collection `membres` et crée automatiquement un accès `Salarie` pour chaque fiche sans rôle d'accès, avec un code aléatoire de 8 caractères maximum transmis une seule fois dans la réponse.\n- `adminDefinirRole`, `adminRegenererCode`, `adminDesactiver` et `adminReactiver` sont réservés aux accès `Membre`. Un changement de rôle régénère le code et invalide l'ancien.\n- `changerMonCode` permet à chacun de renouveler son propre code. Les empreintes SHA-256 seulement sont conservées. Le dernier accès `Membre` actif ne peut pas être rétrogradé ou désactivé.\n- Les rôles d'accès ne remplacent pas le champ métier `role` de la fiche membre (président, trésorier, etc.).\n\n### `save`

Requête cible :

```json
{
  "action": "save",
  "apiVersion": 3,
  "token": "…",
  "collection": "factures",
  "id": "identifiant-stable",
  "record": { "id": "identifiant-stable" },
  "opId": "uuid-operation",
  "expectedVersion": 4
}
```

- `collection` doit appartenir à la liste des collections modifiables ci-dessus ; `temps` est refusée.
- `id` doit être identique à `record.id`.
- `opId` est obligatoire et unique par opération logique.
- `expectedVersion` est obligatoire pour modifier une fiche existante ; création = version attendue explicitement égale à 0.
- Les accès `Salarie` ne peuvent jamais appeler `save` ou `delete` : le serveur renvoie `FORBIDDEN`.\n- Le serveur vérifie la version et effectue contrôle + écriture sous verrou. Une écriture obsolète renvoie `VERSION_CONFLICT` avec la version actuelle, sans écraser les données.
- Le serveur incrémente `_v` et conserve des métadonnées de provenance telles que `_par` et `_le` sans les accepter aveuglément depuis le client.

### `delete`

- La suppression logique crée un tombstone avec identifiant, version, date et opération d'origine.
- Le tombstone est synchronisé comme une modification versionnée ; le client ne doit pas réimporter l'ancienne fiche depuis un cache hors ligne.
- La purge physique est une tâche d'administration distincte, jamais le comportement normal de l'API.

## 6. Idempotence et file hors ligne

- Chaque opération locale reçoit un `opId` stable avant son premier envoi.
- Répéter le même `opId` avec le même contenu renvoie le résultat initial sans réappliquer l'écriture.
- Réutiliser un `opId` avec un contenu différent renvoie `DUPLICATE_OPERATION`.
- Le registre d'idempotence est durable (dans le stockage serveur), pas un cache temporaire de quelques heures.
- La file locale ne retire une opération qu'après une réponse métier explicite de succès ou après arbitrage explicite d'un conflit.
- L'ordre FIFO est conservé pour une même fiche ; les opérations indépendantes peuvent être traitées séparément.
- Un conflit n'est jamais transformé automatiquement en « dernière écriture gagnante ».

## 7. Validation, taille et concurrence

- Valider côté serveur les noms de collection, identifiants, structures JSON, champs obligatoires et relations parent/enfant : facture → étude ; intervention → étude + membre ; ligne de BV → BV + membre.
- Mesurer les limites de payload en octets UTF-8, pas en nombre de caractères JavaScript.
- Protéger lecture/écriture/version/idempotence par une stratégie de verrou cohérente.
- Les erreurs internes sont journalisées côté serveur sans token ni données personnelles inutiles.
- Le serveur ne fait pas confiance aux champs `_v`, `_par`, `_le` fournis par le client.

## 8. Compatibilité et migration

1. Sauvegarder le tableur et le script v11 ; tester la restauration sur une copie.
2. Exporter les collections v11 sans les modifier.
3. Auditer les identifiants et références ; traiter les ambiguïtés avant conversion.
4. Tester le client v3 sur une copie du backend et un jeu de données anonymisé.
5. Tester hors ligne, doublon d'opération, conflit de version, suppression hors ligne, reprise après fermeture, perte réseau pendant une écriture.
6. Comparer les comptes et totaux métier avant/après migration.
7. Ne basculer qu'après validation explicite ; conserver un chemin de retour vers v11.

## 9. Conditions bloquantes avant intégration

- La collection `clients` doit être réellement inscriptible.
- Le serveur doit prendre en charge `interventions`, `bvs` et `lignesBV`.
- Le client et le serveur partagent le même nom de champ d'authentification et le même format de réponse.
- Les conflits, suppressions et répétitions d'opérations sont testés de bout en bout.
- Une sauvegarde restaurable et un test de retour arrière sont obligatoires.

Tant que ces conditions ne sont pas remplies, aucun module métier de la refonte ne doit écrire sur le backend de production.


## 9. Signalement d'une ligne JEH manquante

La collection de lecture `signalementsJEH` conserve les demandes sans être modifiable par les actions génériques `save` / `delete`.

- `signalerJEH` : réservé au rôle `Salarie`. Reçoit `numEtude`, `date`, `duree` totale en minutes, `nb` personnes et `commentaire` facultatif (1 000 caractères maximum). Le serveur impose `membreId` depuis le jeton, résout le numéro d'étude exact et unique sans exiger une intervention préexistante (sinon le salarié ne pourrait pas signaler la ligne manquante), et calcule `minutesIndividuelles = duree / nb`. Seul le numéro saisi par le salarié est conservé dans son signalement ; il ne reçoit pas la liste des autres études. Le statut initial est `En attente`.
- `loadAll` expose les signalements à tous les Membres ; le rôle Salarié ne reçoit que ses propres signalements.
- `traiterSignalementJEH` : réservé au rôle `Membre`, avec `signalementId` et décision `ajouter` ou `refuser`. La décision n'est possible qu'une fois.
- `ajouter` crée côté serveur une intervention « Pas payé » préremplie avec l'étude, le salarié, la date et la durée individuelle, puis passe le signalement à `Ajoutée`. Le lien `signalementId` permet de retrouver l'intervention en cas de reprise après interruption, sans la dupliquer.
- `refuser` passe le signalement à `Refusée` sans créer d'intervention.
- Toute autre écriture directe d'un Salarié reste interdite. Le serveur vérifie les rôles, les liens et les valeurs ; masquer les boutons côté interface n'est jamais considéré comme un contrôle d'accès.
