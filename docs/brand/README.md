# FileHarbor — logo e uso

## 1. Il logo

- **Idea** (esistente, rispettata): un **documento con l'angolo piegato** che contiene un'**ancora**.
  Il file è ormeggiato: FileHarbor è il porto dove gli asset restano. Lo stesso documento, con `?` e
  lucchetto al posto dell'ancora, è nelle immagini di fallback
  (`storage/defaults.fileharbor/fileharbor_not_found.webp`, `fileharbor_permission_denided.webp`).
- **Versioni**: lockup su due righe (simbolo + *File* / *Harbor*, come il vecchio `app_logo.png`) ·
  simbolo · simbolo *small* (per ≤ 32 px: tratti più spessi, anello pieno).
- **Costruzione**: canvas 256. Documento 174 × 232 esterno (3:4, come i fallback), tratto 22, raggi 19,
  piega 72 a 45° con raggio interno 20. Ancora a tratto 10 (≈ ½ del documento), anello r 9,5, bracci
  a semicerchio r 26 con punte a freccia, centrata in orizzontale e abbassata sotto la piega. Tutto a
  terminali e giunzioni tonde. *Small*: documento 26, ancora 16, anello pieno r 13.
- **Wordmark**: Lexend Bold (SIL OFL, la font del vecchio logo), tracciato in path, cap height 95 =
  0,41 del documento, su due righe allineate al documento. Non ribattere il nome con un font.

## 2. File

| File | Uso |
|---|---|
| `fileharbor-lockup.svg` · `-black` · `-white` · `-mono-c7c6f5` | README, documentazione, intestazioni |
| `fileharbor-symbol.svg` · `-black` · `-white` · `-mono-c7c6f5` | simbolo ≥ 48 px |
| `fileharbor-symbol-small.svg` · `-white` · `-mono-c7c6f5` | simbolo 16–32 px (tab, box Meridian) |
| `fileharbor-symbol-square.svg` | avatar/social: simbolo all'80 % su 256 |
| `fileharbor-symbol-app-icon.svg` | tile 22 % di raggio, gradiente navy, simbolo bianco |
| `fileharbor-symbol-favicon.svg` | favicon vettoriale (taglio small, crop stretto): nero su chiaro, bianco su scuro (`prefers-color-scheme`) |
| `fileharbor-stream-deck-navy.svg` · `-dark` · `stream-deck/` | tasto Stream Deck: full bleed 288, simbolo al 67 %; PNG 288 e 144 in `stream-deck/` |
| `png/` | lockup nero e pervinca a 1000 px, simboli a 512 px, trasparenti |
| `web/` | `favicon.ico` (16/32/48) e `favicon-*.png` dal tile con il taglio small, `apple-touch-icon.png` (full bleed), `icon-192/512.png` |
| `../../app_logo.png` | lockup bianco su trasparente per il README |
| `generate.py` | rigenera tutto: `uv run --no-project --with fonttools --with resvg-py python generate.py <Lexend[wght].ttf> .` (font da `google/fonts`, `ofl/lexend`) |

Si modifica `generate.py`, non gli SVG a mano: il simbolo è definito una volta sola lì.

`<head>` per le icone web:

```html
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/fileharbor-symbol-favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

## 3. Spazio e dimensioni minime

- **Spazio libero**: tutt'intorno almeno lo spessore di due tratti del documento (44 su 256).
- **Minimi**: lockup 140 px di larghezza · simbolo 48 px · sotto 48 px il taglio *small* (16 px è il
  minimo: lì l'ancora è una macchia, il documento si legge ancora).

## 4. Colore

| Nome | HEX | Uso |
|---|---|---|
| Navy profondo → Navy | `#0C0A14` → `#191856` (135°) | fondo dei fallback, tile app, Stream Deck |
| Indaco → Indaco scuro | `#3D3CA0` → `#212079` (135°) | box servizio Meridian |
| Pervinca | `#C7C6F5` | simbolo su indaco/scuro, versione monocolore |
| Inchiostro | `#111111` | nero |
| Bianco | `#FFFFFF` | su navy e su indaco |

Il gradiente navy **è** il marchio (vale per tile e fondi, mai dentro il simbolo). Il ciano `#09B7DC`
è solo l'accento UI di Meridian (`[data-svc="fileharbor"]`), non viene dal logo: non usarlo sul marchio.

Abbinamenti approvati: nero su bianco · bianco su navy/indaco · pervinca su indaco/scuro (`#0d1117`).

**Box servizio in Meridian** (`ShellServiceCard`, 44 px): sfondo `linear-gradient(135deg, #3D3CA0,
#212079)`, bordo `rgba(120,118,220,0.30)`, simbolo *small* in `#C7C6F5`, 22 px
(`meridian/app/components/shell/FileHarborGlyph.vue`).

## 5. Non fare

Non deformare · non ruotare · non riempire il documento · non togliere l'ancora o sostituirla
(`?` e lucchetto restano solo ai fallback) · non ridisporre simbolo e wordmark · non usare il
simbolo *small* sopra 32 px · non ricolorare fuori palette · non mettere il simbolo in ciano.

## 6. Verifiche fatte

Confronto 1:1 col vecchio `app_logo.png` (stesse proporzioni, stessa font), scala 16–512 px,
favicon 16/32/48, nero su bianco, bianco su navy, pervinca su scuro. Nessuna ricerca di marchio:
prima di un uso pubblico fuori HeyAtom, verificare.
