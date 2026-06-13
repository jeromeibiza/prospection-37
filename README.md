# 🎯 Prospection Indre-et-Loire (37) — entreprises sans site web

Boîte à outils pour **Jean Samuel** : trouver les TPE/commerces locaux **sans site web** (ou avec seulement un Facebook/Instagram) et les prospecter pour leur vendre un site.

## 📦 Ce qu'il y a dans le projet

| Fichier | À quoi ça sert | Lien en ligne |
|---|---|---|
| `index.html` / `war-room.html` | **War Room** — tableau de bord de suivi du projet | https://jeromeibiza.github.io/prospection-37/ |
| `crm.html` | **Le CRM** — tableau + Kanban de prospection | https://jeromeibiza.github.io/prospection-37/crm.html |
| `collecte-places.js` | **Script de collecte** des vraies entreprises via Google Places | (se lance en local) |

---

## 1) Le CRM — au quotidien

Ouvre **https://jeromeibiza.github.io/prospection-37/crm.html** (marche sur mobile et ordi).

- **Vue Tableau** : toutes les entreprises, triables/filtrables par **secteur** et **ville**.
- **Vue Kanban** : 8 étapes, on **glisse les cartes** au fil de la prospection :
  `À qualifier → Qualifié → 1er contact → Relance → RDV/Démo → Devis envoyé → Gagné → Perdu`
- **Filtres** : secteur, ville, étape, « à relancer aujourd'hui », « masquer opt-out ».
- **Ajouter / Modifier** une fiche : bouton **＋ Ajouter** ou clic sur une ligne/carte.
- **Importer** le CSV du script : bouton **⬆️ Importer CSV** (dédoublonnage automatique).
- **Exporter** : bouton **⬇️ Exporter** (sauvegarde / Excel).
- **✨ 6 exemples fictifs** : pour tester l'outil tout de suite (à supprimer avant les vraies données).

> 🔒 **Tes données restent dans TON navigateur** (localStorage). Rien n'est envoyé en ligne, rien sur GitHub.
> ⚠️ C'est donc **mono-poste** : la base vit sur l'ordi/navigateur utilisé. Pense à **Exporter** régulièrement pour sauvegarder.

---

## 2) Le script de collecte — pour remplir le CRM avec de VRAIES entreprises

### Préparer la clé Google (une seule fois)
1. https://console.cloud.google.com/ → créer un projet.
2. **APIs & Services → Library** → activer **« Places API (New) »**.
3. **APIs & Services → Credentials** → **Create credentials → API key**.
4. Restreindre la clé à « Places API (New) » (sécurité).
5. Activer la **facturation** (obligatoire). Crédit gratuit ~**200 $/mois** → large pour Tours.

### Lancer la collecte (terminal, dans ce dossier)
```powershell
# 1. renseigner la clé (PowerShell)
$env:GOOGLE_API_KEY="VOTRE_CLE"

# 2. estimer le coût SANS rien dépenser
node collecte-places.js --mode=tours --dry-run

# 3. lancer la vraie collecte
node collecte-places.js --mode=tours     # VAGUE 1 : Tours seul       (~1,6 $)
node collecte-places.js --mode=agglo     # Tours Métropole, 22 communes (~35 $)
node collecte-places.js --mode=all       # tout le 37, 272 communes   (~440 $ → fractionner)
```
Le script produit un fichier **`prospection_37_tours.csv`** → à **importer dans le CRM**.

- Un **cache** local (`.cache_places/`) évite de re-payer si tu relances.
- Options : `--max=20` (résultats/secteur), `--out=monfichier.csv`.

---

## 3) Le flux complet

```
geo.api.gouv.fr (communes du 37)
        │
        ▼
collecte-places.js  ──► Google Places API  ──► garde les "sans site web"
        │
        ▼
   CSV (nom, ville, secteur, tél, adresse, présence FB/IG…)
        │
        ▼  (Importer CSV)
      CRM  ──►  Kanban de prospection  ──►  💰 clients
```

---

## ⚖️ RGPD — à respecter (prospection B2B)

- **Téléphone** : lun→ven, **10h-13h / 14h-20h** (pas le week-end). Max **4 sollicitations / 30 jours**.
- **Email pro** : OK sans consentement si lié à l'activité, mais **lien de désinscription obligatoire**.
- **Opt-out** : toute demande de ne plus être contacté = respectée **immédiatement et définitivement** (case sur la fiche → masquée).
- **Conservation** : prospect non converti supprimé après **3 ans** sans contact.
- Le détail est dans le bouton **« ⚖️ Mentions RGPD »** du CRM.

> 🚫 **Aucune donnée n'est inventée.** Google fournit nom / adresse / téléphone / présence d'un site —
> **jamais l'email ni le nom du gérant**. Ces deux champs (« à enrichir ») se remplissent à la main
> (page Facebook, 1er appel, visite). C'est normal et c'est plus sain pour la prospection.

---
*Construit par l'équipe d'agents (UX/UI, design, data, expert prospection B2B, réconciliation) pilotée par le master.*
