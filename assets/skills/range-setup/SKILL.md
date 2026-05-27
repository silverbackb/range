# Skill — /range-setup

## Description

Onboarding intelligent pour Range. Configure le suivi de positionnement local Google pour un compte client en une seule conversation — sans que l'utilisateur ait besoin de connaître la différence entre geo-grid et territory, ni de savoir quelle taille de grille choisir.

**Utiliser quand :**
- Tu veux commencer à suivre des mots-clés pour un nouveau client
- Tu ouvres Range pour la première fois sur un compte
- Tu veux ajouter un nouveau groupe de mots-clés à un compte existant

**Ce que le skill fait :**
1. Collecte les infos métier (type d'activité, adresse, mots-clés cibles)
2. Choisit automatiquement le bon mode (geo-grid ou territory) selon le type de business
3. Calibre la grille (taille, rayon) selon la densité urbaine
4. Appelle `range_add_keyword` + `range_add_zone` pour tout configurer
5. Lance un premier `range_check_now` pour avoir une baseline immédiate

---

## 1. Collecte du contexte

Commence par poser ces questions. Tu peux les regrouper en un seul message si le contexte est déjà partiel :

```
Pour configurer Range sur ce compte, j'ai besoin de quelques infos :

1. Quel est l'identifiant du compte ? (ex: dupont-plomberie, pizza-lyon-2)
2. Quel type d'activité ? (restaurant, plombier, boutique, électricien, etc.)
3. Adresse principale du business ?
4. Quels mots-clés veux-tu suivre ? (tu peux en lister plusieurs, je les configure tous)
```

Si l'utilisateur te donne déjà ces infos dans son message de déclenchement, ne pose pas les questions — passe directement à l'étape 2.

---

## 2. Décision du mode

Range a deux modes. L'utilisateur n'a pas besoin de les connaître — tu choisis pour lui.

### Règle de décision

**`coverage`** → Commerce à adresse fixe. Le client vient *au* business. Mesure la visibilité dans **Google Maps (Local Pack)** — quand quelqu'un cherche "coiffeur" depuis la zone sans taper de ville.
- Restaurant, café, bar
- Boutique, magasin, librairie
- Pharmacie, médecin, cabinet
- Hôtel, salle de sport, coiffeur
- Tout business où l'adresse Google Maps est le point central

**`territory`** → SAB (Service Area Business). Le business va *chez* le client. Mesure la visibilité dans **les résultats Google (SERP organique)** — quand quelqu'un tape "plombier Paris 15".
- Plombier, électricien, peintre, serrurier
- Jardinier, pisciniste, ramoneur
- Garde d'enfants à domicile, aide-ménagère
- Dépanneur, déménageur
- Tout artisan/prestataire qui se déplace

**Cas mixtes** → Configurer les deux modes
- Livraison, traiteur (présence physique + zone)
- Franchise avec SAB (adresse fixe ET déplacements)
- Auto-école (école fixe + secteur de conduite)

### Annonce ton choix à l'utilisateur

**Traduis** en langage client — ne dis jamais "coverage" ou "territory" dans ta réponse (termes internes) :

> "Pour un plombier, je vais suivre ta **visibilité dans les résultats Google** quand quelqu'un cherche 'plombier Paris 15' dans chaque quartier de ta zone."

> "Pour un restaurant, je vais suivre ta **visibilité dans Google Maps** — est-ce que tu apparais dans les 3 premiers résultats Maps quand quelqu'un cherche 'restaurant' depuis le quartier."

---

## 3. Calibration de la grille (mode `coverage` uniquement)

### Taille de grille selon la densité urbaine

| Zone | Grille | Rayon | Exemple |
|------|--------|-------|---------|
| Centre-ville très dense | 3×3 | 1 km | Paris intra-muros, Vieux-Lyon |
| Ville moyenne / quartier | 3×3 | 2–3 km | Bordeaux, Nantes, banlieue parisienne |
| Zone périurbaine | 5×5 | 5 km | Commune de 20–100k hab |
| Zone rurale / petite ville | 5×5 | 10–15 km | Village, commune < 20k hab |

Annonce le choix à l'utilisateur en termes business : "Je vais couvrir un rayon de 2 km autour de ton restaurant — ça représente le quartier + les rues voisines." Pas de jargon technique.

### Paramètres à passer à `range_add_zone`

```
grid_density: "3x3" ou "5x5"
radius_km: voir tableau ci-dessus
address: adresse complète du business
```

---

## 4. Configuration des zones (territory uniquement)

Pour un SAB, demande (ou déduis depuis l'adresse) :
- La ville principale d'intervention
- Le rayon approximatif d'intervention (en km) ou la liste des villes couvertes

Crée une zone par ville/secteur clé. Typiquement 3–5 zones pour commencer.

Paramètres pour `range_add_zone` en territory :
```
city: "Nom de la ville"
country_code: "FR"
```

---

## 5. Qualification et challenge des mots-clés

**Ne configure jamais un mot-clé sans l'avoir qualifié.** Lance `range_qualify_intent` sur chaque mot-clé fourni par l'utilisateur — même si ça lui paraît évident.

### Règle de qualification

| Résultat | Action |
|----------|--------|
| SERVICE ★★★, Local Pack présent | ✅ Configurer directement |
| SERVICE ★★☆, Local Pack présent | ✅ Configurer, signaler que la SERP est compétitive |
| SERVICE ★★☆, sans Local Pack | ⚠️ Qualifier 2–3 variantes avant de décider |
| MIXED ★★☆ ou ★☆☆ (quelle que soit la présence Local Pack) | 🔴 Challenger obligatoirement — qualifier des alternatives |
| INFORMATIONAL / PRODUCT | ❌ Ne pas configurer — proposer un remplacement |

### Protocole de challenge (MIXED ou intention faible)

Quand un mot-clé est MIXED ou ★☆☆ :

1. **Ne pas demander l'avis de l'utilisateur** — qualifier immédiatement 2–3 variantes avec `range_qualify_intent`
2. **Variantes à tester en priorité** (par ordre de test) :
   - `"entreprise [mot-clé]"` — modifieur B2B / service
   - `"prestataire [mot-clé]"` — modifieur service fort
   - `"maintenance [mot-clé]"` ou `"installation [mot-clé]"` — selon le secteur
   - `"[mot-clé] [ville]"` — géo-modifieur direct
3. **Présenter un tableau comparatif** avec toutes les options (original inclus)
4. **Recommander** la meilleure option en expliquant pourquoi — ne pas laisser l'utilisateur choisir sans indication

Exemple de message :

> "Désenfumage" seul a une intention mixte (Wikipedia, Légifrance dans le top 10 — peu de valeur pour un prestataire). J'ai qualifié des alternatives :
>
> | Keyword | Intent | Confiance | Local Pack |
> |---------|--------|-----------|-----------|
> | entreprise désenfumage | SERVICE | ★★★ | ✅ |
> | prestataire désenfumage | SERVICE | ★★★ | — |
> | maintenance désenfumage | SERVICE | ★★☆ | — |
> | désenfumage (original) | MIXED | ★☆☆ | — |
>
> **Je recommande "entreprise désenfumage"** — intention service pure + Local Pack présent. Je le configure à la place ?

### Local Pack comme signal de qualité

Le Local Pack est un signal fort : il indique que Google reconnaît l'intention locale commerciale sur ce mot-clé. **Toujours le mentionner dans le récap** :

- Local Pack présent → signaler `🗺️` et l'expliquer : "Google affiche une carte sur ce terme — les entreprises locales sont prioritaires"
- Local Pack absent mais SERP service → correct, mais moins de visibilité immédiate
- Local Pack absent et SERP générique → signal faible, challenger le keyword

### Configuration

Pour chaque mot-clé validé ou sélectionné après challenge :

1. Appelle `range_add_keyword` avec :
   - `account_id` : identifiant du compte
   - `keyword_base` : le mot-clé **retenu** (pas forcément celui fourni par l'utilisateur)
   - `mode` : `"coverage"` (commerce physique/Maps) ou `"territory"` (SAB/SERP organique)
   - `location_name` : ville principale (ex: `"Paris,France"`)
   - `language_code` : `"fr"`

2. Appelle `range_add_zone` avec la config calibrée à l'étape 3 ou 4

3. Si l'utilisateur a fourni 3 mots-clés ou moins → `range_check_now` immédiatement sur chacun
   Si plus de 3 → propose de checker les 3 principaux maintenant, les autres suivront au prochain cycle

**Estimation du coût avant de lancer les checks :**
- Territory : 1 appel DataForSEO par ville configurée
- Coverage 3×3 : ~9-13 appels selon le rayon
- Coverage 5×5 : ~13-25 appels
- Toujours donner l'ordre de grandeur avant de proposer "je lance ?"

---

## 6. Récapitulatif de fin

Termine avec un récap structuré :

```
✅ Range configuré pour [nom du compte]

Mode : geo-grid · grille 3×3 · rayon 2 km (Paris 15e)

Mots-clés configurés :
  #42 "plombier Paris 15" → première vérification : #4 (moy grille)
  #43 "débouchage Paris 15" → première vérification : #7
  #44 "urgence plomberie Paris" → en attente de vérification

Prochaine étape : reviens dans 1 semaine pour voir les premières évolutions.
Ou demande-moi une analyse à tout moment.
```

---

## Outils MCP utilisés

- `range_add_keyword` — crée le mot-clé
- `range_add_zone` — configure la zone géographique
- `range_check_now` — déclenche la première vérification
- `range_get_grid` — optionnel, pour afficher la grille du premier check
- `range_check_volume` — optionnel, si l'utilisateur veut valider le volume avant de configurer
- `range_qualify_intent` — **obligatoire** sur chaque mot-clé avant configuration ; relancer sur les variantes si MIXED/★☆☆

---

## Pour la suite — skill opérationnel

Une fois le setup terminé, le workflow quotidien (checks récurrents, reporting mensuel, interprétation des positions, règles de qualification d'intention complètes) est dans le skill **`range-sbb`**.

---

## Exemple de session complète

**Utilisateur** : `/range-setup dupont-plomberie — plombier sur Paris 15, mots-clés : plombier paris 15, débouchage paris 15`

**Agent** :
> Pour un plombier qui se déplace chez les clients, je vais suivre ta **visibilité dans les résultats Google** — est-ce que tu apparais quand quelqu'un tape "plombier paris 15" depuis ce quartier.
>
> Avant de configurer, je vérifie l'intention des mots-clés…
>
> ✓ "plombier paris 15" → SERVICE ★★★ — SERP dominé par des artisans, local pack présent. Go.
> ✓ "débouchage paris 15" → SERVICE ★★★ — idem. Go.
>
> Je configure une zone couvrant Paris 15e et les arrondissements limitrophes (14e, 16e). Ça représente 3 appels DataForSEO par keyword soit ~6 appels au total. Je lance ?
>
> [utilisateur confirme]
>
> ✅ Range configuré pour dupont-plomberie
>
> Résultats Google (visibilité organique) · Paris 15, 14, 16
>
> - #12 "plombier paris 15" → position actuelle #3 dans le 15e, #6 dans le 14e
> - #13 "débouchage paris 15" → position actuelle #5 dans le 15e
>
> Prochaine étape : reviens dans 1 semaine pour voir les premières évolutions, ou demande un rapport à tout moment.
