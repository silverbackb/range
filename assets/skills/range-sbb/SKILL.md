---
name: range-sbb
description: Analyse de visibilité SEO locale — tracking de positions organiques et Maps par zone géographique pour des prestataires itinérants (SAB) ou des commerces physiques. Utiliser quand l'utilisateur demande : où est-il visible sur un service dans une ville, comment évolue son positionnement local, veut configurer un suivi mensuel de mots-clés locaux, demande un check de position pour un client, ou dit "check le ranking", "où on est positionné sur", "visibilité locale de", "ajoute un keyword pour", "lance un check Range".
---

# Skill — Range (visibilité SEO locale)

Range est le MCP server SilverBackBase pour le tracking de positionnement local. Il stocke les keywords, zones, et l'historique des checks en SQLite local (`~/.range/range.db`).

## Comportement proactif — TOUJOURS faire ça en premier

**Dès qu'un client est mentionné, avant de proposer quoi que ce soit :**

```
1. range_list_keywords(account_id) → est-ce que ce client est déjà configuré ?
```

- **Compte existant avec keywords** → proposer un check récurrent (range_check_now) + analyse des résultats
- **Compte existant sans keywords** → proposer un setup de keywords
- **Pas de compte** → proposer le setup complet (keywords + zones + premier check)

Ne pas attendre que l'utilisateur demande ce qu'il faut faire. Analyser la situation et proposer la prochaine action immédiatement.

## Deux modes

| Mode | Ce que ça mesure | Keyword | Points GPS |
|------|-----------------|---------|------------|
| `territory` | Visibilité dans la **SERP organique** — résultats Google quand quelqu'un tape "[service] [ville]" | avec ville ("désenfumage Colmar") | 1 par ville |
| `coverage` | Visibilité dans le **Local Pack / Google Maps** — résultats Maps quand quelqu'un cherche "[service]" depuis une zone | sans ville ("coiffeur") | geo-grid autour de l'adresse |

Les deux sont complémentaires et peuvent coexister :
- **Territory** → "Suis-je visible dans Google quand quelqu'un tape 'installateur alarme Colmar' ?"
- **Coverage** → "Est-ce que ma fiche Google Business Profile apparaît dans les résultats Maps quand quelqu'un cherche 'installateur alarme' depuis la zone ?"

## Règle de présentation — ne jamais écrire "territory" ou "coverage" dans un rapport client

Les termes `territory` et `coverage` sont des termes techniques Range. Dans tout rapport, bilan ou message destiné à être lu par un client ou partagé, les remplacer par ce que chaque mode mesure réellement :

| Terme interne | À remplacer par |
|---------------|----------------|
| Territory | "Résultats Google (SERP)" ou "Visibilité organique — recherches '[keyword] [ville]'" |
| Coverage | "Google Maps (Local Pack)" ou "Visibilité Maps — fiche Google Business Profile dans la zone" |

**Format recommandé dans un bilan :**

Au lieu de :
> Territory (7 villes) — avg 20.3 · best #13
> Coverage (30km) — avg 8.6 · best #3

Écrire :
> **Résultats Google** ("installateur alarme [ville]") — 7 villes · avg 20.3 · best #13
> **Google Maps** (zone 30km autour de Stotzheim) · avg 8.6 · best #3

Et en introduction du bilan, expliquer la distinction une fois si c'est la première fois :
> "Le suivi couvre deux dimensions : les **résultats Google** (SERP organique, quand le prospect tape le nom du service + une ville) et **Google Maps** (Local Pack, quand il cherche depuis la zone sans préciser de ville — souvent sur mobile)."

La règle s'applique dans les tableaux, titres de section et recommandations. "Territory" et "coverage" peuvent rester dans les commandes Range (`range_add_keyword`, `range_get_summary`…) mais jamais dans le texte de sortie client.

## Comptes clients configurés

| Client | account_id | Domaine |
|--------|-----------|---------|
| AT2O | `at2o` | `at2o-incendie.fr` |
| Visible Ici | `visible-ici` | `visibleici.fr` |
| Veillance Contrôle | `veillance` | `veillancecontrole.com` |

## Workflow type — invocation pour un client

```
1. range_list_keywords(account_id)
   → Si keywords existants → range_check_now() + range_get_summary()
   → Si vide → setup (voir workflow nouveau keyword)
```

## Workflow type — configurer un nouveau keyword

```
0. Lire la SERP du keyword (fenêtre privée) AVANT de choisir le mode
   → La SERP a un pack local (section "Entreprises" avec carte) ?
      - Oui + organiques service visibles  → envisager coverage ET territory
      - Oui + organiques quasi absents     → coverage en priorité, territory optionnel
      - Non + organiques service           → territory uniquement (GBP ne sert pas sur ce keyword)
      - Non + SERP générique/info          → ❌ écarter ce keyword

1. range_qualify_intent([keyword, variantes...])
   → Analyser l'intention SERP AVANT de configurer quoi que ce soit
   → Selon le résultat :
      - SERVICE ★★★ → go, configurer directement
      - MIXED       → avertir, proposer une variante plus propre
      - PRODUCT     → déconseiller, suggérer des alternatives avec "installateur" / "pose"

2. range_add_keyword → crée le keyword validé (mode + domaine)
3. range_add_zone    → ajoute chaque ville cible (territory)
                    → ou laisser Range générer la grille (coverage, rayon en km)
4. range_check_now   → lance le check DataForSEO (facturable — estimer le coût avant)
5. range_get_grid    → détail point par point
6. range_get_history → évolution dans le temps
```

**Règle de qualification d'intention :**
- Toujours tester le keyword de base ET deux niveaux de variantes en parallèle :
  - Le **générique service** (`installateur [service]`) → keyword principal, volume maximal
  - L'**USP service** (`installateur [service] [qualificatif]`) → keyword secondaire, différenciateur
- Ex : "alarme sans abonnement" → qualifier "installateur alarme" ET "installateur alarme sans abonnement"
- Recommander de tracker les deux si les deux sont SERVICE — pas de choix forcé
- Un keyword PRODUCT ne doit jamais devenir un keyword territory — au mieux un keyword coverage haut de funnel

**Estimation coût avant de lancer :**
- Territory : 1 appel DataForSEO par ville
- Coverage 5×5 : ~13-25 appels par keyword selon le rayon
- Toujours donner l'ordre de grandeur avant de proposer "je lance ?"

## Workflow type — reporting mensuel

```
1. range_list_keywords(account_id) → voir tous les keywords + dernière position
2. range_check_now(keyword_id)     → pour chaque keyword à mettre à jour
3. range_get_summary(account_id)   → synthèse avec deltas
```

## Volume de recherche — rôle exact

`range_check_volume` sert à **prioriser**, pas à filtrer. Un keyword avec peu de volume mérite quand même d'être tracké — même 10 recherches/mois peuvent représenter des clients à forte valeur.

```
Utiliser range_check_volume pour :
- Décider quel keyword configurer EN PREMIER si budget limité
- Justifier la création d'une page dédiée vs page régionale
- Comparer des opportunités entre elles

Ne PAS utiliser pour :
- Bloquer la configuration d'un keyword
- Justifier de ne pas tracker une ville
```

Seuils pour la création de pages locales :
- ≥ 100/mois → page prioritaire
- 10-99/mois → page recommandée
- < 10/mois  → page régionale suffit, mais on peut quand même tracker

## Outils MCP disponibles

| Outil | Type | Description |
|-------|------|-------------|
| `range_add_keyword` | user | Ajoute un keyword à tracker |
| `range_add_zone` | user | Ajoute une ville à un keyword territory |
| `range_delete_keyword` | user | Désactive un keyword (soft delete) |
| `range_list_keywords` | model | Liste keywords + dernières positions |
| `range_check_now` | user | Déclenche un check DataForSEO (facturable) |
| `range_get_summary` | model | Vue synthétique du compte |
| `range_get_history` | model | Historique + deltas |
| `range_get_grid` | model | Détail point par point du dernier check |
| `range_check_volume` | model | Volume de recherche — outil de priorisation |
| `range_qualify_intent` | model | Analyse l'intention SERP — product / service / mixed |

## Règles d'interprétation des positions

- **Absent** → page manquante ou trop faible — regarder si une page dédiée existe avant de recommander quoi que ce soit
- **#11-20** → page existe mais sous-optimisée ou peu de liens internes
- **#1-10** → surveiller et maintenir, enchaîner avec Trail pour mesurer l'impact leads
- **Local pack présent** → GBP bien configuré pour cette zone (utile même pour les SAB en proximité immédiate)

**RÈGLE CRITIQUE — Qualifier l'intent avant d'interpréter une bonne position comme un succès :**

Lors d'un summary ou d'un reporting, pour chaque keyword qui ne contient pas de signal service explicite (installateur, pose, entreprise, artisan, technicien, devis…) :
1. Lancer `range_qualify_intent` sur ce keyword
2. Si PRODUCT ou MIXED → ne pas dire "✅ performant". Dire : "Position X mais intention produit (DIY) — les visiteurs cherchent probablement à acheter, pas à embaucher. Valeur prospect à vérifier."
3. Proposer la variante service correspondante et suggérer de la tracker en parallèle

Exemple concret :
- "alarme sans abonnement" → #1 territory, mais SERP dominé par Amazon/Leroy Merlin → flag PRODUCT, suggérer "installateur alarme sans abonnement"
- "installateur alarme" → #1 territory, SERP service pur → ✅ Dominant, valeur prospect réelle

## Types de business — choisir le bon avant de qualifier

`range_qualify_intent` prend un paramètre `business_type`. Le choisir en fonction du client :

| Type | Pour qui | Ce qui est normal dans le SERP | Red flag |
|------|----------|-------------------------------|----------|
| `service` | Plombier, installateur alarme, désenfumage | Local pack, mots "installateur" dans les titres | Amazon, Leroy Merlin, prix affichés |
| `retail` | Magasin de sport, pharmacie, librairie | E-commerce concurrents (Décathlon, Fnac) + local pack | Aucun local pack, pur e-commerce en ligne |
| `food` | Restaurant, bar, boulangerie, café | TripAdvisor, TheFork, Yelp + local pack | Aucun signal local, SERP 100% informatif |
| `professional` | Avocat, médecin, comptable, architecte | Doctolib, PagesJaunes, annuaires + local pack | SERP informatif (Wikipedia, service-public.fr) |

**La règle clé : les "red flags" changent selon le type.**
- Pour un magasin de running, voir Décathlon dans la SERP = normal. Pour un installateur de sécurité, c'est un mauvais signe.
- Pour un restaurant, voir TripAdvisor = bon signal d'intent local. Pour un avocat, Doctolib n'est pas pertinent.

## Règles d'interprétation de l'intention (range_qualify_intent)

### `service` — prestataire itinérant

| Résultat | Signification | Action recommandée |
|----------|--------------|-------------------|
| 🔧 SERVICE ★★★ | SERP dominé par des prestataires, local pack présent | Configurer en territory + coverage — keyword prioritaire |
| 🔧 SERVICE ★★☆ | Majorité service mais quelques produits | Configurer, mais vérifier que la page se positionne face aux prestataires |
| ⚖️ MIXED | SERP partagé produits / services | Avertir — chercher une variante plus propre |
| 🛒 PRODUCT | Amazon, Leroy Merlin, prix affichés | Ne pas configurer en territory. Suggérer "installateur X", "pose X" |

**Réflexe quand PRODUCT ou MIXED (service) — toujours qualifier deux niveaux de variantes :**

1. **Keyword générique service** — supprimer le qualificatif, garder seulement le service
   - "alarme sans abonnement" → tester **"installateur alarme"**
   - Plus de volume, plus compétitif, c'est là que les leads sont — keyword principal
   
2. **Keyword USP service** — ajouter "installateur" en gardant le qualificatif
   - "alarme sans abonnement" → tester aussi **"installateur alarme sans abonnement"**
   - Long-tail, moins de volume, capture le différenciateur client, plus facile à dominer — keyword secondaire

Présenter les deux et recommander de tracker les deux. Ne jamais recommander uniquement le variant USP si le générique est plus fort — c'est l'erreur classique.

Autres patterns utiles :
- `faire installer [service]` → transactionnel pur
- `[service] professionnel` → filtre le DIY
- `entreprise [service]` → B2B / pro

### `retail` — commerce physique

| Résultat | Signification | Action recommandée |
|----------|--------------|-------------------|
| 🔧 SERVICE ★★★ | Local pack présent, enseignes physiques visibles | Keyword avec intent local fort — prioritaire pour un magasin |
| ⚖️ MIXED | Local pack partiel | Tester une variante géolocalisée ("à [ville]", "près de moi") |
| 🛒 PRODUCT | Aucun local pack, pur e-commerce en ligne | Peu de trafic en magasin à attendre — chercher variante locale |

**Réflexe quand MIXED ou PRODUCT (retail) — toujours qualifier deux niveaux :**

1. **Keyword générique** — le produit/catégorie seul
   - "chaussures running" → volume maximal, compétitif, keyword principal à tracker
2. **Keyword USP** — le produit + le différenciateur du magasin
   - "chaussures running trail", "chaussures running minimaliste" → plus facile à dominer, capture la spécialité

Recommander les deux si les deux ont un local pack. Le générique pour le volume, l'USP pour la domination de niche.

### `food` — restauration

| Résultat | Signification | Action recommandée |
|----------|--------------|-------------------|
| 🔧 SERVICE ★★★ | Local pack + TripAdvisor/TheFork présents | Keyword local fort — pertinent pour un restaurant |
| ⚖️ MIXED | Signal local partiel | Ajouter une ville ou une spécialité au keyword |
| 🛒 PRODUCT | Aucun signal local | Keyword trop générique — le SERP est informatif, pas transactionnel |

**Réflexe quand MIXED ou PRODUCT (food) — toujours qualifier deux niveaux :**

1. **Keyword générique** — type d'établissement seul
   - "restaurant japonais" → volume maximal, keyword principal
2. **Keyword USP** — type + spécialité ou différenciateur
   - "restaurant japonais ramen", "sushi bar fait maison" → capture la spécialité, plus facile à dominer

Recommander les deux si les deux déclenchent un local pack.

### `professional` — professionnel libéral

| Résultat | Signification | Action recommandée |
|----------|--------------|-------------------|
| 🔧 SERVICE ★★★ | Local pack + Doctolib/PagesJaunes + mots pro dans titres | Les gens cherchent un pro — keyword pertinent |
| ⚖️ MIXED | Mix informatif / transactionnel | La page doit clairement proposer une prise de contact |
| 🛒 PRODUCT | SERP informatif (Wikipedia, gouvernement) | Keyword recherche d'info — orienter vers variante transactionnelle ("cabinet avocat Lyon") |

**Réflexe quand MIXED ou PRODUCT (professional) — toujours qualifier deux niveaux :**

1. **Keyword générique** — profession seule
   - "avocat Lyon", "médecin généraliste Paris" → volume maximal, keyword principal
2. **Keyword USP** — profession + spécialité ou type de clientèle
   - "avocat droit des affaires Lyon", "médecin homéopathe Paris" → capture la niche, plus facile à dominer

Recommander les deux si les deux sont SERVICE. Le générique pour le volume, l'USP pour la conversion (prospect déjà qualifié).

## Chaînage avec d'autres primitives

- `range_get_history` → `trail_get_channel_performance` : "la position a progressé, est-ce que le trafic organique a suivi ?"
- `range_get_summary` → Root : contexte pour le rapport client mensuel
- Keyword absent → vérifier si une page dédiée existe sur le site, sinon recommander sa création
