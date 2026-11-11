# Installer le serveur sécurisé (Code.gs) — à faire avec la mise en ligne de l'appli v17

Les données ne bougent pas : même Google Sheet, même feuille « Données ».
Faites ces étapes **sur ordinateur**, le même jour que la fusion de l'appli v17.

1. **Sauvegarde** : dans l'appli, Paramètres → Exporter mes données (fichier .json). Gardez-le.
2. **Ouvrir le script** : script.google.com → votre projet « Suivi des études ».
3. **Garder l'ancienne version** : copiez tout le contenu actuel de `Code.gs` dans un fichier texte (retour arrière possible).
4. **Remplacer** : effacez tout `Code.gs`, collez le contenu de `serveur/Code.gs`, puis Enregistrer (icône disquette).
5. **Le code des membres (première fois seulement)** : si un appareil est déjà connecté, ouvrez dans l'appli Paramètres → Membres et codes d'accès : le code des membres y est affiché. Sinon, dans l'éditeur, choisissez la fonction `codeMembres`, cliquez sur **Exécuter** et lisez le code dans le **Journal d'exécution**.
6. **Déployer** : Déployer → Gérer les déploiements → crayon → Version : **Nouvelle version** → Déployer. L'adresse /exec ne change pas.
7. **Dans l'appli** : Paramètres → Code d'accès de cet appareil → saisissez le code (membres : le code commun ; salariés : leur code) → Valider.

Dans l'appli (Paramètres → Membres et codes d'accès, visible par les membres) :
- **Code des membres** : un seul code de 8 caractères pour tous les membres (tous les droits). Il ne change pas.
- **Personnes** : chaque nom présent dans les JEH ou la formation est ajouté automatiquement avec le statut **Salarié** et un code de 8 caractères ; il ne voit que ses données (ses JEH, sa paie, sa formation, ses signalements). Statut modifiable : Salarié ou **Sans accès** (son code ne marche plus). On ne supprime personne.
- **Code d'un salarié** : les membres ne peuvent pas le changer. Le salarié le change lui-même dans ses Paramètres → Changer mon code ; il n'est alors plus visible par personne.

Qui peut retrouver les codes : le code des membres est visible dans l'appli par les membres, et dans le projet Apps Script (fonction `codeMembres` ou Paramètres du projet → Propriétés du script) par les comptes Google qui ont accès au projet. Les codes ne sont jamais écrits dans le Google Sheet.
Retour arrière : recollez l'ancien Code.gs (étape 3) et redéployez une nouvelle version.
