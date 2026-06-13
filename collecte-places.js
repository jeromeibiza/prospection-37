#!/usr/bin/env node
/* ============================================================================
   COLLECTE-PLACES.JS  —  Détecteur d'entreprises SANS site web (Indre-et-Loire 37)
   ----------------------------------------------------------------------------
   Produit un CSV directement importable dans le CRM (crm.html).
   100% Node natif (fetch intégré, Node 18+). Aucune dépendance à installer.

   CE QUE FAIT LE SCRIPT
   1. Récupère la liste des communes du 37 via l'API publique geo.api.gouv.fr
   2. Pour chaque commune x chaque secteur, interroge l'API Google Places (New)
   3. Garde uniquement les entreprises SANS vrai site web
      (websiteUri absent  -> "AUCUN" ; lien facebook/instagram -> réseau social)
   4. Déduplique (par place id), normalise, et exporte un CSV prêt pour le CRM

   ----------------------------------------------------------------------------
   PRÉ-REQUIS (à faire UNE fois par Jean Samuel)
   1. Aller sur https://console.cloud.google.com/ -> créer un projet
   2. Activer "Places API (New)"  (APIs & Services -> Library)
   3. Créer une clé API (APIs & Services -> Credentials -> Create credentials)
   4. (Recommandé) Restreindre la clé à "Places API (New)"
   5. Activer la facturation (obligatoire) — crédit gratuit ~200$/mois, large
      pour démarrer sur Tours. Voir l'estimation de coût affichée en --dry-run.

   UTILISATION (PowerShell / terminal, dans ce dossier)
     $env:GOOGLE_API_KEY="VOTRE_CLE"                # PowerShell
     node collecte-places.js --mode=tours --dry-run # estime le coût, n'appelle pas Google
     node collecte-places.js --mode=tours           # VAGUE 1 : Tours uniquement
     node collecte-places.js --mode=agglo           # Tours Métropole (22 communes)
     node collecte-places.js --mode=all             # TOUT le département (272 communes)

   Options : --max=20 (résultats/secteur/commune), --out=fichier.csv
   ============================================================================ */

'use strict';
const fs = require('fs');
const path = require('path');

/* ---------------------------------------------------------------- CONFIG --- */
const API_KEY   = process.env.GOOGLE_API_KEY || '';
const ARGS      = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const MODE      = (ARGS.mode || 'tours').toLowerCase();      // tours | agglo | all
const DRY_RUN   = !!ARGS['dry-run'];
const MAX_RESULTS = Math.min(parseInt(ARGS.max || '20', 10), 60); // 20 par page, 60 max
const OUT_FILE  = ARGS.out || `prospection_37_${MODE}.csv`;
const CACHE_DIR = path.join(__dirname, '.cache_places');
const DEPT      = '37';
const EPCI_TOURS_METROPOLE = '243700754'; // SIREN Tours Métropole Val de Loire

// Secteurs ciblés : TPE/commerces de proximité qui souvent n'ont pas de site.
const SECTEURS = [
  'coiffeur', 'institut de beauté', 'barbier', 'esthéticienne',
  'restaurant', 'pizzeria', 'bar', 'café', 'food truck', 'traiteur',
  'boulangerie', 'boucherie', 'fromagerie', 'épicerie', 'caviste',
  'fleuriste', 'tabac presse', 'cordonnerie', 'pressing',
  'plombier', 'électricien', 'chauffagiste', 'menuisier', 'serrurier',
  'maçon', 'peintre en bâtiment', 'couvreur', 'carreleur', 'plaquiste',
  'paysagiste', 'jardinier', 'garage automobile', 'carrossier', 'mécanicien',
  'auto-école', 'taxi', 'toilettage canin', 'photographe',
  'opticien', 'bijouterie', 'magasin de vêtements', 'décoration',
  'kinésithérapeute', 'ostéopathe', 'naturopathe', 'tatoueur',
];

const COLUMNS = ["secteur","ville","nom_entreprise","personne_contact","telephone","email","adresse",
  "presence_web","url_social","note_google","nb_avis","etape_kanban","score_interet","canal_prefere",
  "date_dernier_contact","date_relance_prevue","nb_relances","motif_perte","notes_qualif","source",
  "date_creation","opt_out","lien_maquette","google_maps_url","place_id"];

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = [
  'places.id','places.displayName','places.formattedAddress','places.nationalPhoneNumber',
  'places.internationalPhoneNumber','places.websiteUri','places.rating','places.userRatingCount',
  'places.googleMapsUri','places.businessStatus','nextPageToken'
].join(',');

const today = () => new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ----------------------------------------------------- COMMUNES (geo.gouv) --- */
async function getCommunes() {
  const url = `https://geo.api.gouv.fr/departements/${DEPT}/communes?fields=nom,population,codeEpci,centre&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('geo.api.gouv.fr a répondu ' + res.status);
  let communes = await res.json();
  if (MODE === 'tours')      communes = communes.filter(c => c.nom === 'Tours');
  else if (MODE === 'agglo') communes = communes.filter(c => c.codeEpci === EPCI_TOURS_METROPOLE);
  // 'all' = tout le département
  communes.sort((a, b) => (b.population || 0) - (a.population || 0));
  return communes.map(c => ({ nom: c.nom, pop: c.population || 0 }));
}

/* ---------------------------------------------------- DÉTECTION SANS SITE --- */
const SOCIAL_HOSTS = ['facebook.com','fb.com','instagram.com','linktr.ee','linktree','beacons.ai','wa.me'];
function classifyWeb(websiteUri) {
  // Renvoie { presence, url_social, isTarget }
  if (!websiteUri) return { presence: 'AUCUN', url_social: '', isTarget: true };
  const u = websiteUri.toLowerCase();
  const isFB = u.includes('facebook.com') || u.includes('fb.com');
  const isIG = u.includes('instagram.com');
  if (isFB && isIG) return { presence: 'FB+IG', url_social: websiteUri, isTarget: true };
  if (isFB)         return { presence: 'Facebook', url_social: websiteUri, isTarget: true };
  if (isIG)         return { presence: 'Instagram', url_social: websiteUri, isTarget: true };
  if (SOCIAL_HOSTS.some(h => u.includes(h))) return { presence: 'Facebook', url_social: websiteUri, isTarget: true };
  return { presence: 'SITE', url_social: '', isTarget: false }; // vrai site -> on ignore
}

/* ------------------------------------------------------------ APPEL PLACES --- */
async function searchPlaces(textQuery, pageToken) {
  const body = { textQuery, languageCode: 'fr', regionCode: 'FR', maxResultCount: MAX_RESULTS };
  if (pageToken) body.pageToken = pageToken;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(PLACES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(800 * attempt); continue; } // backoff
    const txt = await res.text();
    throw new Error(`Places API ${res.status} : ${txt.slice(0, 300)}`);
  }
  throw new Error('Places API : échec après 4 tentatives (rate-limit ?)');
}

function cacheKey(commune, secteur) {
  return path.join(CACHE_DIR, (commune + '__' + secteur).replace(/[^a-z0-9]/gi, '_') + '.json');
}

/* -------------------------------------------------------------------- RUN --- */
async function run() {
  console.log(`\n=== COLLECTE PLACES — Indre-et-Loire (37) — mode: ${MODE} ===`);
  if (!API_KEY && !DRY_RUN) {
    console.error('\n❌ Clé API manquante. Fais : $env:GOOGLE_API_KEY="VOTRE_CLE"  puis relance.');
    console.error('   (ou lance avec --dry-run pour juste estimer le coût)\n');
    process.exit(1);
  }
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

  const communes = await getCommunes();
  const totalReq = communes.length * SECTEURS.length;
  console.log(`Communes ciblées : ${communes.length}  |  Secteurs : ${SECTEURS.length}`);
  console.log(`Requêtes prévues (1 page/secteur) : ~${totalReq}`);

  // Estimation de coût (Text Search New, SKU "Pro" car on demande tel + site).
  // Tarif indicatif ~0,035$/requête ; crédit Google gratuit ~200$/mois.
  const estUSD = (totalReq * 0.035);
  console.log(`Estimation coût Google (indicatif) : ~${estUSD.toFixed(2)} $  ` +
              `(${estUSD < 200 ? '✅ couvert par le crédit gratuit ~200$/mois' : '⚠️ dépasse le crédit gratuit, fractionne par mode'})`);

  if (DRY_RUN) {
    console.log('\n🧪 DRY-RUN : aucune requête Google envoyée. Retire --dry-run pour lancer la vraie collecte.\n');
    console.log('Aperçu des 5 premières communes :', communes.slice(0, 5).map(c => c.nom).join(', '));
    return;
  }

  const byId = new Map(); // place_id -> lead (dédup)
  let scanned = 0, kept = 0, fromCache = 0;

  for (const commune of communes) {
    for (const secteur of SECTEURS) {
      const ck = cacheKey(commune.nom, secteur);
      let data;
      if (fs.existsSync(ck)) {
        data = JSON.parse(fs.readFileSync(ck, 'utf8')); fromCache++;
      } else {
        try {
          data = await searchPlaces(`${secteur} à ${commune.nom} ${DEPT}`);
          fs.writeFileSync(ck, JSON.stringify(data));
          await sleep(120); // throttle léger
        } catch (e) {
          console.error(`  ⚠️  ${secteur} / ${commune.nom} : ${e.message}`);
          continue;
        }
      }
      const places = (data && data.places) || [];
      for (const p of places) {
        scanned++;
        if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue; // fermé
        const web = classifyWeb(p.websiteUri);
        if (!web.isTarget) continue;               // a un vrai site -> pas notre cible
        const id = p.id;
        if (!id) continue;
        if (byId.has(id)) {                         // doublon -> on complète si besoin
          const ex = byId.get(id);
          if (!ex.telephone && p.nationalPhoneNumber) ex.telephone = p.nationalPhoneNumber;
          continue;
        }
        const lead = {};
        COLUMNS.forEach(c => lead[c] = '');
        lead.secteur          = capitalize(secteur);
        lead.ville            = commune.nom;
        lead.nom_entreprise   = (p.displayName && p.displayName.text) || '';
        lead.telephone        = p.nationalPhoneNumber || p.internationalPhoneNumber || '';
        lead.adresse          = (p.formattedAddress || '').replace(', France', '');
        lead.presence_web     = web.presence;
        lead.url_social       = web.url_social;
        lead.note_google      = p.rating != null ? String(p.rating) : '';
        lead.nb_avis          = p.userRatingCount != null ? String(p.userRatingCount) : '';
        lead.etape_kanban     = 'À qualifier';
        lead.nb_relances      = '0';
        lead.source           = 'Google Places';
        lead.date_creation    = today();
        lead.opt_out          = 'non';
        lead.google_maps_url  = p.googleMapsUri || '';
        lead.place_id         = id;
        // personne_contact + email : laissés VIDES (enrichissement manuel, jamais inventés)
        byId.set(id, lead);
        kept++;
      }
    }
    process.stdout.write(`\r  ${commune.nom.padEnd(28)} — ${kept} cibles retenues (${scanned} scannées)   `);
  }
  console.log('\n');

  // Tri par secteur puis ville (pratique pour le CRM)
  const leads = [...byId.values()].sort((a, b) =>
    a.secteur.localeCompare(b.secteur) || a.ville.localeCompare(b.ville) || a.nom_entreprise.localeCompare(b.nom_entreprise));

  writeCSV(leads, OUT_FILE);
  console.log(`✅ Terminé.`);
  console.log(`   ${leads.length} entreprises SANS site web exportées`);
  console.log(`   (${scanned} fiches scannées, ${fromCache} requêtes servies par le cache)`);
  console.log(`   Fichier : ${OUT_FILE}`);
  console.log(`\n👉 Importe ce CSV dans le CRM (bouton "Importer CSV").`);
  console.log(`   Rappel : email + nom du contact sont VIDES = à enrichir à la main (RGPD).\n`);
}

/* ------------------------------------------------------------------ UTILS --- */
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function csvCell(v) { v = (v == null ? '' : String(v)); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function writeCSV(rows, file) {
  const lines = [COLUMNS.join(',')];
  rows.forEach(r => lines.push(COLUMNS.map(c => csvCell(r[c])).join(',')));
  fs.writeFileSync(file, '﻿' + lines.join('\n'), 'utf8'); // BOM pour Excel FR
}

run().catch(e => { console.error('\n❌ Erreur :', e.message, '\n'); process.exit(1); });
